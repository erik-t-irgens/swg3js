// The rain of ours, and the snow by the same programs (the fourth wave, the design's §2.16): drops of our own drawing in a
// box round the camera, carried by the air so they lean in a gust, sweep round a corner and thin in a building's lee,
// killed under roofs by the weather's own roof grid. Every drop is always alive, its state on the card in a float32 pair
// (position relative to the pool's own anchor and a seed; velocity and a flag), one update draw a frame the weather wants
// rain or snow and one instanced draw in the weather's own scene, through the weather's own per-draw stencil.
//
// **An anchor of its own** [critique-amend-feasibility 7]: the camera snapped to whole metres, moved by its own update
// and its moves carried as a shift of its own, the mesh standing at it. The air window may be unplaced (the moving air
// off), frozen (indoors) or moved after the rain stepped, so the rain never stands at the window's corner: where the field
// ran this frame its textures are read with the window's corner handed as an offset from the anchor, worked out on the
// CPU in double, and where it did not the drops take the wind's inflow and only the roof grid kills them.
//
// **The share drawn** is the weather's own falling strength (`fallShare`): a slot is drawn while its own hash is under it,
// so no CPU work per drop; its alpha is the setting's own `rainOpacity`, so the one setting governs rain whichever way it
// is drawn. The game's own rain sheets stand down while it draws (`volRainThin`, the weather's `rainSheetScale`).
//
// Nothing is built in play: the materials are made with the field, the update compiled with the field's warm and the
// draw by the weather's own compile behind every loading screen (the mesh is in the weather's scene only with the master
// on). Nothing about a drop is read back to decide anything.
import * as THREE from 'three';
import { AIR_VERTEX } from './airShaders.ts';
import { RAIN_DRAW_FRAGMENT, RAIN_DRAW_VERTEX, RAIN_FILL_FRAGMENT, RAIN_UPDATE_FRAGMENT } from './airParticleShaders.ts';
import { AIR_TUNE } from './airTune.ts';
import { WEATHER_UNIFORMS } from '../wetness.ts';
import { wind7Uniforms } from '../wind.ts';

/** The pool's texture width: every count by preset is a whole number of its rows. */
export const RAIN_WIDTH = 128;

/** The drops the pool holds at a detail (`volRainDetail`: 4,096 to 32,768), in whole rows. */
export function rainRows(count: number): number {
  return Math.max(1, Math.round(count / RAIN_WIDTH));
}

/** The pool's memory on the card, bytes: two RGBA32F attachments a drop, ping-ponged. */
export function rainBytes(count: number): number {
  return rainRows(count) * RAIN_WIDTH * 16 * 2 * 2;
}

/** What the rain reads of the field, by reference (the kept uniform objects it writes in place). */
export interface RainSources {
  height: { value: THREE.Texture | null };
  obstacles: { value: THREE.Texture | null };
  slabTiles: { value: THREE.Vector4[] };
  slabScale: { value: THREE.Vector4 };
  slabShare: { value: THREE.Vector4 };
  atlasHalf: { value: THREE.Vector2 };
  slabMid: { value: THREE.Vector4 };
  obstacleOver: { value: number };
  hullInverse: { value: THREE.Matrix4 };
  hullBox: { value: THREE.Vector4 };
  window: { value: THREE.Vector4 };
}

/** The weather's own particle uniforms the draw discards by (the hull box it keeps rain out of), by reference. */
export interface RainHull {
  uKillSlack: { value: number };
  uHullOn: { value: number };
  uHullToLocal: { value: THREE.Matrix4 };
  uHullMin: { value: THREE.Vector3 };
  uHullMax: { value: THREE.Vector3 };
}

function rainTarget(rows: number, name: string): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(RAIN_WIDTH, Math.max(1, rows), {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    count: 2,
  });
  t.texture.name = name;
  t.textures[1].name = `${name}.1`;
  return t;
}

export class RainPool {
  pair: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private sized = -1;
  count = 0;
  readonly updateMaterial: THREE.ShaderMaterial;
  readonly fillMaterial: THREE.ShaderMaterial;
  readonly drawMaterial: THREE.ShaderMaterial;
  /** The drops' mesh, standing at the anchor, in the weather's own scene (only with the master on: the world's). */
  readonly mesh: THREE.Mesh;
  /** The anchor (the camera snapped to whole metres), and its moves owed the next update, metres. */
  readonly anchor = new THREE.Vector3();
  private readonly shift = new THREE.Vector3();
  private placed = false;
  needsFill = true;
  /**
   * This frame's numbers, written field by field by the world before `step` and `writeDraws` (no number handed across a
   * call on the frame's path): the frame's dt, the camera, whether the field ran its update (`live`), snow, the share
   * drawn and the alpha, the air window's corner and size (double), the screen's height in pixels. Fractions to start.
   */
  readonly frame = { dt: 0.5, camX: 0.5, camY: 0.5, camZ: 0.5, live: false, snow: false, share: 0.5, alpha: 0.5, winX: 0.5, winZ: 0.5, winSize: 192.5, screen: 1080.5, windX: 0.5, windZ: 0.5 };
  /** The wind the drops take outside the window and on a frame the field did not run (`frame.windX/Z`, the weather's own, m/s). */
  private readonly wind = new THREE.Vector2();
  /** The air's pending scroll (window uv), and the streaks' colour (the sky's light, `rainColourIn`), written by the world. */
  readonly velShift = new THREE.Vector2();
  readonly colour = new THREE.Color(0.5, 0.5, 0.5);
  /** Whether our rain (or snow) draws this frame: the weather's hand-overs and the sheets' factor read it. */
  drawing = false;
  readonly stats = { steps: 0, fills: 0, anchorMoves: 0, jumps: 0, live: 0, inflow: 0 };
  private frameSeed = 1;
  private readonly rP = new THREE.Vector4();
  private readonly rShift = new THREE.Vector4();
  private readonly rBox = new THREE.Vector4();
  private readonly rAnchor = new THREE.Vector4();
  private readonly rWin = new THREE.Vector4(0, 0, 192, 0);
  private readonly rQ = new THREE.Vector4(0.6, RAIN_WIDTH, 0, 0);
  private readonly lift = new THREE.Vector4(0.5, 3, 3, 0);
  private readonly liftB = new THREE.Vector4(0.5, 3, 0, 1);
  private readonly dD = new THREE.Vector4(RAIN_WIDTH, 0, 0, 0.35);
  private readonly dS = new THREE.Vector4(0.045, 0.012, 1.2, 1080);
  private readonly dE = new THREE.Vector4(32, 0.1, 4, 18);
  private readonly dB = new THREE.Vector4(0.5, 1.5, 8, 0.01);
  private readonly dF = new THREE.Vector4();
  private readonly s0 = { value: null as THREE.Texture | null };
  private readonly s1 = { value: null as THREE.Texture | null };
  /** The fog the drops fade into, written by the world from the scene's own (the weather's sheets take theirs alike). */
  readonly fogDensity = { value: 0 };
  readonly fogColour = { value: new THREE.Color(0.6, 0.6, 0.6) };
  /** The weather's own kill slack under a roof, by reference. */
  private readonly killSlack: { value: number };

  constructor(src: RainSources, hull: RainHull, sunDir: { value: THREE.Vector3 }) {
    this.killSlack = hull.uKillSlack;
    this.updateMaterial = new THREE.ShaderMaterial({
      name: 'air.rain',
      vertexShader: AIR_VERTEX,
      fragmentShader: RAIN_UPDATE_FRAGMENT,
      uniforms: {
        uWindow: src.window,
        uWind: { value: this.wind },
        uWind7: wind7Uniforms().uWind7,
        uSlabTiles: src.slabTiles,
        uSlabScale: src.slabScale,
        uSlabShare: src.slabShare,
        uAtlasHalf: src.atlasHalf,
        uR0: { value: null },
        uR1: { value: null },
        uVel: { value: null },
        uGround: src.height,
        uObstacles: src.obstacles,
        uRoofMap: WEATHER_UNIFORMS.uRoofMap,
        uRoofGrid: WEATHER_UNIFORMS.uRoofGrid,
        uVelShift: { value: this.velShift },
        uSlabMid: src.slabMid,
        uObstacleOver: src.obstacleOver,
        uHullInverse: src.hullInverse,
        uHullBox: src.hullBox,
        uRainP: { value: this.rP },
        uRainShift: { value: this.rShift },
        uRainBox: { value: this.rBox },
        uAnchor: { value: this.rAnchor },
        uRainWin: { value: this.rWin },
        uRainQ: { value: this.rQ },
        uLift: { value: this.lift },
        uLiftB: { value: this.liftB },
      },
      blending: THREE.NoBlending,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    this.fillMaterial = new THREE.ShaderMaterial({ name: 'air.rain.fill', vertexShader: AIR_VERTEX, fragmentShader: RAIN_FILL_FRAGMENT, blending: THREE.NoBlending, toneMapped: false, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3 });
    this.drawMaterial = new THREE.ShaderMaterial({
      name: 'air.rain.drops',
      vertexShader: RAIN_DRAW_VERTEX,
      fragmentShader: RAIN_DRAW_FRAGMENT,
      uniforms: {
        uR0: this.s0,
        uR1: this.s1,
        uRainD: { value: this.dD },
        uRainS: { value: this.dS },
        uRainE: { value: this.dE },
        uRainColour: { value: this.colour },
        uSunDir: sunDir,
        uRainB: { value: this.dB },
        uFogDensity: this.fogDensity,
        uFogColor: this.fogColour,
        uRoofMap: WEATHER_UNIFORMS.uRoofMap,
        uRoofGrid: WEATHER_UNIFORMS.uRoofGrid,
        uKillSlack: hull.uKillSlack,
        uHullOn: hull.uHullOn,
        uHullToLocal: hull.uHullToLocal,
        uHullMin: hull.uHullMin,
        uHullMax: hull.uHullMax,
        uRainF: { value: this.dF },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    // Unlit and dry, as the weather's own sheets are: nothing adopts it or wraps it, so its key never changes.
    this.drawMaterial.userData.unlit = true;
    this.drawMaterial.userData.dry = true;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, this.drawMaterial);
    this.mesh.name = 'air.rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
  }

  /** Every material of the pool, for the warm and the scanner. */
  materials(): THREE.ShaderMaterial[] {
    return [this.updateMaterial, this.fillMaterial, this.drawMaterial];
  }

  /** The targets for a count of drops (class T): made again only when it moved, every drop never born. Answers whether it resized. */
  ensure(count: number): boolean {
    if (this.pair && this.sized === count) return false;
    const rows = rainRows(count);
    if (!this.pair) this.pair = [rainTarget(rows, 'air.rain.a'), rainTarget(rows, 'air.rain.b')];
    else for (const t of this.pair) t.setSize(RAIN_WIDTH, rows);
    this.sized = count;
    this.count = rows * RAIN_WIDTH;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.count;
    this.needsFill = true;
    this.bindState();
    return true;
  }

  private bindState(): void {
    const p = this.pair;
    this.s0.value = p ? p[0].textures[0] : null;
    this.s1.value = p ? p[0].textures[1] : null;
  }

  /**
   * The anchor for this frame's camera (`frame.camX/Y/Z`): it moves by whole metres whenever the camera has gone a metre
   * or more from it, the move owed as a shift; a fill (or the first frame) takes the camera's own. A move past the box
   * itself in one go (a teleport, a travel's landing, the rain coming back after a pause in a fall) is a jump: the drops
   * are no rain of this place, so the pool fills afresh about the camera, as the kick-up's does at the window's jump.
   */
  placeAnchor(): void {
    const f = this.frame;
    const x = Math.round(f.camX);
    const y = Math.round(f.camY);
    const z = Math.round(f.camZ);
    const a = this.anchor;
    if (this.placed && !this.needsFill) {
      const R = AIR_TUNE.rain;
      const across = 2 * (R.reach > 1 ? R.reach : 1);
      const tall = R.below + R.above > 1 ? R.below + R.above : 1;
      const dx = x - a.x;
      const dy = y - a.y;
      const dz = z - a.z;
      if (dx > across || dx < -across || dz > across || dz < -across || dy > tall || dy < -tall) {
        this.needsFill = true;
        this.stats.jumps++;
      }
    }
    if (!this.placed || this.needsFill) {
      a.x = x;
      a.y = y;
      a.z = z;
      this.shift.x = 0;
      this.shift.y = 0;
      this.shift.z = 0;
      this.placed = true;
      return;
    }
    if (x !== a.x || y !== a.y || z !== a.z) {
      this.shift.x += x - a.x;
      this.shift.y += y - a.y;
      this.shift.z += z - a.z;
      a.x = x;
      a.y = y;
      a.z = z;
      this.stats.anchorMoves++;
    }
  }

  /**
   * The update, drawn by the field's drawer (`draw`): the anchor's moves owed, the air's textures this frame or the
   * wind's inflow (`frame.live`), the roof grid's origin relative to the anchor, the tune's numbers. Then the pair swapped.
   */
  step(draw: (m: THREE.ShaderMaterial, t: THREE.WebGLRenderTarget) => void, vel: THREE.Texture | null): void {
    const pair = this.pair;
    if (!pair) return;
    if (this.needsFill) {
      draw(this.fillMaterial, pair[0]);
      draw(this.fillMaterial, pair[1]);
      this.needsFill = false;
      this.stats.fills++;
    }
    const R = AIR_TUNE.rain;
    const P = AIR_TUNE.particles;
    const f = this.frame;
    const snow = f.snow;
    this.frameSeed = (this.frameSeed + 1) % 16777216;
    this.wind.x = f.windX;
    this.wind.y = f.windZ;
    const rp = this.rP;
    rp.x = f.dt;
    rp.y = this.frameSeed;
    rp.z = f.live && vel !== null ? 1 : 0;
    rp.w = snow ? 1 : 0;
    const rs = this.rShift;
    rs.x = this.shift.x;
    rs.y = this.shift.y;
    rs.z = this.shift.z;
    rs.w = R.reach > 1 ? R.reach : 1;
    const rb = this.rBox;
    rb.x = R.below;
    rb.y = R.above;
    rb.z = snow ? R.snowFall : R.fall;
    rb.w = snow ? R.snowTau : R.tau;
    const ra = this.rAnchor;
    ra.x = this.anchor.x;
    ra.y = this.anchor.y;
    ra.z = this.anchor.z;
    ra.w = this.killSlack.value;
    // The air window's corner relative to the anchor, worked out in double.
    const rw = this.rWin;
    rw.x = f.winX - this.anchor.x;
    rw.y = f.winZ - this.anchor.z;
    rw.z = f.winSize > 1 ? f.winSize : 1;
    this.rQ.x = R.snowFlutter;
    this.rQ.y = (pair[0].width > 0 ? pair[0].width : RAIN_WIDTH);
    const li = this.lift;
    li.x = P.oroK;
    li.y = P.oroSpan;
    li.z = P.oroMax;
    li.w = P.vortK;
    const u = this.updateMaterial.uniforms;
    u.uR0.value = pair[0].textures[0];
    u.uR1.value = pair[0].textures[1];
    u.uVel.value = vel;
    draw(this.updateMaterial, pair[1]);
    const t = pair[0];
    pair[0] = pair[1];
    pair[1] = t;
    this.bindState();
    this.shift.x = 0;
    this.shift.y = 0;
    this.shift.z = 0;
    this.stats.steps++;
    if (rp.z > 0.5) this.stats.live++;
    else this.stats.inflow++;
  }

  /** The draw's numbers for this frame and the mesh stood at the anchor, shown while it draws. */
  writeDraws(): void {
    const R = AIR_TUNE.rain;
    const f = this.frame;
    const dd = this.dD;
    dd.x = this.pair ? this.pair[0].width : RAIN_WIDTH;
    dd.y = f.share;
    dd.z = f.snow ? 1 : 0;
    dd.w = f.alpha;
    const ds = this.dS;
    ds.x = R.streak;
    ds.y = R.width;
    ds.z = R.minPx;
    ds.w = f.screen > 1 ? f.screen : 1;
    const de = this.dE;
    de.x = R.reach > 1 ? R.reach : 1;
    de.y = R.edgeFade;
    de.z = R.below;
    de.w = R.above;
    const db = this.dB;
    db.x = R.backBase;
    db.y = R.backLift;
    db.z = R.backPower;
    db.w = R.snowSize;
    this.dF.x = f.snow ? 1 : 0;
    this.mesh.visible = this.drawing;
    this.mesh.position.x = this.anchor.x;
    this.mesh.position.y = this.anchor.y;
    this.mesh.position.z = this.anchor.z;
  }

  /** Every drop never born at the next update (a jump, a new world, the rain turned on again). */
  clear(): void {
    this.needsFill = true;
    this.placed = false;
  }

  /** The targets freed (the master off); the materials kept. */
  release(): void {
    if (this.pair) for (const t of this.pair) t.dispose();
    this.pair = null;
    this.sized = -1;
    this.count = 0;
    this.placed = false;
    this.drawing = false;
    this.mesh.visible = false;
    this.bindState();
  }

  /**
   * Read the drops back (console only, a GPU sync): how many stand in the box, how many under a roof cell the weather's
   * grid says is roofed (none should, past a frame), the mean lean of their velocity across, and with a point the drops
   * within a radius of it and their mean velocity there.
   */
  measure(renderer: THREE.WebGLRenderer, roofAt: ((x: number, z: number) => number) | null, near?: { x: number; z: number; radius: number }): Record<string, unknown> | null {
    const p = this.pair;
    if (!p) return null;
    const h = p[0].height;
    const s0 = new Float32Array(RAIN_WIDTH * h * 4);
    const s1 = new Float32Array(RAIN_WIDTH * h * 4);
    try {
      renderer.readRenderTargetPixels(p[0], 0, 0, RAIN_WIDTH, h, s0, undefined, 0);
      renderer.readRenderTargetPixels(p[0], 0, 0, RAIN_WIDTH, h, s1, undefined, 1);
    } catch {
      return null;
    }
    let born = 0;
    let underRoof = 0;
    let open = 0;
    let lean = 0;
    let fall = 0;
    let nearN = 0;
    let nearVx = 0;
    let nearVz = 0;
    let nearVy = 0;
    const a = this.anchor;
    for (let i = 0; i < RAIN_WIDTH * h; i++) {
      const k = i * 4;
      if (!(s1[k + 3] > 0.5)) continue;
      born++;
      const wx = s0[k] + a.x;
      const wy = s0[k + 1] + a.y;
      const wz = s0[k + 2] + a.z;
      if (roofAt) {
        const top = roofAt(wx, wz);
        if (Number.isFinite(top) && wy < top - this.killSlack.value) underRoof++;
        else open++;
      }
      lean += Math.sqrt(s1[k] * s1[k] + s1[k + 2] * s1[k + 2]);
      fall += -s1[k + 1];
      if (near) {
        const dx = wx - near.x;
        const dz = wz - near.z;
        if (dx * dx + dz * dz <= near.radius * near.radius) {
          nearN++;
          nearVx += s1[k];
          nearVy += s1[k + 1];
          nearVz += s1[k + 2];
        }
      }
    }
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      drops: born,
      underRoof,
      open,
      meanAcross: born ? r3(lean / born) : null,
      meanFall: born ? r3(fall / born) : null,
      near: near ? { drops: nearN, velocity: nearN ? [r3(nearVx / nearN), r3(nearVy / nearN), r3(nearVz / nearN)] : null } : null,
    };
  }

  dispose(): void {
    this.release();
    for (const m of this.materials()) m.dispose();
    this.mesh.geometry.dispose();
  }
}
