// The air of the room the camera is in. Each frame this decides which room the frame is drawn from
// (a portal building's rooms, or a ship's rooms while the camera is among them), and packs what
// the effects need to know about it into one kept `RoomAirFrame`: the doorways the sun comes in
// through (their beams, as prisms in the room's frame), the lamps (those in sight first), the room's
// own ambient and parallel light, and the boxes the dust motes fill.
//
// Two things read the frame. The effects chain's `lightShafts` pass draws the beams and the lamps'
// glow along each pixel's view ray (src/core/fx/lightShafts.ts). The dust motes here are a point
// cloud on the actor layer, placed and lit in their vertex shader from the same frame: drawn with
// the rooms alone they would be painted over wherever a doorway is behind them, since the world
// seen through a doorway is drawn after the rooms; as actors they are drawn in both passes, clipped
// by the portal stencil, and they are hidden on any frame drawn from outside.
//
// No light is added and no material in the scene changes: the glow and the motes read the pooled
// lights' values as numbers. Nothing here allocates in `update` once a room's caches are filled;
// the physics engine's ray casts still wrap their vectors on each call.
import * as THREE from 'three';
import type { Building, CellState } from './layoutStream';
import type { LoadedModel } from './assetPack';
import type { World } from './world';
// The value imports name their `.ts` files and the class has no parameter properties, so node runs
// this module as it stands: tools/swg/tests/roomAir.test.ts drives the whole state machine with stubs.
import { ACTOR_LAYER, markActor, type PortalRenderer } from './portalRender.ts';
import type { ShipInterior } from '../vehicles/interior';
import type { SunInfo } from '../core/postfx';
import type { Settings } from '../core/settings';
import { createFxLights, type FxLights } from '../core/fx/lights.ts';
import * as M from './roomAirMath.ts';
import { MOTES_FRAG, MOTES_VERT } from './roomAirShaders.ts';

export { MAX_LAMPS, MAX_MOTE_BOXES, MAX_MOTES, MAX_SHAFTS } from './roomAirMath.ts';
const { MAX_LAMPS, MAX_MOTE_BOXES, MAX_MOTES, MAX_SHAFTS } = M;

/** Aboard, the glow follows the lamps the flash pool lights (the nearest three to the player). */
export const SHIP_LAMPS = 3;
/** How long the camera's room must stay changed before it counts: which building the camera is in can flip from frame to frame on the door line. */
export const HOLD_SECONDS = 0.12;
/** A lamp's glow centre and sight target are kept this far inside its room's box: a third of the lamps sit outside their room's box, many in the ceiling above it. */
export const LAMP_INSET = 0.2;
/** Aboard, the rooms' faint light between lamps, so a mote is just visible anywhere. */
const SHIP_AMBIENT = 0.06;
/** A beam's reach is clamped to this, metres. */
const MAX_REACH = 60;

/** Hand-tuned constants, live through __debug.roomAir; not saved. */
export interface RoomAirTuning {
  /** Beam radiance added per metre of beam, per unit of sun radiance, at strength 1. */
  scatter: number;
  /** The haze saturates as (1 - exp(-k L)) / k, per metre: long paths along a beam do not blow out. */
  saturation: number;
  /** Half width of a beam's soft edge at the doorway, metres. */
  soft: number;
  /** Streak noise across the beam, 0 to 1. */
  noise: number;
  /** Henyey-Greenstein g: brighter looking towards the sun. */
  phaseG: number;
  /** The sunlit patch's gain over the room's own light. Held at 0 until it has been judged by eye. */
  patch: number;
  /** How much overcast weather dims the beams: dayFade x (1 - overcastDim x overcast). */
  overcastDim: number;
  /** Extra scattering in dusty weather: the beam's scatter and the motes' beam gain x (1 + dustScatter x dust). */
  dustScatter: number;
  /** Lamp glow per metre, at roomGlowStrength 1. */
  lampSigma: number;
  /** Softening radius around a lamp, metres (keeps the glow finite at the bulb). */
  lampEps: number;
  /** Room haze per metre, at roomGlowStrength 1. */
  haze: number;
  /** Share of the room's ambient and parallel light the haze scatters. */
  hazeAlbedo: number;
  /** The motes tile a cube this wide around the camera, metres. */
  moteSpan: number;
  /** Motes drawn at roomMoteAmount 1. */
  moteCount: number;
  /** A mote's size, metres. */
  moteSize: number;
  moteAlbedo: number;
  /** How much brighter a mote is in a beam than the beam's haze per metre. */
  moteShaftGain: number;
  /** How fast the room effects fade in and out, per second. */
  fadeRate: number;
  /** Farthest doorway considered, metres from the camera. */
  exitRange: number;
}

export const ROOM_AIR_TUNING: Readonly<RoomAirTuning> = {
  scatter: 0.04,
  saturation: 0.35,
  soft: 0.06,
  noise: 0.6,
  phaseG: 0.35,
  patch: 0,
  overcastDim: 0.85,
  dustScatter: 1,
  lampSigma: 0.004,
  lampEps: 0.3,
  haze: 0.03,
  hazeAlbedo: 0.15,
  moteSpan: 8,
  moteCount: 1500,
  moteSize: 0.004,
  moteAlbedo: 0.35,
  moteShaftGain: 4,
  fadeRate: 2.5,
  exitRange: 40,
};

export type RoomAirMode = 'building' | 'ship';

/** What RoomAir reads each frame. The game keeps one and refills it in drawFrame. */
export interface RoomAirInput {
  dt: number;
  camera: THREE.PerspectiveCamera;
  /** The building this frame is drawn from inside (the portal renderer's answer), or null. */
  view: Building | null;
  /** The building and cell the player stands in. */
  cell: CellState | null;
  /** The ship's rooms the player is aboard. */
  aboard: ShipInterior | null;
  /** The camera is among the rooms of that ship this frame. */
  cameraInHull: boolean;
  /** The player's place: world space, or the hull's frame while aboard. */
  playerPos: THREE.Vector3;
  sun: SunInfo | null;
  /** 0 to 1: the weather's overcast and dust while the weather is on; 0 until the weather lands. */
  overcast: number;
  dust: number;
  /** The drawing buffer's height, pixels. */
  bufferHeight: number;
}

/**
 * Everything the effects pass and the motes read about the room this frame. Kept objects, refilled
 * in place; arrays are fixed-length. Room frame = the building's model space or the hull's frame.
 * A slot never used holds identity / (1, 1, 1, soft) / zero light; a freed slot keeps its last
 * matrix, size, box and rect and has its light set to (0, 0, 0, 0). Both shaders skip a slot whose
 * light's a is 0.
 */
export interface RoomAirFrame {
  mode: RoomAirMode;
  /** 0 to 1, already multiplied into every light value below. */
  fade: number;
  readonly roomToWorld: THREE.Matrix4;
  readonly worldToRoom: THREE.Matrix4;
  readonly cameraRoom: THREE.Vector3;
  /** Seconds in this room (reset when a room becomes active). */
  time: number;

  /** The highest used slot + 1. */
  shaftCount: number;
  /** Some slot has light this frame. */
  shaftsLit: boolean;
  /** Room frame to the unit prism (a across the doorway, b up it, t along the light, each 0 to 1). */
  readonly shaftToUnit: THREE.Matrix4[];
  /** (width m, height m, reach m, soft m). */
  readonly shaftSize: THREE.Vector4[];
  /** The shaft box: the doorway's room box padded 0.05 m, united with the doorway's own box padded 0.3 m. */
  readonly shaftBoxMin: THREE.Vector3[];
  readonly shaftBoxMax: THREE.Vector3[];
  /** rgb: the sun's radiance x day fade x lit x facing x weight x fade. a: the same without the radiance. */
  readonly shaftLight: THREE.Vector4[];
  /** Screen uv bounds of the prism (minU, minV, maxU, maxV); (0, 0, 1, 1) when it reaches behind the camera. */
  readonly shaftRect: THREE.Vector4[];
  /** Towards the sun, room frame (unit). */
  readonly sunDirRoom: THREE.Vector3;
  readonly sunColor: THREE.Color;
  /** The sun light's intensity, as the world is lit now. */
  sunLight: number;
  /** 1 + tuning.dustScatter x dust. */
  scatterBoost: number;

  /** Live lamps, those in sight first. The motes are lit by all of them. */
  lampCount: number;
  /** How many of the first lampCount are in sight: the pass draws glow for these only. */
  lampSightCount: number;
  /** xyz room frame (clamped into the lamp's room box shrunk by LAMP_INSET), w range m. */
  readonly lampPos: THREE.Vector4[];
  /** rgb: colour x intensity (as the pooled light has it) x fade. a: sight 0 to 1. */
  readonly lampColor: THREE.Vector4[];

  /** The room's ambient (with its floor) x fade; a faint grey aboard. */
  readonly ambient: THREE.Color;
  /** The room's parallel light x fade; black when none. */
  readonly parallelColor: THREE.Color;
  /** Luminance of the room's own light (ambient + half the parallel), for the patch's gain; at least 0.25. */
  roomLuma: number;
  /** 0 to 1: the room haze's share, easing to 1 while a beam is lit or a lamp in sight and back after. */
  hazeWeight: number;

  moteBoxCount: number;
  readonly moteBoxMin: THREE.Vector3[];
  readonly moteBoxMax: THREE.Vector3[];

  readonly tuning: RoomAirTuning;
  /** 0 the picture, 1 the haze alone, 2 the patch mask. */
  debugView: 0 | 1 | 2;
}

export interface RoomAirDebugOptions extends Partial<RoomAirTuning> {
  view?: 'haze' | 'patch' | null;
  /** Wireframes of the selected prisms (compiles one line material on first use). */
  showPrisms?: boolean;
  /** Hold the current selection and lit values while looking around. */
  freeze?: boolean;
  /** Set the time of day so the sun shines straight into the nearest doorway. */
  sunInto?: boolean;
}

/** The console listing (debug only; allocates freely). */
export interface RoomAirDescription {
  mode: RoomAirMode | null;
  model: string | null;
  cell: number | null;
  /** The frame is drawn from inside the active room. */
  inside: boolean;
  /** The room has not been left for longer than HOLD_SECONDS. */
  held: boolean;
  fade: number;
  sun: { dir: number[]; daylight: number; light: number; overcast: number; dayFade: number } | null;
  exits: number;
  shafts: { slot: number; portal: number; cell: number; cellName: string; size: number[]; reach: number; facing: number; lit: number; weight: number; decidedBy: 'probes' | 'centre'; rect: number[]; inward: number[]; doorWorld: number[] }[];
  lamps: { slot: number; cell: number | null; at: number[]; clamped: number; range: number; luminance: number; sight: number }[];
  ambient: string;
  parallel: string;
  hazeWeight: number;
  motes: { on: boolean; visible: boolean; drawn: number; boxes: number; span: number };
  tuning: RoomAirTuning;
  aim?: { time: number; clock: string; facing: number; lit: number } | null;
}

/** A doorway's lit state in one placed building (the geometry is shared by every copy of the model). */
interface ApertureState {
  readonly a: M.ExitAperture;
  lit: number;
  litTarget: number;
  tested: boolean;
  testedTime: number;
  readonly testedSun: THREE.Vector3;
  facing: number;
  score: number;
  picked: boolean;
}

interface SlotState {
  state: ApertureState | null;
  weight: number;
  target: number;
  reach: number;
}

const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const COS_025 = Math.cos(THREE.MathUtils.degToRad(0.25));
const COS_1 = Math.cos(THREE.MathUtils.degToRad(1));
const COS_5 = Math.cos(THREE.MathUtils.degToRad(5));
/** The twelve edges of a box by corner index (bit 0 a, bit 1 b, bit 2 t). */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

function isShip(room: object | null): room is ShipInterior {
  return !!room && 'vehicle' in room;
}

export class RoomAir {
  readonly points: THREE.Points;
  readonly tuning: RoomAirTuning = { ...ROOM_AIR_TUNING };

  private readonly data: RoomAirFrame;
  private readonly material: THREE.ShaderMaterial;
  private readonly S: M.RoomAirSettings = { ...M.ROOM_AIR_SETTING_DEFAULTS };
  /** The world's lights, filled here before the scene is drawn (the rooms' lamps and the sun's radiance). */
  private readonly lights: FxLights = createFxLights();

  // Which room, and how far faded in.
  private held: Building | ShipInterior | null = null;
  private holdTimer = 0;
  private active: Building | ShipInterior | null = null;
  private fade = 0;
  private visible = false;
  private lastRaw: Building | ShipInterior | null = null;
  /** Seconds since construction, for how old a test is; never reset. */
  private clock = 0;

  // Caches, keyed by what they depend on, so nothing needs dropping when a building's inside goes.
  private readonly exitsOf = new WeakMap<LoadedModel, M.ExitAperture[]>();
  private readonly boxesOf = new WeakMap<LoadedModel, Map<number, M.RoomBox>>();
  private readonly neighboursOf = new WeakMap<LoadedModel, Map<number, number[]>>();
  private readonly statesOf = new WeakMap<Building, ApertureState[]>();
  private readonly shipNeighboursOf = new WeakMap<ShipInterior, Map<number, number[]>>();
  private states: ApertureState[] = [];

  // The doorway slots.
  private readonly slots: SlotState[] = [];
  private readonly unitToRoom: THREE.Matrix4[] = [];
  private selectTimer = Infinity;
  private readonly selectSun = new THREE.Vector3(0, -2, 0);
  private litCursor = 0;
  private dayFade = 0;
  private readonly travel = new THREE.Vector3(0, -1, 0);
  private readonly sunRadiance = new THREE.Color();
  private frozen = false;

  // The lamps: this frame's (by source order) and last frame's, matched by key.
  private lampSrc = 0;
  private readonly lampKey = new Int32Array(MAX_LAMPS);
  private readonly lampSight = new Float32Array(MAX_LAMPS);
  private readonly lampTarget = new Float32Array(MAX_LAMPS);
  private readonly lampNew = new Uint8Array(MAX_LAMPS);
  private readonly lampCell = new Int32Array(MAX_LAMPS);
  private readonly lampRange = new Float32Array(MAX_LAMPS);
  private readonly lampClamped = new Float32Array(MAX_LAMPS);
  private readonly lampCentre: THREE.Vector3[] = [];
  private readonly lampRgb: THREE.Color[] = [];
  private readonly lampHasBox = new Uint8Array(MAX_LAMPS);
  private readonly lampBox: M.RoomBox[] = [];
  private prevCount = 0;
  private readonly prevKey = new Int32Array(MAX_LAMPS);
  private readonly prevSight = new Float32Array(MAX_LAMPS);
  private readonly prevTarget = new Float32Array(MAX_LAMPS);
  private lampCursor = 0;
  private lampsFor: object | null = null;
  private lampsForCell = -2;
  private readonly shipPick = new Int16Array(SHIP_LAMPS);
  private readonly shipPickD = new Float32Array(SHIP_LAMPS);

  // The mote boxes.
  private moteTimer = Infinity;
  private moteCell = -2;
  private readonly nearIdx = new Int32Array(3);
  private readonly nearD = new Float32Array(3);
  private nearCount = 0;

  // Scratch.
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector4();
  private readonly m1 = new THREE.Matrix4();
  private readonly clipFromRoom = new THREE.Matrix4();
  private readonly basis: number[] = new Array(16).fill(0);
  private readonly tTravel: M.Vec3 = [0, -1, 0];
  private readonly tP: M.Vec3 = [0, 0, 0];
  private readonly tQ: M.Vec3 = [0, 0, 0];
  private readonly tBox: M.RoomBox = { min: [0, 0, 0], max: [0, 0, 0] };

  // Debug.
  private prisms: THREE.LineSegments | null = null;
  private lastSun: SunInfo | null = null;
  private lastOvercast = 0;
  private lastCell: number | null = null;
  private lastAim: { time: number; clock: string; facing: number; lit: number } | null | undefined = undefined;

  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly portals: PortalRenderer;
  private readonly settings: Settings;

  constructor(scene: THREE.Scene, world: World, portals: PortalRenderer, settings: Settings) {
    this.scene = scene;
    this.world = world;
    this.portals = portals;
    this.settings = settings;
    const mats = (n: number) => Array.from({ length: n }, () => new THREE.Matrix4());
    const vec4 = (n: number, x = 0, y = 0, z = 0, w = 0) => Array.from({ length: n }, () => new THREE.Vector4(x, y, z, w));
    const vec3 = (n: number) => Array.from({ length: n }, () => new THREE.Vector3());
    this.data = {
      mode: 'building',
      fade: 0,
      roomToWorld: new THREE.Matrix4(),
      worldToRoom: new THREE.Matrix4(),
      cameraRoom: new THREE.Vector3(),
      time: 0,
      shaftCount: 0,
      shaftsLit: false,
      shaftToUnit: mats(MAX_SHAFTS),
      shaftSize: vec4(MAX_SHAFTS, 1, 1, 1, this.tuning.soft),
      shaftBoxMin: vec3(MAX_SHAFTS),
      shaftBoxMax: vec3(MAX_SHAFTS),
      shaftLight: vec4(MAX_SHAFTS),
      shaftRect: vec4(MAX_SHAFTS),
      sunDirRoom: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      sunLight: 0,
      scatterBoost: 1,
      lampCount: 0,
      lampSightCount: 0,
      lampPos: vec4(MAX_LAMPS),
      lampColor: vec4(MAX_LAMPS),
      ambient: new THREE.Color(0, 0, 0),
      parallelColor: new THREE.Color(0, 0, 0),
      roomLuma: 0.25,
      hazeWeight: 0,
      moteBoxCount: 0,
      moteBoxMin: vec3(MAX_MOTE_BOXES),
      moteBoxMax: vec3(MAX_MOTE_BOXES),
      tuning: this.tuning,
      debugView: 0,
    };
    for (let i = 0; i < MAX_SHAFTS; i++) {
      this.slots.push({ state: null, weight: 0, target: 0, reach: 1 });
      this.unitToRoom.push(new THREE.Matrix4());
    }
    for (let j = 0; j < MAX_LAMPS; j++) {
      this.lampCentre.push(new THREE.Vector3());
      this.lampRgb.push(new THREE.Color());
      this.lampBox.push({ min: [0, 0, 0], max: [0, 0, 0] });
    }

    // The motes: the draw count and the seeds; the shader places them.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_MOTES * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(M.moteSeeds(MAX_MOTES), 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.tuning.moteSpan * 0.87 + 1);
    geo.setDrawRange(0, 0);
    const f = this.data;
    this.material = new THREE.ShaderMaterial({
      name: 'roomAir.motes',
      // Floats as strings with a decimal point: a bare 12 would be an int in GLSL, and clamp(float, float, int) does not compile.
      defines: { MAX_SHAFTS, MAX_LAMPS, MAX_BOXES: MAX_MOTE_BOXES, MOTE_MIN_PX: M.MOTE_MIN_PX.toFixed(1), MOTE_MAX_PX: M.MOTE_MAX_PX.toFixed(1), MOTE_KERNEL: M.MOTE_KERNEL.toFixed(1) },
      uniforms: {
        uTime: { value: 0 },
        uSpan: { value: this.tuning.moteSpan },
        uSize: { value: this.tuning.moteSize },
        uProjScale: { value: 1000 },
        uAlbedo: { value: this.tuning.moteAlbedo },
        uShaftGain: { value: this.tuning.moteShaftGain },
        uPhaseG: { value: this.tuning.phaseG },
        uCamRoom: { value: f.cameraRoom },
        uBoxCount: { value: 0 },
        uBoxMin: { value: f.moteBoxMin },
        uBoxMax: { value: f.moteBoxMax },
        uShaftCount: { value: 0 },
        uShaftToUnit: { value: f.shaftToUnit },
        uShaftSize: { value: f.shaftSize },
        uShaftBoxMin: { value: f.shaftBoxMin },
        uShaftBoxMax: { value: f.shaftBoxMax },
        uShaftLight: { value: f.shaftLight },
        uSunDirRoom: { value: f.sunDirRoom },
        uLampCount: { value: 0 },
        uLampPos: { value: f.lampPos },
        uLampColor: { value: f.lampColor },
        uAmbient: { value: f.ambient },
        uParallel: { value: f.parallelColor },
      },
      vertexShader: MOTES_VERT,
      fragmentShader: MOTES_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      lights: false,
    });
    const points = new THREE.Points(geo, this.material);
    points.name = 'roomAir.motes';
    points.matrixAutoUpdate = false;
    // Culling stays on, with a bounding sphere about the camera: the portal renderer's shadow pass
    // draws through a camera that sees every layer and every light and whose frustum holds nothing,
    // and an object that is never culled is drawn there anyway and compiles a variant lit by all of them.
    points.frustumCulled = true;
    points.renderOrder = 12;
    points.visible = false;
    // Drawn in the rooms' pass and again through the exits in the world's: nothing per building.
    points.layers.set(ACTOR_LAYER);
    this.points = points;
    // In the scene from the start (hidden), so the loading screen's warm-up compiles it, and in the
    // stencil from the start, so its first frame is clipped like everything else.
    scene.add(points);
    portals.registerMaterial(this.material);
  }

  /** This frame's data, or null unless the frame is drawn from inside the active room with fade above 0. */
  get frame(): RoomAirFrame | null {
    return this.visible ? this.data : null;
  }

  update(input: RoomAirInput): void {
    const dt = Math.min(Math.max(input.dt, 0), 0.1);
    this.clock += dt;
    const T = this.tuning;
    const S = M.readRoomAirSettings(this.settings, this.S);
    const wantShafts = S.effects && S.lightShafts && S.lightShaftStrength > 0;
    const wantGlow = S.effects && S.lightShafts && S.roomGlowStrength > 0;
    const wantMotes = S.roomMotes;
    const any = wantShafts || wantGlow || wantMotes;
    this.lastSun = input.sun;
    this.lastOvercast = input.overcast;

    // The room this frame is drawn from inside, if any. Aboard it keys on the camera being among the
    // rooms, not on being aboard: a pilot aboard with the chase camera would put motes in open air.
    const cell = input.cell;
    const buildingRoom = any && cell && cell.cell > 0 ? cell.building : null;
    let raw: Building | ShipInterior | null = null;
    if (buildingRoom && input.view === buildingRoom) raw = buildingRoom;
    else if (any && input.aboard && input.cameraInHull) raw = input.aboard;
    this.lastRaw = raw;
    this.lastCell = cell ? cell.cell : null;

    // Held: the raw room only once it has stood for HOLD_SECONDS, so a flip on the door line never restarts the fade.
    if (raw === this.held) this.holdTimer = 0;
    else {
      this.holdTimer += dt;
      if (this.holdTimer >= HOLD_SECONDS) {
        this.held = raw;
        this.holdTimer = 0;
      }
    }
    // Two rooms never blend: a new room starts from nothing.
    if (this.held !== null && this.held !== this.active) this.activate(this.held);
    const want = this.held !== null && this.held === this.active ? 1 : 0;
    this.fade = approach(this.fade, want, T.fadeRate * dt);
    if (this.fade <= 0 && this.held !== this.active) this.active = this.held;

    this.visible = this.active !== null && raw === this.active && this.fade > 0;
    if (!this.visible) {
      this.points.visible = false;
      if (this.prisms) this.prisms.visible = false;
      return;
    }

    const f = this.data;
    const room = this.active!;
    const ship = isShip(room) ? room : null;
    const building = ship ? null : (room as Building);
    f.mode = ship ? 'ship' : 'building';
    f.fade = this.fade;
    f.time += dt;
    if (ship) {
      ship.vehicle.group.updateWorldMatrix(true, false);
      f.roomToWorld.copy(ship.vehicle.group.matrixWorld);
      f.worldToRoom.copy(f.roomToWorld).invert();
    } else {
      f.roomToWorld.copy(building!.matrix);
      f.worldToRoom.copy(building!.inverse);
    }
    const cam = input.camera;
    f.cameraRoom.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(f.worldToRoom);
    this.clipFromRoom.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(f.roomToWorld);
    f.scatterBoost = 1 + T.dustScatter * input.dust;
    if (building) this.world.fillFxLights(this.lights);

    this.updateShafts(input, building, wantShafts || wantMotes, dt);
    this.updateLamps(input, building, ship, dt);
    f.hazeWeight = approach(f.hazeWeight, f.shaftsLit || f.lampSightCount > 0 ? 1 : 0, dt);
    this.updateMotes(input, building, ship, wantMotes, dt);
    this.updatePrisms();
  }

  /** A room becomes the active one: everything starts from nothing, and its caches are fetched. */
  private activate(room: Building | ShipInterior): void {
    this.active = room;
    this.fade = 0;
    const f = this.data;
    f.time = 0;
    f.hazeWeight = 0;
    for (let i = 0; i < MAX_SHAFTS; i++) this.freeSlot(i);
    f.shaftCount = 0;
    f.shaftsLit = false;
    this.prevCount = 0;
    this.lampsFor = null;
    this.selectTimer = Infinity;
    this.moteTimer = Infinity;
    this.moteCell = -2;
    this.frozen = false;
    this.states = isShip(room) ? [] : this.aperturesFor(room);
  }

  private aperturesFor(b: Building): ApertureState[] {
    let states = this.statesOf.get(b);
    if (!states) {
      states = this.exitsFor(b.model).map((a) => ({ a, lit: 0, litTarget: 0, tested: false, testedTime: 0, testedSun: new THREE.Vector3(), facing: 0, score: 0, picked: false }));
      this.statesOf.set(b, states);
    }
    return states;
  }

  private exitsFor(model: LoadedModel): M.ExitAperture[] {
    let exits = this.exitsOf.get(model);
    if (!exits) {
      exits = M.exitApertures(model.def);
      this.exitsOf.set(model, exits);
    }
    return exits;
  }

  private boxesFor(model: LoadedModel): Map<number, M.RoomBox> {
    let boxes = this.boxesOf.get(model);
    if (!boxes) {
      boxes = M.cellBoxes(model.def);
      this.boxesOf.set(model, boxes);
    }
    return boxes;
  }

  private neighboursFor(model: LoadedModel, cell: number): number[] {
    let map = this.neighboursOf.get(model);
    if (!map) this.neighboursOf.set(model, (map = new Map()));
    let list = map.get(cell);
    if (!list) map.set(cell, (list = M.neighbourCells(model.def, cell)));
    return list;
  }

  private shipNeighboursFor(ship: ShipInterior, cell: number): number[] {
    let map = this.shipNeighboursOf.get(ship);
    if (!map) this.shipNeighboursOf.set(ship, (map = new Map()));
    let list = map.get(cell);
    if (!list) map.set(cell, (list = ship.neighbourCells(cell)));
    return list;
  }

  private freeSlot(i: number): void {
    const s = this.slots[i];
    s.state = null;
    s.weight = 0;
    s.target = 0;
    this.data.shaftLight[i].set(0, 0, 0, 0);
  }

  // ---- The doorways' beams ----

  private updateShafts(input: RoomAirInput, building: Building | null, want: boolean, dt: number): void {
    const f = this.data;
    const T = this.tuning;
    const sun = input.sun;
    if (!building || !want) {
      // Aboard (no sun data in a hull, no windows that are portals) or nothing wants the beams.
      for (let i = 0; i < MAX_SHAFTS; i++) if (this.slots[i].state || f.shaftLight[i].w !== 0) this.freeSlot(i);
      f.shaftCount = 0;
      f.shaftsLit = false;
      this.dayFade = 0;
      return;
    }
    if (sun) {
      f.sunDirRoom.copy(sun.dir).transformDirection(f.worldToRoom);
      this.travel.copy(f.sunDirRoom).negate();
      this.tTravel[0] = this.travel.x;
      this.tTravel[1] = this.travel.y;
      this.tTravel[2] = this.travel.z;
      f.sunColor.copy(sun.color);
      // The cascades' light carries the sun's colour times its intensity, as the world is lit now.
      const s = this.lights.sky.sun;
      this.sunRadiance.copy(s.color);
      f.sunLight = s.luminance / Math.max(1e-4, luma(sun.color));
      this.dayFade = sun.intensity * M.smoothstep(0.02, 0.12, sun.dir.y) * (1 - T.overcastDim * input.overcast);
    } else this.dayFade = 0;

    // The selection: four times a second, on entering, or when the sun has moved; never while frozen.
    this.selectTimer += dt;
    if (!this.frozen) {
      if (!sun) {
        for (let i = 0; i < MAX_SHAFTS; i++) this.slots[i].target = 0;
      } else if (this.selectTimer >= 0.25 || sun.dir.dot(this.selectSun) < COS_025) {
        this.select(sun, f);
      }
    }

    // Sun visibility, one doorway a frame among those selected whose test has aged.
    if (sun && !this.frozen) {
      for (let n = 0; n < MAX_SHAFTS; n++) {
        const i = (this.litCursor + n) % MAX_SHAFTS;
        const st = this.slots[i].state;
        if (!st || st.facing <= 0) continue;
        if (this.clock - st.testedTime < 1 && sun.dir.dot(st.testedSun) >= COS_1) continue;
        this.testLit(st, sun.dir, f.roomToWorld);
        this.litCursor = i + 1;
        break;
      }
    }

    let count = 0;
    let lit = false;
    const soft = Math.max(1e-3, T.soft);
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const slot = this.slots[i];
      const st = slot.state;
      if (!st) continue;
      if (!this.frozen) {
        slot.weight = approach(slot.weight, slot.target, 3 * dt);
        st.lit = approach(st.lit, st.litTarget, 3 * dt);
      }
      if (slot.target === 0 && slot.weight <= 0) {
        // Faded out: its matrix, size, box and rect stay; its light goes.
        this.freeSlot(i);
        continue;
      }
      const a = st.a;
      M.shaftBasis(a, this.tTravel, slot.reach, this.basis);
      const u2r = this.unitToRoom[i].fromArray(this.basis);
      f.shaftToUnit[i].copy(u2r).invert();
      f.shaftSize[i].set(a.width, a.height, slot.reach, soft);
      f.shaftBoxMin[i].set(a.shaftBox.min[0], a.shaftBox.min[1], a.shaftBox.min[2]);
      f.shaftBoxMax[i].set(a.shaftBox.max[0], a.shaftBox.max[1], a.shaftBox.max[2]);
      const k = this.dayFade * st.lit * st.facing * slot.weight * this.fade;
      f.shaftLight[i].set(this.sunRadiance.r * k, this.sunRadiance.g * k, this.sunRadiance.b * k, k);
      this.rectOf(i, u2r, soft / a.width, soft / a.height, input);
      count = i + 1;
      if (k > 1e-4) lit = true;
    }
    f.shaftCount = count;
    f.shaftsLit = lit;
  }

  /** Pick the doorways worth a beam, keeping each one's slot while it stays picked. */
  private select(sun: SunInfo, f: RoomAirFrame): void {
    this.selectTimer = 0;
    this.selectSun.copy(sun.dir);
    const T = this.tuning;
    const states = this.states;
    const cam = f.cameraRoom;
    for (let k = 0; k < states.length; k++) {
      const st = states[k];
      st.picked = false;
      st.score = 0;
      st.facing = M.facing(st.a.inward, this.tTravel);
      if (st.facing <= 0) continue;
      const c = st.a.centroid;
      const d2 = (c[0] - cam.x) ** 2 + (c[1] - cam.y) ** 2 + (c[2] - cam.z) ** 2;
      if (d2 > T.exitRange * T.exitRange) continue;
      // Tested at once the first time, or after the sun has jumped: a shaded doorway never flashes a beam.
      if (!st.tested || sun.dir.dot(st.testedSun) < COS_5) {
        this.testLit(st, sun.dir, f.roomToWorld);
        st.lit = st.litTarget;
      }
      st.score = st.lit * st.facing * st.a.area / (1 + d2 / 100);
    }
    for (let i = 0; i < MAX_SHAFTS; i++) this.slots[i].target = 0;
    for (let n = 0; n < MAX_SHAFTS; n++) {
      let best: ApertureState | null = null;
      for (let k = 0; k < states.length; k++) {
        const st = states[k];
        if (!st.picked && st.score > 1e-6 && (!best || st.score > best.score)) best = st;
      }
      if (!best) break;
      best.picked = true;
      this.place(best);
    }
    // The reach follows the sun with the selection.
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const s = this.slots[i];
      if (s.state) s.reach = M.shaftReach(s.state.a, this.tTravel, MAX_REACH);
    }
  }

  /** Give a picked doorway its slot: the one it has, a free one, or the fading one with the least weight. */
  private place(st: ApertureState): void {
    let free = -1;
    let fading = -1;
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const s = this.slots[i];
      if (s.state === st) {
        s.target = 1;
        return;
      }
      if (!s.state) {
        if (free < 0) free = i;
      } else if (s.target === 0 && (fading < 0 || s.weight < this.slots[fading].weight)) fading = i;
    }
    const at = free >= 0 ? free : fading;
    if (at < 0) return;
    if (free < 0) this.freeSlot(at);
    const s = this.slots[at];
    s.state = st;
    s.weight = 0;
    s.target = 1;
  }

  /** Cast the five sun rays of a doorway from just outside it: the share that reach open sky is how much of it is lit. */
  private testLit(st: ApertureState, sunDir: THREE.Vector3, roomToWorld: THREE.Matrix4): void {
    const a = st.a;
    let clear = 0;
    const n = a.samples.length;
    for (let k = 0; k < n; k++) {
      const s = a.samples[k];
      this.v1.set(s[0] - a.inward[0] * 0.6, s[1] - a.inward[1] * 0.6, s[2] - a.inward[2] * 0.6).applyMatrix4(roomToWorld);
      if (!this.world.physics.outdoorBlocked(this.v1, sunDir, 200)) clear++;
    }
    st.litTarget = n ? clear / n : 0;
    st.tested = true;
    st.testedTime = this.clock;
    st.testedSun.copy(sunDir);
  }

  /** The prism's screen rectangle in uv, grown by two half-resolution texels; the whole screen when it reaches behind the camera. */
  private rectOf(i: number, u2r: THREE.Matrix4, ea: number, eb: number, input: RoomAirInput): void {
    const m = this.m1.multiplyMatrices(this.clipFromRoom, u2r);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    let behind = false;
    for (let c = 0; c < 8; c++) {
      this.v4.set(c & 1 ? 1 + ea : -ea, c & 2 ? 1 + eb : -eb, c & 4 ? 1 : 0, 1).applyMatrix4(m);
      if (this.v4.w < 0.05) {
        behind = true;
        break;
      }
      const u = (this.v4.x / this.v4.w) * 0.5 + 0.5;
      const v = (this.v4.y / this.v4.w) * 0.5 + 0.5;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const r = this.data.shaftRect[i];
    if (behind) {
      r.set(0, 0, 1, 1);
      return;
    }
    const h = Math.max(1, input.bufferHeight);
    const w = Math.max(1, h * input.camera.aspect);
    const gu = 4 / w;
    const gv = 4 / h;
    r.set(Math.max(0, minU - gu), Math.max(0, minV - gv), Math.min(1, maxU + gu), Math.min(1, maxV + gv));
  }

  // ---- The lamps ----

  private updateLamps(input: RoomAirInput, building: Building | null, ship: ShipInterior | null, dt: number): void {
    const f = this.data;
    const fade = this.fade;
    let n = 0;
    if (building) {
      const rooms = this.lights.rooms;
      if (rooms.lit && rooms.building === building) {
        if (this.lampsFor !== building || this.lampsForCell !== rooms.cell) {
          // A new lit cell. The world moved its pooled lamps this frame by their positions alone and
          // their world matrices, which the lamps are read from, follow when the scene is drawn: read
          // now they stand where the last cell had them. So this frame keeps last frame's lamps (none
          // on entering), and the next reads them all as new and tests each one's sight at once.
          const sameBuilding = this.lampsFor === building;
          this.lampsFor = building;
          this.lampsForCell = rooms.cell;
          this.prevCount = 0;
          if (!sameBuilding) this.clearLamps();
          f.ambient.copy(rooms.ambient).multiplyScalar(fade);
          f.parallelColor.copy(rooms.parallel.color).multiplyScalar(fade);
          f.roomLuma = Math.max(0.25, luma(f.ambient) + 0.5 * luma(f.parallelColor));
          return;
        }
        const boxes = this.boxesFor(building.model);
        for (let i = 0; i < rooms.pointCount && n < MAX_LAMPS; i++) {
          const p = rooms.points[i];
          const c = this.lampCentre[n].copy(p.position).applyMatrix4(f.worldToRoom);
          const box = p.cell >= 0 ? boxes.get(p.cell) : undefined;
          this.lampHasBox[n] = box ? 1 : 0;
          this.lampClamped[n] = 0;
          if (box) {
            M.shrinkBox(box, LAMP_INSET, this.lampBox[n]);
            this.clampInto(c, this.lampBox[n]);
            this.lampClamped[n] = Math.sqrt(this.v2.copy(p.position).applyMatrix4(f.worldToRoom).distanceToSquared(c));
          }
          this.lampKey[n] = i;
          this.lampCell[n] = p.cell;
          this.lampRange[n] = p.distance > 0 ? p.distance : 40;
          this.lampRgb[n].copy(p.color);
          n++;
        }
        f.ambient.copy(rooms.ambient).multiplyScalar(fade);
        f.parallelColor.copy(rooms.parallel.color).multiplyScalar(fade);
      } else {
        this.lampsFor = null;
        this.prevCount = 0;
        f.ambient.setRGB(0, 0, 0);
        f.parallelColor.setRGB(0, 0, 0);
      }
    } else if (ship) {
      if (this.lampsFor !== ship) {
        this.lampsFor = ship;
        this.lampsForCell = -1;
        this.prevCount = 0;
      }
      // The nearest three to the player, as the flash pool takes them (ties to the lower index).
      const L = ship.lights;
      const want = Math.min(SHIP_LAMPS, L.length);
      for (let k = 0; k < SHIP_LAMPS; k++) {
        this.shipPick[k] = -1;
        this.shipPickD[k] = Infinity;
      }
      for (let i = 0; i < L.length; i++) {
        const d = L[i].pos.distanceToSquared(input.playerPos);
        for (let k = 0; k < want; k++) {
          if (d < this.shipPickD[k]) {
            for (let m = want - 1; m > k; m--) {
              this.shipPickD[m] = this.shipPickD[m - 1];
              this.shipPick[m] = this.shipPick[m - 1];
            }
            this.shipPickD[k] = d;
            this.shipPick[k] = i;
            break;
          }
        }
      }
      for (let k = 0; k < want; k++) {
        const idx = this.shipPick[k];
        if (idx < 0) continue;
        const l = L[idx];
        const c = this.lampCentre[n].copy(l.pos);
        const box = l.cell !== undefined ? ship.cellBox(l.cell) : null;
        this.lampHasBox[n] = box ? 1 : 0;
        this.lampClamped[n] = 0;
        if (box) {
          const b = this.lampBox[n];
          b.min[0] = box.min.x;
          b.min[1] = box.min.y;
          b.min[2] = box.min.z;
          b.max[0] = box.max.x;
          b.max[1] = box.max.y;
          b.max[2] = box.max.z;
          M.shrinkBox(b, LAMP_INSET, b);
          this.clampInto(c, b);
          this.lampClamped[n] = c.distanceTo(l.pos);
        }
        this.lampKey[n] = idx;
        this.lampCell[n] = l.cell ?? -1;
        this.lampRange[n] = l.distance > 0 ? l.distance : 40;
        this.lampRgb[n].setHex(l.color).multiplyScalar(l.intensity);
        n++;
      }
      f.ambient.setRGB(SHIP_AMBIENT, SHIP_AMBIENT, SHIP_AMBIENT).multiplyScalar(fade);
      f.parallelColor.setRGB(0, 0, 0);
    }
    this.lampSrc = n;

    // Carry each lamp's sight over from last frame by its key; a lamp not seen last frame is new and tested now.
    for (let j = 0; j < n; j++) {
      let found = -1;
      for (let p = 0; p < this.prevCount; p++) {
        if (this.prevKey[p] === this.lampKey[j]) {
          found = p;
          break;
        }
      }
      if (found >= 0) {
        this.lampSight[j] = this.prevSight[found];
        this.lampTarget[j] = this.prevTarget[found];
        this.lampNew[j] = 0;
      } else {
        this.lampNew[j] = 1;
        this.lampTarget[j] = this.sightOf(j, input, building, ship) ? 1 : 0;
        this.lampSight[j] = this.lampTarget[j];
      }
    }
    // Then one more lamp a frame, round robin.
    if (n > 0) {
      for (let k = 0; k < n; k++) {
        const j = (this.lampCursor + k) % n;
        if (this.lampNew[j]) continue;
        this.lampTarget[j] = this.sightOf(j, input, building, ship) ? 1 : 0;
        this.lampCursor = j + 1;
        break;
      }
    }
    for (let j = 0; j < n; j++) this.lampSight[j] = approach(this.lampSight[j], this.lampTarget[j], 4 * dt);
    for (let j = 0; j < n; j++) {
      this.prevKey[j] = this.lampKey[j];
      this.prevSight[j] = this.lampSight[j];
      this.prevTarget[j] = this.lampTarget[j];
    }
    this.prevCount = n;

    // Packed: those in sight first (the pass loops over them only), the rest after (the motes still see them).
    let slot = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < n; j++) {
        const inSight = this.lampSight[j] > 0.001;
        if ((pass === 0) !== inSight) continue;
        const c = this.lampCentre[j];
        const rgb = this.lampRgb[j];
        f.lampPos[slot].set(c.x, c.y, c.z, this.lampRange[j]);
        f.lampColor[slot].set(rgb.r * fade, rgb.g * fade, rgb.b * fade, this.lampSight[j]);
        slot++;
      }
      if (pass === 0) f.lampSightCount = slot;
    }
    f.lampCount = n;
    for (let j = n; j < MAX_LAMPS; j++) f.lampColor[j].set(0, 0, 0, 0);
    f.roomLuma = Math.max(0.25, luma(f.ambient) + 0.5 * luma(f.parallelColor));
  }

  /** No lamps published: none glows and none lights a mote. */
  private clearLamps(): void {
    const f = this.data;
    this.lampSrc = 0;
    f.lampCount = 0;
    f.lampSightCount = 0;
    for (let j = 0; j < MAX_LAMPS; j++) f.lampColor[j].set(0, 0, 0, 0);
  }

  private clampInto(v: THREE.Vector3, b: M.RoomBox): void {
    v.set(Math.min(b.max[0], Math.max(b.min[0], v.x)), Math.min(b.max[1], Math.max(b.min[1], v.y)), Math.min(b.max[2], Math.max(b.min[2], v.z)));
  }

  /** Whether lamp j can be seen from the camera: a ray to a point just off its fixture, towards the camera, kept inside its room. */
  private sightOf(j: number, input: RoomAirInput, building: Building | null, ship: ShipInterior | null): boolean {
    const f = this.data;
    const c = this.lampCentre[j];
    const target = this.v1.subVectors(f.cameraRoom, c);
    const d = target.length();
    if (d < 1e-3) return true;
    target.multiplyScalar(Math.min(0.35, 0.5 * d) / d).add(c);
    if (this.lampHasBox[j]) this.clampInto(target, this.lampBox[j]);
    if (ship) return !ship.physics.segmentBlocked(f.cameraRoom, target, true);
    if (!building) return false;
    target.applyMatrix4(f.roomToWorld);
    this.v2.setFromMatrixPosition(input.camera.matrixWorld);
    return !this.world.physics.segmentBlocked(this.v2, target, true);
  }

  // ---- The motes ----

  private updateMotes(input: RoomAirInput, building: Building | null, ship: ShipInterior | null, want: boolean, dt: number): void {
    const f = this.data;
    const T = this.tuning;
    const S = this.S;
    this.points.visible = want;
    if (!want) return;
    // The boxes the motes fill: the room the player is in and the three nearest it opens onto.
    const cell = building ? (input.cell?.cell ?? 0) : ship!.cellAt(input.playerPos);
    this.moteTimer += dt;
    if (this.moteTimer >= 0.5 || cell !== this.moteCell) {
      this.moteTimer = 0;
      this.moteCell = cell;
      this.fillMoteBoxes(building, ship, cell);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, Math.round(Math.min(MAX_MOTES, T.moteCount * S.roomMoteAmount)));
    this.points.matrix.copy(f.roomToWorld);
    this.points.matrixWorld.copy(f.roomToWorld);
    const sphere = g.boundingSphere!;
    sphere.center.copy(f.cameraRoom);
    sphere.radius = T.moteSpan * 0.87 + 1;
    const u = this.material.uniforms;
    u.uTime.value = f.time;
    u.uSpan.value = T.moteSpan;
    u.uSize.value = T.moteSize;
    u.uProjScale.value = Math.max(1, input.bufferHeight) / (2 * Math.tan(THREE.MathUtils.degToRad(input.camera.fov) / 2));
    u.uAlbedo.value = T.moteAlbedo;
    u.uShaftGain.value = T.moteShaftGain * f.scatterBoost;
    u.uPhaseG.value = T.phaseG;
    u.uBoxCount.value = f.moteBoxCount;
    u.uShaftCount.value = f.shaftCount;
    u.uLampCount.value = f.lampCount;
  }

  private fillMoteBoxes(building: Building | null, ship: ShipInterior | null, cell: number): void {
    const f = this.data;
    let n = 0;
    const cam = f.cameraRoom;
    if (building) {
      const boxes = this.boxesFor(building.model);
      const own = boxes.get(cell);
      if (own) {
        f.moteBoxMin[n].set(own.min[0], own.min[1], own.min[2]);
        f.moteBoxMax[n].set(own.max[0], own.max[1], own.max[2]);
        n++;
        const list = this.neighboursFor(building.model, cell);
        this.nearCount = 0;
        for (let i = 0; i < 3; i++) this.nearD[i] = Infinity;
        for (let i = 0; i < list.length; i++) {
          const b = boxes.get(list[i]);
          if (b) this.consider(list[i], this.boxDistance(cam, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]));
        }
        for (let i = 0; i < this.nearCount && n < MAX_MOTE_BOXES; i++) {
          const b = boxes.get(this.nearIdx[i])!;
          f.moteBoxMin[n].set(b.min[0], b.min[1], b.min[2]);
          f.moteBoxMax[n].set(b.max[0], b.max[1], b.max[2]);
          n++;
        }
      }
    } else if (ship) {
      const own = cell > 0 ? ship.cellBox(cell) : null;
      if (own) {
        f.moteBoxMin[n].copy(own.min);
        f.moteBoxMax[n].copy(own.max);
        n++;
        const list = this.shipNeighboursFor(ship, cell);
        this.nearCount = 0;
        for (let i = 0; i < 3; i++) this.nearD[i] = Infinity;
        for (let i = 0; i < list.length; i++) {
          const b = ship.cellBox(list[i]);
          if (b) this.consider(list[i], this.boxDistance(cam, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z));
        }
        for (let i = 0; i < this.nearCount && n < MAX_MOTE_BOXES; i++) {
          const b = ship.cellBox(this.nearIdx[i])!;
          f.moteBoxMin[n].copy(b.min);
          f.moteBoxMax[n].copy(b.max);
          n++;
        }
      } else {
        // Between rooms, or rooms the model did not tell apart: the rooms' whole extent (kept 1.5 m wide of it).
        f.moteBoxMin[n].copy(ship.bounds.min).addScalar(1.5);
        f.moteBoxMax[n].copy(ship.bounds.max).addScalar(-1.5);
        n++;
      }
    }
    f.moteBoxCount = n;
  }

  /** Keep the three nearest rooms seen so far (nearIdx, nearD, nearCount), nearest first. */
  private consider(idx: number, d: number): void {
    for (let s = 0; s < 3; s++) {
      if (d < this.nearD[s]) {
        for (let m = 2; m > s; m--) {
          this.nearD[m] = this.nearD[m - 1];
          this.nearIdx[m] = this.nearIdx[m - 1];
        }
        this.nearD[s] = d;
        this.nearIdx[s] = idx;
        this.nearCount = Math.min(3, this.nearCount + 1);
        return;
      }
    }
  }

  private boxDistance(p: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
    const dx = Math.max(x0 - p.x, 0, p.x - x1);
    const dy = Math.max(y0 - p.y, 0, p.y - y1);
    const dz = Math.max(z0 - p.z, 0, p.z - z1);
    return Math.hypot(dx, dy, dz);
  }

  // ---- The console ----

  /** Wireframes of the beams' prisms, refreshed each visible frame while they are asked for. */
  private updatePrisms(): void {
    const lines = this.prisms;
    if (!lines) return;
    lines.visible = true;
    const pos = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let o = 0;
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const on = !!this.slots[i].state && this.data.shaftLight[i].w > 0;
      for (let e = 0; e < EDGES.length; e++) {
        const c = EDGES[e];
        if (on) {
          this.v1.set(c & 1 ? 1 : 0, c & 2 ? 1 : 0, c & 4 ? 1 : 0).applyMatrix4(this.unitToRoom[i]);
          arr[o] = this.v1.x;
          arr[o + 1] = this.v1.y;
          arr[o + 2] = this.v1.z;
        } else arr[o] = arr[o + 1] = arr[o + 2] = 0;
        o += 3;
      }
    }
    pos.needsUpdate = true;
    lines.matrix.copy(this.data.roomToWorld);
    lines.matrixWorld.copy(this.data.roomToWorld);
  }

  private setPrisms(on: boolean): void {
    if (on && !this.prisms) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SHAFTS * EDGES.length * 3), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
      const lines = new THREE.LineSegments(geo, mat);
      lines.name = 'roomAir.prisms';
      lines.matrixAutoUpdate = false;
      lines.frustumCulled = false;
      lines.renderOrder = 13;
      lines.visible = false;
      markActor(lines);
      this.portals.registerMaterial(mat);
      this.scene.add(lines);
      this.prisms = lines;
    } else if (!on && this.prisms) {
      const lines = this.prisms;
      this.scene.remove(lines);
      lines.geometry.dispose();
      const mat = lines.material as THREE.Material;
      this.portals.forget(mat);
      mat.dispose();
      this.prisms = null;
    }
  }

  /** Retune, switch the debug views, freeze the selection or aim the sun; then the listing. */
  debug(opts: RoomAirDebugOptions): RoomAirDescription {
    const T = this.tuning as unknown as Record<string, number>;
    for (const key of Object.keys(ROOM_AIR_TUNING)) {
      const v = (opts as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v)) T[key] = v;
    }
    if (opts.view !== undefined) this.data.debugView = opts.view === 'haze' ? 1 : opts.view === 'patch' ? 2 : 0;
    if (opts.showPrisms !== undefined) this.setPrisms(opts.showPrisms);
    if (opts.freeze !== undefined) this.frozen = opts.freeze;
    this.lastAim = opts.sunInto ? this.aimSun() : undefined;
    return this.describe();
  }

  /**
   * Set the time of day so the sun shines as straight as it can into the nearest doorway of the room
   * the camera is in, where it is not shaded outside; null (the time kept) when no doorway faces any
   * sun position there. When every time it faces is shaded outside, the best-facing one is set all
   * the same and `lit` comes back 0: the doorway faces the sun but something outside stands in it.
   */
  aimSun(): { time: number; clock: string; facing: number; lit: number } | null {
    const b = this.active && !isShip(this.active) ? this.active : null;
    if (!b) return null;
    const states = this.aperturesFor(b);
    if (!states.length) return null;
    const cam = this.data.cameraRoom;
    let st = states[0];
    let bestD = Infinity;
    for (const s of states) {
      const d = Math.hypot(s.a.centroid[0] - cam.x, s.a.centroid[1] - cam.y, s.a.centroid[2] - cam.z);
      if (d < bestD) {
        bestD = d;
        st = s;
      }
    }
    const day = this.world.day;
    const saved = day.time;
    const inv = new THREE.Matrix4().copy(b.inverse);
    const travel: M.Vec3 = [0, 0, 0];
    const tries: { t: number; score: number; facing: number }[] = [];
    for (let t = 0.26; t <= 0.94 + 1e-9; t += 0.004) {
      day.time = t;
      day.update(0, false);
      if (day.sunDir.y < 0.12) continue;
      const d = this.v1.copy(day.sunDir).transformDirection(inv).negate();
      travel[0] = d.x;
      travel[1] = d.y;
      travel[2] = d.z;
      const fc = M.facing(st.a.inward, travel);
      if (fc <= 0) continue;
      tries.push({ t, score: fc * Math.min(1, day.sunDir.y * 3), facing: fc });
    }
    tries.sort((x, y) => y.score - x.score);
    let best: { t: number; score: number; facing: number; lit: number } | null = null;
    const probe: ApertureState = { a: st.a, lit: 0, litTarget: 0, tested: false, testedTime: 0, testedSun: new THREE.Vector3(), facing: 0, score: 0, picked: false };
    for (const c of tries.slice(0, 10)) {
      day.time = c.t;
      day.update(0, false);
      this.testLit(probe, day.sunDir, b.matrix);
      const v = c.score * probe.litTarget;
      if (!best || v > best.score * best.lit || (best.lit === 0 && v === 0 && c.score > best.score)) best = { ...c, lit: probe.litTarget };
    }
    if (!best) {
      day.time = saved;
      day.update(0, false);
      return null;
    }
    day.time = best.t;
    day.update(0, false);
    // Tested again at once by the next selection, at the new sun.
    st.tested = false;
    this.selectTimer = Infinity;
    return { time: Number(best.t.toFixed(3)), clock: day.clock(), facing: Number(best.facing.toFixed(2)), lit: Number(best.lit.toFixed(2)) };
  }

  /** The listing of what the room's air is doing (debug only; allocates freely). */
  describe(): RoomAirDescription {
    const f = this.data;
    const room = this.active;
    const ship = isShip(room) ? room : null;
    const building = room && !ship ? (room as Building) : null;
    const r2 = (v: number) => Number(v.toFixed(2));
    const toWorld = (p: THREE.Vector3 | M.Vec3) => {
      const v = Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone();
      return v.applyMatrix4(f.roomToWorld).toArray().map(r2);
    };
    const sun = this.lastSun;
    const shafts: RoomAirDescription['shafts'] = [];
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const s = this.slots[i];
      if (!s.state) continue;
      const a = s.state.a;
      shafts.push({
        slot: i,
        portal: a.portal,
        cell: a.cell,
        cellName: a.cellName,
        size: [r2(a.width), r2(a.height)],
        reach: r2(s.reach),
        facing: r2(s.state.facing),
        lit: r2(s.state.lit),
        weight: r2(s.weight),
        decidedBy: a.decidedBy,
        rect: f.shaftRect[i].toArray().map(r2),
        inward: a.inward.map(r2),
        doorWorld: toWorld(a.centroid),
      });
    }
    const lamps: RoomAirDescription['lamps'] = [];
    for (let j = 0; j < this.lampSrc; j++) {
      lamps.push({
        slot: j,
        cell: this.lampCell[j] >= 0 ? this.lampCell[j] : null,
        at: toWorld(this.lampCentre[j]),
        clamped: r2(this.lampClamped[j]),
        range: r2(this.lampRange[j]),
        luminance: r2(luma(this.lampRgb[j])),
        sight: r2(this.lampSight[j]),
      });
    }
    const out: RoomAirDescription = {
      mode: room ? (ship ? 'ship' : 'building') : null,
      model: building ? building.model.def.id : ship ? ship.vehicle.spec.label : null,
      cell: building ? this.lastCell : ship && this.lastRaw === ship ? ship.cellAt(this.v1.copy(f.cameraRoom)) : null,
      inside: this.visible,
      held: this.held !== null && this.held === this.active,
      fade: r2(this.fade),
      sun: sun ? { dir: sun.dir.toArray().map(r2), daylight: r2(sun.intensity), light: r2(f.sunLight), overcast: r2(this.lastOvercast), dayFade: r2(this.dayFade) } : null,
      exits: building ? this.aperturesFor(building).length : 0,
      shafts,
      lamps,
      ambient: f.ambient.getHexString(),
      parallel: f.parallelColor.getHexString(),
      hazeWeight: r2(f.hazeWeight),
      motes: { on: this.S.roomMotes, visible: this.points.visible, drawn: this.points.visible ? this.points.geometry.drawRange.count : 0, boxes: f.moteBoxCount, span: this.tuning.moteSpan },
      tuning: { ...this.tuning },
    };
    if (this.lastAim !== undefined) out.aim = this.lastAim;
    return out;
  }

  dispose(): void {
    this.setPrisms(false);
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.portals.forget(this.material);
    this.material.dispose();
  }
}
