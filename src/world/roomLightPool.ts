// The rooms' one pool of lights (Map-maker II's wave of the rooms' lights): the lights three draws the rooms with, made once a
// shape and never added to or taken from the scene in play, and what puts a plan on them (`apply`) and moves them a frame
// (`step`). Out of `world.ts`, so a node test puts the very plan on the very lights the world does.
//
// **The one hard rule**: three keys every lit program on how many point, spot and directional lights a pass has and on how many
// of each cast shadows. So the shape -- the eight plain points the pool always had, the point slots that cast, the spot slots
// plain and casting -- is changed only by `setShape`, behind a loading screen or a curtain with the rebuild said in words, and
// nothing else here ever adds a light, takes one away or flips a `castShadow`. Every edit the owner makes inside the shape
// moves uniforms and places alone.
//
// **A casting slot's map is drawn only by the rooms' own shadow pass** (`PortalRenderer.renderRoomShadows`): its `autoUpdate`
// is false from the moment it is made and never written again, and that pass asks for the map of every casting slot a plan lit
// (`litCasters`), with the lit building's rooms and the bodies standing in them shown, apart from the sun's pass. A slot
// nothing lights stands at nought with its map kept. Every slot's map is made at the next shadow draw after it is
// (`firstMaps`, and every warm-up's draw of the stand-ins, `drawShadowsOnly`), because a casting light's sampler with no map
// behind it throws the whole draw away (the effects' lesson). Its shadow camera's far plane is never written here: three takes
// it from the light's `distance` and works the projection out again only when the two differ, so a far written beside the
// distance kept the projection of the first range the map was drawn at.
//
// **The room's parallel light never casts**: three's cascades read every casting directional light in a pass as one of the
// sun's (its `lights_fragment_begin` lights cascade i only within that cascade's band of depth), so a room's casting
// directional would light only the near cascade's sixteen metres. A directional's `shadow` is kept in the file, and counted
// where it asks (`left.shadowsRefused`).
//
// With the default shape (`DEFAULT_POOL`) and a plan with no edits, `apply` writes exactly the values the world's own lines
// wrote before the wave (held by a node test against them), and `step` writes nothing: no light flickers, none moves.
//
// Rule for this file (node runs it with type stripping): every value import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties, nothing that touches the page at load.

import * as THREE from 'three';
import { DEFAULT_POOL, ROOM_LIGHT_TUNE, type PlannedLamp, type PlannedParallel, type PoolShape, type RoomLightsPlanned } from './roomLights.ts';
import { FLICKER_TUNE, flickerAsk, flickerIn } from './lightFlicker.ts';

/**
 * The casting slots' own numbers (ours, technical rather than feel, live through `__debug.roomLights({ tune: { shadow } })`):
 * a point's six faces and a spot's one map at this many texels a side (read as a slot is made, so a new size takes the next
 * time the Graphics page's two settings build the pool again), their biases, and the near plane.
 */
export const ROOM_SHADOW_TUNE = {
  pointMap: 512,
  spotMap: 1024,
  pointBias: -0.004,
  spotBias: -0.0006,
  normalBias: 0.02,
  near: 0.1,
};

/** How many casting slots of each kind the Graphics page's setting builds, and how many spot slots; `roomPoolShape` makes the shape. */
export const ROOM_POOL_LIMITS = { spots: 4, shadows: 2 };

/**
 * The pool's shape for the Graphics page's two settings: `spots` spot slots in all, of which as many as `shadows` cast (never
 * more than there are spots), and `shadows` casting point slots beside the eight plain points. "Room lamps 2, Room light
 * shadows 1" is one plain spot, one casting spot and a casting point.
 */
export function roomPoolShape(spots: number, shadows: number): PoolShape {
  const s = Math.max(0, Math.min(ROOM_POOL_LIMITS.spots, Math.floor(spots)));
  const c = Math.max(0, Math.min(ROOM_POOL_LIMITS.shadows, Math.floor(shadows)));
  const sc = Math.min(c, s);
  return { points: DEFAULT_POOL.points, pointShadows: c, spots: s - sc, spotShadows: sc };
}

/** Whether two shapes are one. */
export function sameShape(a: Readonly<PoolShape>, b: Readonly<PoolShape>): boolean {
  return a.points === b.points && a.pointShadows === b.pointShadows && a.spots === b.spots && a.spotShadows === b.spotShadows;
}

/** A slot lit by a plan: what it holds, so a frame can move it. */
interface Slot {
  light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;
  /** The key of what it holds ('' unlit), the cell it came from (-1 unlit). */
  key: string;
  cell: number;
  /** Its intensity as planned, before its flicker. */
  base: number;
  flicker: number;
  rate: number;
  depth: number;
  seed: number;
  /** Where it stands and shines in the building's frame (a light the editor's hand moves is written from these). */
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** A matrix it follows a frame (a light hung on a row: its attachment's own), with its own place in it; null for none. */
  follow: THREE.Matrix4 | null;
}

/** The seconds a frame flickers by, a class so its number is held in place (an object literal's may be boxed at each write). */
export class LightClock {
  t = 0.5;
}

const tPos = new THREE.Vector3();
const tDir = new THREE.Vector3();

/** The pool. One a world, made with it; its eight points, parallel and ambient are the world's own. */
export class RoomLightPool {
  readonly points: THREE.PointLight[];
  readonly parallel: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;
  pointShadows: THREE.PointLight[] = [];
  spots: THREE.SpotLight[] = [];
  spotShadows: THREE.SpotLight[] = [];
  shape: PoolShape = { ...DEFAULT_POOL };
  /** Every slot that is not a plain point, in the order the plan fills them: casting points, spots, casting spots. */
  private extra: Slot[] = [];
  /** The plain points' and the parallel light's slots. */
  private readonly pointSlots: Slot[];
  private parallelSlot: Slot;
  /**
   * The casting slots (`casters()`, kept: the rooms' shadow pass walks it a frame), and of them the ones the last plan lit, the
   * first `litN` of `litCasters` (the slots whose maps that pass draws). Made again by `setShape`; nothing is made a frame.
   */
  casterList: (THREE.PointLight | THREE.SpotLight)[] = [];
  litCasters: (THREE.PointLight | THREE.SpotLight)[] = [];
  litN = 0;
  /** Whether any lit slot flickers or follows something (a frame has work to do). */
  private moving = false;
  /** The building's matrix the last plan was put on with (a frame's move reads it). */
  private readonly matrix = new THREE.Matrix4();
  private readonly ask = flickerAsk();
  /** The cell each of the other slots was lit from, in their order (casting points, spots, casting spots), -1 unlit: the effects' read. */
  readonly cellsOfExtra = new Int32Array(16).fill(-1);
  /** The light the world editor's hand is moving now, by key, and where it stands in the building's frame ('' for none). */
  liveKey = '';
  readonly livePos = new THREE.Vector3();
  readonly liveDir = new THREE.Vector3(0, -1, 0);
  /** The shared clock's seconds a frame flickers by, written in place (SharedClock.walkSecondsIn): a fraction from the start. */
  readonly clock = new LightClock();

  constructor(points: THREE.PointLight[], parallel: THREE.DirectionalLight, ambient: THREE.AmbientLight) {
    this.points = points;
    this.parallel = parallel;
    this.ambient = ambient;
    this.pointSlots = points.map((l) => slot(l));
    this.parallelSlot = slot(parallel);
  }

  /** Every light of the pool (the shape's), for whatever must walk them all: the dimming, the console. */
  all(): THREE.Light[] {
    return [...this.points, ...this.pointShadows, ...this.spots, ...this.spotShadows, this.parallel];
  }

  /**
   * The shape changed (the Graphics page's two settings), its lights added to or taken from `scene` on `layer`: **only behind
   * a loading screen or a curtain**, whose sweep builds every program again. Answers whether anything changed.
   */
  setShape(shape: PoolShape, scene: THREE.Object3D, layer: number): boolean {
    if (sameShape(shape, this.shape)) return false;
    this.clear();
    const resize = <L extends THREE.Light>(list: L[], n: number, make: () => L): L[] => {
      while (list.length > n) {
        const l = list.pop()!;
        scene.remove(l);
        if ((l as unknown as { target?: THREE.Object3D }).target) scene.remove((l as unknown as { target: THREE.Object3D }).target);
        l.dispose();
      }
      while (list.length < n) {
        const l = make();
        l.layers.set(layer);
        scene.add(l);
        const target = (l as unknown as { target?: THREE.Object3D }).target;
        if (target) {
          target.layers.set(layer);
          scene.add(target);
        }
        list.push(l);
      }
      return list;
    };
    const T = ROOM_SHADOW_TUNE;
    resize(this.pointShadows, shape.pointShadows, () => {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.castShadow = true;
      l.shadow.mapSize.set(T.pointMap, T.pointMap);
      l.shadow.bias = T.pointBias;
      l.shadow.normalBias = T.normalBias;
      l.shadow.camera.near = T.near;
      l.shadow.autoUpdate = false;
      return l;
    });
    resize(this.spots, shape.spots, () => new THREE.SpotLight(0xffffff, 0, 1, Math.PI / 6, 0, 2));
    resize(this.spotShadows, shape.spotShadows, () => {
      const l = new THREE.SpotLight(0xffffff, 0, 1, Math.PI / 6, 0, 2);
      l.castShadow = true;
      l.shadow.mapSize.set(T.spotMap, T.spotMap);
      l.shadow.bias = T.spotBias;
      l.shadow.normalBias = T.normalBias;
      l.shadow.camera.near = T.near;
      l.shadow.autoUpdate = false;
      return l;
    });
    this.extra = [...this.pointShadows.map((l) => slot(l)), ...this.spots.map((l) => slot(l)), ...this.spotShadows.map((l) => slot(l))];
    this.casterList = [...this.pointShadows, ...this.spotShadows];
    this.litCasters = new Array(this.casterList.length);
    this.litN = 0;
    this.shape = { ...shape };
    this.firstMaps();
    return true;
  }

  /** Every casting slot's map drawn once at the next shadow draw (the warm-up's), then held: a sampler with no map throws the draw away. */
  firstMaps(): void {
    for (const l of this.casterList) l.shadow.needsUpdate = true;
  }

  /** The casting slots. */
  casters(): (THREE.PointLight | THREE.SpotLight)[] {
    return [...this.casterList];
  }

  /**
   * The light the world editor's hand is moving (the lights tool's live record: its key, its place and way in the lit
   * building's frame), taken field by field so no number crosses a call a frame (`Vector3.set` takes them across one, which
   * the compiler leaves out of a full method on some compiles); an empty key lets it go. Answers whether a held light was let
   * go, so the world plans the lit room again and the light stands where the plan stood it.
   */
  takeLive(l: { readonly key: string; readonly x: number; readonly y: number; readonly z: number; readonly dx: number; readonly dy: number; readonly dz: number }): boolean {
    if (!l.key) {
      if (!this.liveKey) return false;
      this.liveKey = '';
      return true;
    }
    this.liveKey = l.key;
    const p = this.livePos;
    p.x = l.x;
    p.y = l.y;
    p.z = l.z;
    const d = this.liveDir;
    d.x = l.dx;
    d.y = l.dy;
    d.z = l.dz;
    return false;
  }

  /** Whether a frame has anything to do: a lit slot flickers or follows something, or the editor's hand holds one. */
  get needsStep(): boolean {
    return this.moving || this.liveKey !== '';
  }

  /** Whether any casting slot is lit now (the rooms' shadow pass then draws its map with the lit building's rooms): `litN` above nought. */
  get casting(): boolean {
    return this.litN > 0;
  }

  /** Every light at nought and every slot unlit: no room is lit. */
  clear(): void {
    for (const s of this.pointSlots) unlight(s);
    unlight(this.parallelSlot);
    for (const s of this.extra) unlight(s);
    this.cellsOfExtra.fill(-1);
    this.ambient.intensity = 0;
    this.moving = false;
    this.litN = 0;
  }

  /**
   * A plan put on the lights, in the building's frame `matrix`: the parallel light, the plain points in their order, every other
   * slot by type, the ambient. What it writes for a plan with no edits on the default shape is what the world wrote before the
   * wave, to the bit. `cells` answers each plain point's cell (the effects' lamp cells), -1 for one unlit. Allocates nothing past
   * what it holds; called when the plan is made, never a frame.
   */
  apply(plan: RoomLightsPlanned, matrix: THREE.Matrix4, cells: number[]): void {
    this.clear();
    cells.fill(-1);
    this.matrix.copy(matrix);
    const T = ROOM_LIGHT_TUNE;
    const p = plan.parallel;
    if (p) this.putParallel(p, this.parallelSlot, matrix);
    for (let i = 0; i < plan.points.length && i < this.pointSlots.length; i++) {
      const pt = plan.points[i];
      cells[i] = pt.cell;
      this.putLamp(this.pointSlots[i], pt, matrix, 9 * pt.at3 * T.lightScale);
    }
    let k = 0;
    for (let i = 0; i < plan.pointShadows.length && i < this.pointShadows.length; i++) this.putLamp(this.extra[k + i], plan.pointShadows[i], matrix, 9 * plan.pointShadows[i].at3 * T.lightScale);
    k += this.pointShadows.length;
    for (let i = 0; i < plan.spots.length && i < this.spots.length; i++) this.putLamp(this.extra[k + i], plan.spots[i], matrix, 9 * plan.spots[i].at3 * T.lightScale);
    k += this.spots.length;
    for (let i = 0; i < plan.spotShadows.length && i < this.spotShadows.length; i++) this.putLamp(this.extra[k + i], plan.spotShadows[i], matrix, 9 * plan.spotShadows[i].at3 * T.lightScale);
    for (let i = 0; i < this.extra.length && i < this.cellsOfExtra.length; i++) this.cellsOfExtra[i] = this.extra[i].cell;
    this.ambient.color.setRGB(plan.ambient[0], plan.ambient[1], plan.ambient[2]);
    this.ambient.intensity = T.ambientScale;
  }

  private putParallel(p: PlannedParallel, s: Slot, matrix: THREE.Matrix4): void {
    const light = s.light as THREE.DirectionalLight;
    tPos.set(p.pos[0], p.pos[1], p.pos[2]).applyMatrix4(matrix);
    tDir.set(p.dir[0], p.dir[1], p.dir[2]).transformDirection(matrix);
    light.color.setRGB(p.color[0], p.color[1], p.color[2]);
    // A share of one is the game's own intensity exactly (the tune's times one).
    light.intensity = p.scale === 1 ? ROOM_LIGHT_TUNE.parallel : ROOM_LIGHT_TUNE.parallel * p.scale;
    light.position.copy(tPos).addScaledVector(tDir, -ROOM_LIGHT_TUNE.parallelBack);
    light.target.position.copy(tPos);
    s.key = p.key;
    s.cell = p.cell;
    s.base = light.intensity;
    s.pos.set(p.pos[0], p.pos[1], p.pos[2]);
    s.dir.set(p.dir[0], p.dir[1], p.dir[2]);
    this.motion(s, p.flicker, p.rate, p.depth, p.seed);
  }

  private putLamp(s: Slot, pt: PlannedLamp, matrix: THREE.Matrix4, intensity: number): void {
    const light = s.light as THREE.PointLight | THREE.SpotLight;
    light.color.setRGB(pt.color[0], pt.color[1], pt.color[2]);
    light.intensity = intensity;
    light.distance = pt.range;
    if (light.decay !== pt.decay) light.decay = pt.decay;
    light.position.set(pt.pos[0], pt.pos[1], pt.pos[2]).applyMatrix4(matrix);
    if ((light as THREE.SpotLight).isSpotLight) {
      const spot = light as THREE.SpotLight;
      spot.angle = pt.angle;
      spot.penumbra = pt.penumbra;
      tDir.set(pt.dir[0], pt.dir[1], pt.dir[2]).transformDirection(matrix);
      spot.target.position.copy(light.position).add(tDir);
      spot.target.updateMatrixWorld();
    }
    // A casting slot lit: its map drawn by the rooms' own shadow pass from now on (`litCasters`). Its shadow camera's far plane
    // is three's to set, from the `distance` above: written here beside it, three's own test of the two never found them apart
    // and the projection kept the far of the first range the map was drawn at.
    if (light.castShadow) this.litCasters[this.litN++] = light;
    s.key = pt.key;
    s.cell = pt.cell;
    s.base = intensity;
    s.pos.set(pt.pos[0], pt.pos[1], pt.pos[2]);
    s.dir.set(pt.dir[0], pt.dir[1], pt.dir[2]);
    this.motion(s, pt.flicker, pt.rate, pt.depth, pt.seed);
  }

  private motion(s: Slot, flicker: number, rate: number, depth: number, seed: number): void {
    s.flicker = flicker;
    s.rate = rate;
    s.depth = depth;
    s.seed = seed;
    if (flicker !== 0 && depth > 0) this.moving = true;
  }

  /** A slot told to follow a matrix (a light hung on a row: its attachment's own world matrix), by key; answers whether it found one. */
  follow(key: string, m: THREE.Matrix4 | null): boolean {
    let found = false;
    const visit = (s: Slot): void => {
      if (s.key !== key) return;
      s.follow = m;
      found = true;
    };
    for (const s of this.pointSlots) visit(s);
    for (const s of this.extra) visit(s);
    if (m && found) this.moving = true;
    return found;
  }

  /**
   * A frame (after the plan is on): every flickering slot's intensity from its own clock and seed at the shared clock's
   * `seconds`, a slot following a matrix moved with it, and the light the editor's hand moves (`liveKey`) put where the hand
   * has it. Nothing is made; with nothing flickering, following or held, nothing is written.
   */
  step(seconds = Number.NaN): void {
    // The shared clock's seconds in a kept record (`clock.t`, written by the world from its one read of the clock a frame,
    // `World.readWalk`), so no number crosses a call a frame; a number handed in (a test, the console) is written there first.
    if (seconds === seconds) this.clock.t = seconds;
    if (!this.moving && !this.liveKey) return;
    for (let i = 0; i < this.pointSlots.length; i++) this.stepSlot(this.pointSlots[i]);
    for (let i = 0; i < this.extra.length; i++) this.stepSlot(this.extra[i]);
    this.stepSlot(this.parallelSlot);
  }

  private stepSlot(s: Slot): void {
    if (!s.key) return;
    if (s.flicker !== 0) {
      const a = this.ask;
      a.code = s.flicker;
      a.rate = s.rate;
      a.depth = s.depth;
      a.seed = s.seed;
      a.t = this.clock.t;
      flickerIn(a);
      s.light.intensity = s.base * a.out;
    }
    const live = this.liveKey !== '' && s.key === this.liveKey;
    if (!live && !s.follow) return;
    const light = s.light;
    if (live) light.position.copy(this.livePos).applyMatrix4(this.matrix);
    else light.position.setFromMatrixPosition(s.follow!);
    const dir = live ? this.liveDir : null;
    if ((light as THREE.SpotLight).isSpotLight || (light as THREE.DirectionalLight).isDirectionalLight) {
      const target = (light as THREE.SpotLight | THREE.DirectionalLight).target;
      if (dir) tDir.copy(dir).transformDirection(this.matrix);
      else if (s.follow) tDir.set(0, -1, 0).transformDirection(s.follow);
      else tDir.copy(s.dir).transformDirection(this.matrix);
      if ((light as THREE.DirectionalLight).isDirectionalLight) {
        target.position.copy(light.position);
        // Written out (three's `addScaledVector` takes the scale across a call, boxed where it is left out).
        const back = ROOM_LIGHT_TUNE.parallelBack;
        const lp = light.position;
        lp.x -= tDir.x * back;
        lp.y -= tDir.y * back;
        lp.z -= tDir.z * back;
      } else target.position.copy(light.position).add(tDir);
      target.updateMatrixWorld();
    }
  }

  /**
   * The casting slots' biases and near plane written again from `ROOM_SHADOW_TUNE` (a console move of them): uniforms alone,
   * nothing compiles. A map's size is read only as a slot is made (the next curtain).
   */
  retuneShadows(): void {
    const T = ROOM_SHADOW_TUNE;
    for (const l of this.pointShadows) {
      l.shadow.bias = T.pointBias;
      l.shadow.normalBias = T.normalBias;
      l.shadow.camera.near = T.near;
      l.shadow.camera.updateProjectionMatrix();
    }
    for (const l of this.spotShadows) {
      l.shadow.bias = T.spotBias;
      l.shadow.normalBias = T.normalBias;
      l.shadow.camera.near = T.near;
      l.shadow.camera.updateProjectionMatrix();
    }
    // The lit ones' maps are drawn again by the rooms' shadow pass at the next frame whatever moved; an unlit one's at its next.
  }

  /** What each slot holds, for the console: its kind, key, cell, intensity as planned and now, and whether it casts. */
  report(): { kind: string; key: string; cell: number; base: number; now: number; casting: boolean }[] {
    const out: { kind: string; key: string; cell: number; base: number; now: number; casting: boolean }[] = [];
    const add = (kind: string, s: Slot): void => {
      if (!s.key) return;
      const l = s.light as THREE.Light & { castShadow: boolean };
      out.push({ kind, key: s.key, cell: s.cell, base: round(s.base), now: round(l.intensity), casting: !!l.castShadow });
    };
    add('parallel', this.parallelSlot);
    for (const s of this.pointSlots) add('point', s);
    for (const s of this.extra) add((s.light as THREE.SpotLight).isSpotLight ? 'spot' : 'point', s);
    return out;
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function slot(light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight): Slot {
  return { light, key: '', cell: -1, base: 0.5, flicker: 0, rate: 0.5, depth: 0.5, seed: 0, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), follow: null };
}

function unlight(s: Slot): void {
  s.light.intensity = 0;
  s.key = '';
  s.cell = -1;
  s.flicker = 0;
  s.follow = null;
}

/** Each live number the console and the sliders may move, with the range it is held to (ours: no number past it reads sensibly). */
const ROOM_LIGHT_RANGES: Record<string, [number, number]> = {
  lightScale: [0, 100],
  ambientScale: [0, 20],
  ambientFloor: [0, 2],
  parallel: [0, 20],
  parallelBack: [0, 500],
};
const FLICKER_RANGES: Record<string, [number, number]> = {
  candleFine: [0, 1],
  candleFineRate: [0, 30],
  strobeLit: [0.01, 0.99],
  brokenShare: [0, 1],
  brokenDrop: [0, 1],
  brokenStutter: [0, 30],
};
const SHADOW_RANGES: Record<string, [number, number]> = {
  pointMap: [64, 4096],
  spotMap: [64, 4096],
  pointBias: [-0.1, 0.1],
  spotBias: [-0.1, 0.1],
  normalBias: [0, 1],
  near: [0.01, 5],
};

/** One group of numbers moved: each key the target has, a number, held to its range; anything else said back. */
function tuneGroup(target: Record<string, number>, ranges: Record<string, [number, number]>, part: unknown, name: string, said: string[]): boolean {
  if (!part || typeof part !== 'object' || Array.isArray(part)) {
    said.push(`${name} takes { ${Object.keys(ranges).join(', ')} }`);
    return false;
  }
  let moved = false;
  for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
    const r = ranges[k];
    if (!r) {
      said.push(`${name} has no ${k}: ${Object.keys(ranges).join(', ')}`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${name}.${k} takes a number`);
      continue;
    }
    const held = Math.max(r[0], Math.min(r[1], v));
    if (held !== v) said.push(`${name}.${k} held to ${held} (its range is ${r[0]} to ${r[1]})`);
    if (target[k] !== held) {
      target[k] = held;
      moved = true;
    }
  }
  return moved;
}

/**
 * `__debug.roomLights({ tune })` (Map-maker II's wave of the rooms' lights): the rooms' global dials moved in memory, never
 * saved -- `lightScale`, `ambientScale`, `ambientFloor`, `parallel`, `parallelBack` (`ROOM_LIGHT_TUNE`), `flicker: { ... }`
 * (`FLICKER_TUNE`) and `shadow: { ... }` (`ROOM_SHADOW_TUNE`; the maps' sizes take the next curtain). Every move plans the lit
 * room again (`version`), uniforms and places alone; `pool` writes a moved shadow number onto the casting slots standing.
 * Answers what was said.
 */
export function tuneRoomLights(partial: unknown, pool?: RoomLightPool | null): string[] {
  const said: string[] = [];
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return [`tune takes { ${Object.keys(ROOM_LIGHT_RANGES).join(', ')}, flicker: {...}, shadow: {...} }`];
  const o = { ...(partial as Record<string, unknown>) };
  let moved = false;
  if ('flicker' in o) {
    if (tuneGroup(FLICKER_TUNE as unknown as Record<string, number>, FLICKER_RANGES, o.flicker, 'flicker', said)) moved = true;
    delete o.flicker;
  }
  if ('shadow' in o) {
    if (tuneGroup(ROOM_SHADOW_TUNE as unknown as Record<string, number>, SHADOW_RANGES, o.shadow, 'shadow', said)) {
      moved = true;
      pool?.retuneShadows();
      const s = o.shadow as Record<string, unknown>;
      if ('pointMap' in s || 'spotMap' in s) said.push("a shadow map's size is read as a slot is made: it takes the next time the Graphics page's Room lamps or Room light shadows builds the pool again");
    }
    delete o.shadow;
  }
  if (Object.keys(o).length && tuneGroup(ROOM_LIGHT_TUNE as unknown as Record<string, number>, ROOM_LIGHT_RANGES, o, 'tune', said)) moved = true;
  if (moved) ROOM_LIGHT_TUNE.version++;
  return said;
}

/** The rooms' global dials and the casting slots' numbers as they shipped, for the sliders' "as shipped". */
export const ROOM_LIGHT_TUNE_SHIPPED: Readonly<Record<string, number>> = { ...ROOM_LIGHT_TUNE };
export const ROOM_SHADOW_TUNE_SHIPPED: Readonly<Record<string, number>> = { ...ROOM_SHADOW_TUNE };