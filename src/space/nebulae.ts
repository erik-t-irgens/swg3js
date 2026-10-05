// A space zone's nebulae: the clouds of glowing and misty sheets the zone's own table places, the
// haze that comes up around the camera inside one, the lightning that flickers in it, and whom a
// strike touches.
//
// Lightning follows the game's own rule (restated in `nebulaMath.ts`): a strike is a bolt standing
// between two points in the middle of the nebula for a second or two, and it touches every ship it
// passes, the player's or anybody's, which almost never happens, since the bolt is short and the
// nebula is large. A strike is kept apart from the bolt drawn for it: a pool of records sized from
// the zone's own rows (`strikeRecords`) holds every strike standing whether or not anybody can see
// it, and a ship far from the camera is struck all the same. The drawn bolts are a pool of `beams`
// taken by the strikes near enough to be seen. How a strike hurts is the ship's own business
// (`ShipCombat.lightning`: one shield, a rest between).
//
// What is drawn is two instanced sets for the whole zone, one per sheet look: the glow set added to
// the picture, the mist set blended into it. A sheet is one quad; `facingPercent` of them turn to
// face the camera and the rest keep the turn they were built with. Both sets are depth-tested and
// write no depth, are unlit, cast nothing, are never wet and are not movers. The whole zone
// therefore costs two draw calls, plus the haze while the camera is inside a nebula and at most two
// bolts. The real cost is not the calls but the fill: from inside, kilometre-wide sheets can each
// cover the screen, so a sheet fades out as it grows past a share of the screen's height and the
// haze stands in for the ones the camera is among.
//
// Distance. The farthest nebula edges in a zone sit well past the camera's 9 km far plane, so a
// nebula whose middle is beyond `pullFrom` is scaled toward the camera by that ratio in the vertex
// program. Scaling a whole nebula about the camera keeps its picture exactly as it was, only
// nearer, so nothing about it changes but the depth it is tested at. It is our reading of the
// client's far and near appearances, and `nebulaMath.ts` holds the arithmetic and the test.
//
// Nothing here compiles on a live frame: every material exists from the moment the zone's nebulae
// are built, which is behind the loading screen, so the world's warm-up finds them in the scene.
// Nothing is allocated per frame; the mist set's far-to-near sort writes into buffers made once.
import * as THREE from 'three';
import type { Nebula, NebulaSheetLook, SpacePack } from './spaceData.ts';
import {
  BUILD_ONLY_KEYS,
  NEBULA_SYSTEMS,
  NEBULA_TUNE,
  beamCurves,
  beamEnvelope,
  buildSheets,
  clampOpacity,
  deepestInside,
  dimInside,
  newStrike,
  rowStrikes,
  seedOfName,
  seenDepth,
  segmentReach,
  shareSheets,
  sheetCount,
  sortFarToNear,
  strikeDamage,
  strikeOfTick,
  strikeRecords,
  strikesBetween,
  tickOf,
  type InsideAt,
  type NebulaStrike,
  type NebulaTune,
  type SegmentReach,
  type SystemFactors,
} from './nebulaMath.ts';
import { setViewShake } from '../core/camera.ts';
import { targetable } from './shipCombat.ts';

/**
 * How many floats one sheet carries in a set's `source`: the fields in the order `makeSet` adds
 * them (centre 3, its nebula's middle 3, size 1, colour 4, facing 1, right 3, up 3), which is the
 * order the sort reads and writes them back in.
 */
const SHEET_FLOATS = 18;

/**
 * A ship as the lightning sees it: a ship contact in the game, a stub in the node test. Only what a
 * strike reads: whether it may be struck at all, where it is and how big, and its fight.
 */
export interface NebulaShip {
  readonly label: string;
  readonly dead: boolean;
  readonly vehicle: { readonly ghosted: boolean; readonly held: boolean; readonly pos: THREE.Vector3; readonly radius: number };
  readonly combat: { readonly lightningReady: boolean; readonly nebula: SystemFactors; lightning(amount: number, at: THREE.Vector3): boolean } | null;
  /** How many nebulae hold it, as its own record was last worked out. */
  readonly nebula: { readonly inside: number };
}

/** What a nebula set needs from the game: the effects, the pooled lights and the ships. */
export interface NebulaeDeps {
  /** Place one of the strike's own effects, transient, in the world's frame; null when it could not be. */
  place(file: string, matrix: THREE.Matrix4): unknown | null;
  remove(handle: unknown): void;
  /** Borrow one light from the pool for a strike. */
  flash(at: THREE.Vector3, colour: number, intensity: number, distance: number, seconds: number): void;
  /** Every ship that fights in the world: the ones a strike may touch. */
  ships(): readonly NebulaShip[];
  /** A strike on a ship, its nearest point on the bolt at `at`: the ship's own path decides what it takes. False when it was refused (resting, or gone). */
  strike(ship: NebulaShip, amount: number, at: THREE.Vector3): boolean;
  /** The ship the player flies, or null: what `bendWithin` aims at, and what the console's strike goes through. */
  playerShip(): NebulaShip | null;
  /** Whether nebula lightning may hurt a ship at all: the player's own setting. */
  damageEnabled(): boolean;
  /**
   * How solid the player wants the nebulae, 0 to 1 (the Graphics page's Nebula opacity): the sheets,
   * the haze and the dimming of the flare and the rays all take it, as uniforms. Left out it is 1.
   * Kept apart from `NEBULA_TUNE.alpha`, so the console's knob and the slider never overwrite each other.
   */
  opacity?(): number;
  /**
   * Milliseconds on the clock the weather reads (the server's while one answers, this machine's wall
   * clock with no server set). The strikes are timed on it, so two browsers see the same ones.
   */
  now(): number;
  /** How a picture is loaded; the game leaves it out and three's own loader is used. A node check hands its own. */
  texture?: (url: string) => Promise<THREE.Texture | null>;
}

/** One sheet set: everything one look owns. */
interface SheetSet {
  look: 'glow' | 'mist';
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.ShaderMaterial;
  /** How many sheets its buffers hold; the zone's whole cap, so the count can move without making one. */
  capacity: number;
  count: number;
  /** The sheets as they were built, never reordered: the sort reads from here and writes the attribute. */
  source: Float32Array;
  data: THREE.InstancedBufferAttribute[];
  /** The mist set is sorted far to near; the glow set is added and needs no order. */
  sorted: boolean;
  /** Scratch for the sort, made once; `orderView` is the front of `order` that holds sheets now. */
  order: Int32Array;
  orderView: Int32Array;
  keys: Float32Array;
  /** The merge sort's second buffer, made with the set so the sort allocates nothing. */
  scratch: Int32Array;
}

/** One bolt of the pool. */
interface Beam {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Seconds it has been alive, and how long it lives; `age >= seconds` means free. */
  age: number;
  seconds: number;
  /** The effects placed at its two ends. */
  startFx: unknown | null;
  endFx: unknown | null;
}

/** One strike standing in a nebula, drawn or not: made with the zone, written in place, never made in a frame. */
interface LiveStrike {
  /** The nebula it belongs to; -1 while the record is free. */
  row: number;
  /** Its two ends, in the world. */
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  /** The moment it is over, on the strike clock. */
  until: number;
  /** 0 to 1 across the row's damage band. */
  roll: number;
}

/**
 * What `strikeThrough` did with a strike: drawn, standing but not drawn (every bolt busy, or too far
 * to see), or not placed at all (every record busy, and none it could take).
 */
export type StrikeOutcome = 'drawn' | 'busy' | 'far' | 'crowded';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpStrikes: NebulaStrike[] = [];
/** The nearest point on a bolt to a ship, written in place for every test. */
const tmpReach: SegmentReach = { x: 0, y: 0, z: 0, t: 0, distance: 0 };
/** The console's strike, filled in place, and two axes to find a side of it with. */
const forcedStrike = newStrike();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Whether lightning may touch a ship at all: alive and not in a jump (`targetable`, which every
 * target choice goes through) and not held where it is (a hull the jump holds, the NPC ships while
 * play is paused), so a jump through a nebula is never struck.
 */
function strikable(s: NebulaShip): boolean {
  return targetable(s) && !s.vehicle.held;
}
/** Where the camera stands in the nebulae, filled afresh every frame rather than made every frame. */
const tmpInside: InsideAt = { index: -1, depth: 0 };

/** The quad every sheet is drawn from, and the strip every bolt is drawn from: made once, shared. */
function sheetQuad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const SHEET_VERTEX = /* glsl */ `
  attribute vec3 iCentre;
  attribute vec3 iNebula;
  attribute float iSize;
  attribute vec4 iColour;
  attribute float iFacing;
  attribute vec3 iRight;
  attribute vec3 iUp;
  uniform float uPullFrom;
  uniform float uAlpha;
  uniform vec2 uNearFade;
  uniform vec2 uFarFade;
  uniform vec2 uScreenFade;
  uniform float uTanHalfFov;
  varying vec4 vColour;
  varying vec2 vUv;
  void main() {
    // A nebula past the far plane is scaled toward the camera, it and everything in it, by the
    // ratio that brings its middle to uPullFrom: its picture is unchanged, only its depth.
    float nd = length(iNebula - cameraPosition);
    float k = (uPullFrom > 0.0 && nd > uPullFrom) ? uPullFrom / nd : 1.0;
    vec3 centre = cameraPosition + (iCentre - cameraPosition) * k;
    float size = iSize * k;
    float dist = max(1.0, length(centre - cameraPosition));
    vec3 right = iRight;
    vec3 up = iUp;
    if (iFacing > 0.5) {
      // The view's own right and up, so the sheet faces the camera exactly with nothing per frame.
      right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    }
    vec3 world = centre + right * (position.x * size) + up * (position.y * size);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float a = iColour.a * uAlpha;
    // Out as the camera comes into it, so flying through one never shows a flat edge.
    a *= smoothstep(uNearFade.x * size, uNearFade.y * size, dist);
    // Out before the far plane, so nothing is ever cut by it.
    a *= 1.0 - smoothstep(uFarFade.x, uFarFade.y, -mv.z);
    // Out as it fills the screen: the haze inside a nebula stands in for these.
    float share = size / max(1.0, dist * 2.0 * uTanHalfFov);
    a *= 1.0 - smoothstep(uScreenFade.x, uScreenFade.y, share);
    vColour = vec4(iColour.rgb, a);
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHEET_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColour;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColour.a;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(t.rgb * vColour.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SHELL_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColour;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uScale;
  uniform float uFloor;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    // Two flat projections of the view direction, weighted so neither one's pinch shows: a cheap
    // cloud on a sphere that has no poles.
    float w1 = 1.0 - abs(d.y);
    float w2 = 1.0 - abs(d.z);
    float sum = max(0.001, w1 + w2);
    vec4 a = texture2D(uMap, d.xz * uScale + vec2(uTime, uTime * 0.6));
    vec4 b = texture2D(uMap, d.xy * uScale + vec2(-uTime * 0.7, uTime * 0.4));
    vec4 t = (a * w1 + b * w2) / sum;
    // A floor under the picture's own alpha, so the haze is a fog rather than a set of holes.
    float alpha = uAlpha * (uFloor + (1.0 - uFloor) * t.a);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(t.rgb * uColour, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BEAM_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aWidth;
  attribute float aWander;
  attribute float aBright;
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
  varying float vBright;
  void main() {
    vec3 p = mix(uFrom, uTo, aT);
    vec3 dir = normalize(uTo - uFrom);
    // A bolt pointing straight at the camera (one that ends on the ship) makes a zero cross
    // product, and a normalized zero is NaN, which spreads to gl_Position and loses the whole
    // triangle: fall back to any axis across the bolt when that happens.
    vec3 c = cross(dir, normalize(cameraPosition - p));
    vec3 side = dot(c, c) < 1e-8 ? normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))) : normalize(c);
    vec3 up = normalize(cross(side, dir));
    float w1 = sin(aT * uWaveRates.x + uSeed) + uWaveMix * sin(aT * uWaveRates.y + uSeed * 2.7);
    float w2 = cos(aT * uWaveRates.z + uSeed * 1.7) + uWaveMix * cos(aT * uWaveRates.w + uSeed * 3.1);
    p += (side * w1 + up * w2) * (aWander * uWander);
    p += side * (aSide * aWidth * uWidth);
    // No fract: the picture is wrapped, so it tiles by itself. With one, the last segment held a
    // whole frame of the flip-book backwards.
    vUv = vec2(aT * uRepeat, aSide * 0.5 + 0.5);
    vT = aT;
    vBright = aBright;
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
  varying vec2 vUv;
  varying float vT;
  varying float vBright;
  void main() {
    // The frame is one tile of the picture, so the length along the bolt is wrapped into the tile
    // here rather than in the vertex program, where the wrap fell between two vertices and showed
    // the whole frame backwards across the last segment. Only the length wraps; across the ribbon
    // the edge really is 1. A length that lands exactly on the end of a tile keeps that end.
    float u = fract(vUv.x);
    if (u == 0.0 && vUv.x > 0.0) u = 1.0;
    vec4 t = texture2D(uMap, uFrameOffset + vec2(u, vUv.y) * uFrameSize);
    float a = t.a * uAlpha * vBright;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(t.rgb * mix(uColourA, uColourB, vT), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Nebulae {
  readonly group = new THREE.Group();
  /** The zone's rows, in the order everything else indexes them by. */
  readonly rows: readonly Nebula[];
  /** How deep the camera is inside the thickest nebula around it, 0 to 1: the flare and the god rays read it. */
  depthInside = 0;
  /** Which nebula that is (-1 outside them all). */
  insideIndex = -1;
  /** Sheets drawn in the zone right now, after the cap shared them out. */
  sheets = 0;
  /**
   * For the console: strikes started, bolts drawn for them, bolts skipped because every one was busy,
   * strikes lost because every record was (`crowded`, which a pool sized from the zone's rows keeps at
   * nought), records a strike near a ship took from one near nobody (`bumped`), the hits and the
   * damage they did, and the hits by whose ship (`npc` is every ship but the player's: the NPCs', and
   * any garage hull left standing).
   */
  readonly tally = { strikes: 0, drawn: 0, skipped: 0, crowded: 0, bumped: 0, hits: 0, damage: 0 };
  readonly hitsByShip = { player: 0, npc: 0 };

  private readonly deps: NebulaeDeps;
  private readonly sets: SheetSet[] = [];
  private readonly shells: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; look: 'glow' | 'mist' }[] = [];
  private readonly beams: Beam[] = [];
  /** The strikes standing now, drawn or not: as many records as the zone's rows call for (`strikeRecords`), made with the zone. */
  private readonly live: LiveStrike[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly seeds: Int32Array;
  /** The last wall-clock moment the strikes were asked for, per nebula (0: never). */
  private lastPoll = 0;
  private time = 0;
  /** Where the camera was when the mist was last sorted, and when. */
  private readonly sortedAt = new THREE.Vector3(Infinity, Infinity, Infinity);
  private sortTime = -Infinity;
  private readonly lightning: SpacePack['lightning'];
  private disposed = false;

  private constructor(deps: NebulaeDeps, rows: readonly Nebula[], lightning: SpacePack['lightning']) {
    this.deps = deps;
    this.rows = rows;
    this.lightning = lightning;
    this.seeds = new Int32Array(rows.length);
    for (let i = 0; i < rows.length; i++) this.seeds[i] = seedOfName(rows[i].name) | 0;
    this.group.name = 'nebulae';
    this.group.frustumCulled = false;
    const records = strikeRecords(rows, NEBULA_TUNE);
    for (let i = 0; i < records; i++) this.live.push({ row: -1, a: new THREE.Vector3(), b: new THREE.Vector3(), until: 0, roll: 0 });
  }

  /**
   * The zone's nebulae, ready to be added to the scene: the sheets placed, the haze and the bolts
   * made (hidden, but in the scene, so the warm-up compiles them), and the strike's own effects
   * prepared. Null when the pack has no nebulae or no look to draw them with (a pack converted
   * before the nebulae were carried).
   */
  static async build(deps: NebulaeDeps, pack: SpacePack, url: (file: string) => string, prepare: (file: string) => Promise<unknown>, stillWanted: () => boolean): Promise<Nebulae | null> {
    const rows = pack.nebulae ?? [];
    const look = pack.nebulaLook ?? null;
    if (!rows.length || !look) return null;
    const self = new Nebulae(deps, rows, pack.lightning ?? null);
    const loader = deps.texture ? null : new THREE.TextureLoader();
    const image = async (file: string | null): Promise<THREE.Texture | null> => {
      if (!file) return null;
      const t = await (deps.texture ? deps.texture(url(file)) : loader!.loadAsync(url(file))).catch(() => null);
      if (!t) return null;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      self.textures.push(t);
      return t;
    };
    const glowMap = await image(look.glow.texture);
    const mistMap = await image(look.mist.texture);
    const beamMap = await image(pack.lightning?.texture ?? null);
    if (!stillWanted()) {
      self.dispose(() => {});
      return null;
    }
    self.makeSet('glow', look.glow, glowMap);
    self.makeSet('mist', look.mist, mistMap);
    self.fill();
    self.makeShells(look, glowMap, mistMap);
    self.makeBeams(beamMap, pack);
    // The two effects a strike plays at its ends: their batches and textures made now, so a strike
    // never builds a program on a live frame.
    for (const f of [pack.lightning?.start, pack.lightning?.end]) if (f) await prepare(f);
    if (!stillWanted()) {
      self.dispose(() => {});
      return null;
    }
    current = self;
    return self;
  }

  /**
   * Strike now, for the console and for a scripted check, where the strike clock is not worth waiting
   * on. With the player flying a ship, one bolt of the nearest nebula that has lightning is placed
   * through that ship, half its reach beside its middle, so the shield-only path can be watched; with none, the bolt
   * stands where the nebula's next tick would put it, near `eye`. Either way it is an ordinary live
   * strike, drawn when it can be and tested against every ship at once.
   */
  forceStrike(eye: THREE.Vector3): string {
    const player = this.deps.playerShip();
    const ship = player && strikable(player) ? player : null;
    const from = ship ? ship.vehicle.pos : eye;
    let index = -1;
    let best = Infinity;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (!rowStrikes(row)) continue;
      const away = Math.hypot(row.at[0] - from.x, row.at[1] - from.y, row.at[2] - from.z) - row.radius;
      if (away < best) {
        best = away;
        index = i;
      }
    }
    if (index < 0) return 'no nebula here has lightning';
    const row = this.rows[index];
    const bolt = row.lightning!;
    const now = this.deps.now();
    // A tick ahead of the one running, and a fresh one each time, so asking twice is two bolts.
    strikeOfTick(this.seeds[index], tickOf(now, NEBULA_TUNE) + 1 + this.forced++, bolt.every, bolt.maxSeconds, row.radius, NEBULA_TUNE, forcedStrike, true);
    if (ship) {
      // The bolt's own length and turn, its middle moved to half the ship's reach beside the ship's
      // middle, on a side the tick picks: through the middle itself every strike would be on the
      // front, and the point is to watch either shield take one.
      const p = ship.vehicle.pos;
      tmpB.set(forcedStrike.to[0] - forcedStrike.from[0], forcedStrike.to[1] - forcedStrike.from[1], forcedStrike.to[2] - forcedStrike.from[2]).multiplyScalar(0.5);
      if (tmpB.lengthSq() < 1) tmpB.set(row.radius * NEBULA_TUNE.strikeCube, 0, 0);
      tmpAt.copy(tmpB).cross(Math.abs(tmpB.y) < 0.9 * tmpB.length() ? UP : SIDE).normalize().multiplyScalar(ship.vehicle.radius * 0.5 * (forcedStrike.roll < 0.5 ? -1 : 1)).add(p);
      tmpA.copy(tmpAt).sub(tmpB);
      tmpB.add(tmpAt);
    } else {
      tmpA.set(row.at[0] + forcedStrike.from[0], row.at[1] + forcedStrike.from[1], row.at[2] + forcedStrike.from[2]);
      tmpB.set(row.at[0] + forcedStrike.to[0], row.at[1] + forcedStrike.to[1], row.at[2] + forcedStrike.to[2]);
    }
    const hits = this.tally.hits;
    const what = this.strikeThrough(index, tmpA, tmpB, forcedStrike.seconds, forcedStrike.roll, now, eye);
    // Tested now rather than on the next frame, so the answer can say what it did.
    this.testStrikes(now);
    const where = ship ? `through ${ship.label}` : `${Math.round(best)} m from its edge`;
    const drawn = what === 'drawn' ? 'drawn' : what === 'busy' ? 'not drawn: every bolt is busy' : what === 'far' ? 'too far off to be drawn' : 'skipped: every strike is busy';
    const struck = this.tally.hits > hits ? 'and it struck' : ship ? (this.deps.damageEnabled() ? 'and the ship is resting from the last strike' : 'and lightning damage is switched off') : 'and nothing was under it';
    return `${row.name} struck ${where}, ${drawn}, ${struck}`;
  }

  /** How many strikes the console has asked for, so each one is a tick of its own. */
  private forced = 0;

  /**
   * Stand a strike of nebula `index` between `a` and `b` (in the world) from `at` (the strike clock's milliseconds) for
   * `seconds`: a live strike, tested against every ship until it is over, and a bolt drawn for it
   * when it is near enough to `eye` to be seen and a bolt of the pool is free. The bolt is drawn
   * `now - at` into its life, so two browsers show a strike at the same point of its life.
   */
  strikeThrough(index: number, a: THREE.Vector3, b: THREE.Vector3, seconds: number, roll: number, at: number, eye: THREE.Vector3): StrikeOutcome {
    const now = this.deps.now();
    let rec: LiveStrike | null = null;
    for (const s of this.live) {
      if (s.row < 0 || s.until <= now) {
        rec = s;
        break;
      }
    }
    if (!rec) {
      // Every record standing: busier than the zone's rows promised. A strike in a nebula holding a
      // ship that may be struck takes the record of one standing in a nebula that holds none, which
      // only ever stood to be seen (its bolt, if it has one, burns on); any other is lost, and counted.
      const ships = this.deps.ships();
      if (holdsShip(this.rows[index], ships)) rec = this.recordNearNobody(ships);
      if (!rec) {
        this.tally.crowded++;
        return 'crowded';
      }
      this.tally.bumped++;
    }
    rec.row = index;
    rec.a.copy(a);
    rec.b.copy(b);
    rec.until = at + seconds * 1000;
    rec.roll = roll;
    this.tally.strikes++;
    // Nothing is drawn for a strike too far off to be seen at all; it strikes all the same.
    if (Math.min(a.distanceTo(eye), b.distanceTo(eye)) > NEBULA_TUNE.drawWithin) return 'far';
    return this.startBeam(index, a, b, seconds, Math.max(0, (now - at) / 1000), roll, eye);
  }

  /** A standing strike whose nebula holds no ship that may be struck, which can give its record up; null when every one does. */
  private recordNearNobody(ships: readonly NebulaShip[]): LiveStrike | null {
    for (const s of this.live) if (s.row >= 0 && !holdsShip(this.rows[s.row], ships)) return s;
    return null;
  }

  /** How many strike records the zone was given (`strikeRecords`). */
  get records(): number {
    return this.live.length;
  }

  /**
   * One look's instanced set, empty. Its buffers are made for the zone's whole cap, so the sheet
   * count can be moved live (`__debug.nebulae({ density })`) by refilling them and changing how
   * many instances are drawn -- never by making a buffer or a material on a live frame.
   */
  private makeSet(look: 'glow' | 'mist', sheetLook: NebulaSheetLook, map: THREE.Texture | null): void {
    if (!map) return;
    let any = false;
    for (const row of this.rows) if (row.shader === look) any = true;
    if (!any) return;
    const capacity = NEBULA_TUNE.zoneSheets;
    const source = new Float32Array(capacity * SHEET_FLOATS);
    const geometry = sheetQuad();
    geometry.instanceCount = 0;
    const data: THREE.InstancedBufferAttribute[] = [];
    const add = (name: string, size: number): void => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
      data.push(a);
    };
    // The order here is the order the fields sit in a sheet's row of `source`; the sort reads it.
    add('iCentre', 3);
    add('iNebula', 3);
    add('iSize', 1);
    add('iColour', 4);
    add('iFacing', 1);
    add('iRight', 3);
    add('iUp', 3);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uPullFrom: { value: NEBULA_TUNE.pullFrom },
        uAlpha: { value: 1 },
        uNearFade: { value: new THREE.Vector2(NEBULA_TUNE.nearFadeFrom, NEBULA_TUNE.nearFadeTo) },
        uFarFade: { value: new THREE.Vector2(NEBULA_TUNE.farFadeFrom, NEBULA_TUNE.farFadeTo) },
        uScreenFade: { value: new THREE.Vector2(NEBULA_TUNE.screenFadeFrom, NEBULA_TUNE.screenFadeTo) },
        uTanHalfFov: { value: Math.tan((60 * Math.PI) / 360) },
      },
      vertexShader: SHEET_VERTEX,
      fragmentShader: SHEET_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: sheetLook.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    material.name = `nebula:${look}`;
    // Unlit and dry: out of the shadow cascades, and never wrapped by the weather.
    material.userData.unlit = true;
    material.userData.dry = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `nebula:${look}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The mist first, then the glow over it, then everything else the zone draws.
    mesh.renderOrder = look === 'mist' ? NEBULA_TUNE.orderMist : NEBULA_TUNE.orderGlow;
    this.group.add(mesh);
    this.sets.push({
      look,
      mesh,
      geometry,
      material,
      capacity,
      count: 0,
      source,
      data,
      sorted: sheetLook.blend !== 'add',
      order: new Int32Array(capacity),
      orderView: new Int32Array(0),
      keys: new Float32Array(capacity),
      scratch: new Int32Array(capacity),
    });
  }

  /**
   * Place every sheet of every nebula into the sets' buffers: what each row asks for at the tune's
   * density, shared down when the zone asks for more than the cap. Run once at build and again
   * whenever a live knob changes how many sheets there are or how big they are; it writes buffers
   * that already exist and touches no material, so nothing compiles and the frame after it is the
   * new look. A zone that asks for more than a set can hold simply stops at the buffer's end.
   */
  fill(): void {
    const wanted = this.rows.map((r) => sheetCount(r.radius, r.density, NEBULA_TUNE));
    const counts = shareSheets(wanted, NEBULA_TUNE.zoneSheets);
    let drawn = 0;
    for (const set of this.sets) {
      const { source, capacity } = set;
      let at = 0;
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        if (row.shader !== set.look) continue;
        for (const s of buildSheets(row, i, Math.min(counts[i], capacity - at), NEBULA_TUNE)) {
          const o = at * SHEET_FLOATS;
          source[o] = s.x;
          source[o + 1] = s.y;
          source[o + 2] = s.z;
          source[o + 3] = row.at[0];
          source[o + 4] = row.at[1];
          source[o + 5] = row.at[2];
          source[o + 6] = s.size;
          source[o + 7] = s.colour[0];
          source[o + 8] = s.colour[1];
          source[o + 9] = s.colour[2];
          source[o + 10] = s.colour[3];
          source[o + 11] = s.facing ? 1 : 0;
          source[o + 12] = s.right[0];
          source[o + 13] = s.right[1];
          source[o + 14] = s.right[2];
          source[o + 15] = s.up[0];
          source[o + 16] = s.up[1];
          source[o + 17] = s.up[2];
          at++;
        }
      }
      set.count = at;
      set.geometry.instanceCount = at;
      // The sort orders only the sheets there are, never the empty end of the buffer.
      set.orderView = set.order.subarray(0, at);
      let field = 0;
      for (const a of set.data) {
        const size = a.itemSize;
        const array = a.array as Float32Array;
        for (let i = 0; i < at; i++) for (let k = 0; k < size; k++) array[i * size + k] = source[i * SHEET_FLOATS + field + k];
        a.needsUpdate = true;
        field += size;
      }
      drawn += at;
    }
    this.sheets = drawn;
    // Whatever order the mist was in was for the sheets that are gone.
    this.sortTime = -Infinity;
    this.sortedAt.set(Infinity, Infinity, Infinity);
  }

  /** The haze inside a nebula: a sphere about the camera, one per look, hidden until the camera is in one. */
  private makeShells(look: { glow: NebulaSheetLook; mist: NebulaSheetLook }, glowMap: THREE.Texture | null, mistMap: THREE.Texture | null): void {
    for (const kind of ['glow', 'mist'] as const) {
      const map = kind === 'glow' ? glowMap : mistMap;
      if (!map) continue;
      // One sphere each rather than one shared: `dispose` walks the group and frees what it finds.
      const geometry = new THREE.SphereGeometry(1, 24, 16);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uColour: { value: new THREE.Color(1, 1, 1) },
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uScale: { value: NEBULA_TUNE.shellScale },
          uFloor: { value: NEBULA_TUNE.shellFloor },
        },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // The client's own near shell is drawn without a depth test. Ours keeps it, so the haze
        // stands at `shellRadius` and never paints over the ship in front of the camera;
        // `__debug.nebulae({ shellDepthTest: false })` shows the other way (a render state, not a
        // program key: nothing compiles on the switch).
        depthTest: true,
        blending: look[kind].blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: THREE.BackSide,
        fog: false,
      });
      material.name = `nebula:haze:${kind}`;
      material.userData.unlit = true;
      material.userData.dry = true;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `nebula:haze:${kind}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = NEBULA_TUNE.orderHaze;
      mesh.scale.setScalar(NEBULA_TUNE.shellRadius);
      mesh.visible = false;
      this.group.add(mesh);
      this.shells.push({ mesh, material, look: kind });
    }
  }

  /** The bolt pool: NEBULA_TUNE.beams ribbons, made once and reused, hidden until one strikes. */
  private makeBeams(map: THREE.Texture | null, pack: SpacePack): void {
    if (!map) return;
    const shape = pack.lightning?.waveforms ?? [];
    const segments = Math.max(2, Math.round(NEBULA_TUNE.beamSegments));
    const width = beamCurves(shape[0]?.points ?? [], segments + 1);
    const second = beamCurves(shape[1]?.points ?? [], segments + 1);
    // Our reading: the second curve is how far the bolt wanders along its length. The design's
    // reading was that it is how bright the bolt is there; `waveAlpha` is that reading, and with it
    // on the wander is even all the way along instead. One or the other, never neither.
    const wander = NEBULA_TUNE.waveAlpha ? null : second;
    const bright = NEBULA_TUNE.waveAlpha ? second : null;
    const verts = (segments + 1) * 2;
    const aT = new Float32Array(verts);
    const aSide = new Float32Array(verts);
    const aWidth = new Float32Array(verts);
    const aWander = new Float32Array(verts);
    const aBright = new Float32Array(verts);
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        aT[v] = t;
        aSide[v] = s === 0 ? -1 : 1;
        aWidth[v] = width[i];
        aWander[v] = wander ? wander[i] : 1;
        aBright[v] = bright ? bright[i] : 1;
      }
      if (i < segments) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const flip = pack.lightning?.flipbook ?? null;
    const uv = flip?.uvSize ?? 1;
    // The appearance's own first and last frame when it gives them (0 and 3 on the one the zones
    // name, so nothing changes there today); otherwise the whole book.
    const first = flip && Number.isFinite(flip.frameStart) ? Math.max(0, Math.round(flip.frameStart)) : 0;
    const last = flip && Number.isFinite(flip.frameEnd) && flip.frameEnd >= first ? Math.round(flip.frameEnd) : Math.max(0, (flip?.frames ?? 1) - 1);
    const frames = Math.max(1, Math.min(last - first + 1, Math.max(1, flip?.frames ?? 1) - first));
    for (let i = 0; i < NEBULA_TUNE.beams; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
      geometry.setAttribute('aWidth', new THREE.BufferAttribute(aWidth, 1));
      geometry.setAttribute('aWander', new THREE.BufferAttribute(aWander, 1));
      geometry.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
      geometry.setIndex(index);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uFrom: { value: new THREE.Vector3() },
          uTo: { value: new THREE.Vector3(0, 1, 0) },
          uWidth: { value: NEBULA_TUNE.beamWidth },
          uWander: { value: NEBULA_TUNE.beamWander },
          uWaveRates: { value: new THREE.Vector4(NEBULA_TUNE.beamWaveSlowA, NEBULA_TUNE.beamWaveFastA, NEBULA_TUNE.beamWaveSlowB, NEBULA_TUNE.beamWaveFastB) },
          uWaveMix: { value: NEBULA_TUNE.beamWaveMix },
          uSeed: { value: 0 },
          // One picture of the appearance's flip-book along the whole bolt.
          uRepeat: { value: 1 },
          uFrameOffset: { value: new THREE.Vector2(0, 0) },
          uFrameSize: { value: new THREE.Vector2(uv, uv) },
          uColourA: { value: new THREE.Color(1, 1, 1) },
          uColourB: { value: new THREE.Color(1, 1, 1) },
          uAlpha: { value: 0 },
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
      material.name = 'nebula:lightning';
      material.userData.unlit = true;
      material.userData.dry = true;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `nebula:lightning:${i}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = NEBULA_TUNE.orderBeam;
      mesh.visible = false;
      this.group.add(mesh);
      this.beams.push({ mesh, material, age: 1, seconds: 0, startFx: null, endFx: null });
    }
    this.frames = frames;
    this.firstFrame = first;
    // The grid is laid out over the whole book, whichever frames of it are played.
    this.gridColumns = Math.max(1, Math.ceil(Math.max(1, flip?.frames ?? 1) / Math.max(1, flip?.perColumn ?? 1)));
    this.frameFps = flip?.fps && flip.fps > 0 ? flip.fps : 10;
    this.frameSize = uv;
  }

  /** How many frames of the book are played, and which one they start at. */
  private frames = 1;
  private firstFrame = 0;
  /** How many frames stand across the picture. */
  private gridColumns = 1;
  private frameFps = 10;
  private frameSize = 1;

  /**
   * One frame: where the camera is inside, the haze, the sort, and the strikes. Allocates nothing.
   * `dt` is the frame's seconds and `camera` the one the frame is drawn with.
   */
  update(dt: number, camera: THREE.PerspectiveCamera): void {
    if (this.disposed) return;
    this.time += dt;
    const eye = camera.position;
    this.lastEye.copy(eye);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    // The player's own slider, over the console's knob: uniforms only, so nothing is made or compiled.
    const opacity = this.opacity;
    for (const set of this.sets) {
      const u = set.material.uniforms;
      u.uTanHalfFov.value = tan;
      u.uPullFrom.value = NEBULA_TUNE.pullFrom;
      u.uAlpha.value = NEBULA_TUNE.alpha * opacity;
      (u.uNearFade.value as THREE.Vector2).set(NEBULA_TUNE.nearFadeFrom, NEBULA_TUNE.nearFadeTo);
      (u.uFarFade.value as THREE.Vector2).set(NEBULA_TUNE.farFadeFrom, NEBULA_TUNE.farFadeTo);
      (u.uScreenFade.value as THREE.Vector2).set(NEBULA_TUNE.screenFadeFrom, NEBULA_TUNE.screenFadeTo);
    }
    // Into a scratch object made once, not into a fresh one every frame.
    const inside = deepestInside(this.rows, eye.x, eye.y, eye.z, NEBULA_TUNE, tmpInside);
    this.insideIndex = inside.index;
    this.depthInside = inside.depth;
    this.updateShells(inside.index, inside.depth, eye);
    // The camera shakes in the rough ones, by the row's own jitter and how deep in the camera is.
    if (inside.index >= 0) {
      const jitter = this.rows[inside.index].jitter;
      if (jitter > 0) setViewShake(Math.min(1, jitter) * inside.depth);
    }
    this.sortMist(eye);
    this.updateStrikes(dt, eye);
  }

  /** The haze: the look of the nebula the camera is in, its colour, how solid it is by depth, and on the camera like the sky. */
  private updateShells(index: number, depth: number, eye: THREE.Vector3): void {
    const row = index >= 0 ? this.rows[index] : null;
    for (const shell of this.shells) {
      const on = this.shown && !!row && row.shader === shell.look && depth > 0;
      shell.mesh.visible = on;
      if (!on) continue;
      const colour = row!.facing.colour;
      (shell.material.uniforms.uColour.value as THREE.Color).setRGB(colour[1], colour[2], colour[3]);
      shell.material.uniforms.uAlpha.value = colour[0] * depth * NEBULA_TUNE.shellAlpha * this.opacity;
      shell.material.uniforms.uTime.value = this.time * NEBULA_TUNE.shellDrift;
      shell.material.uniforms.uScale.value = NEBULA_TUNE.shellScale;
      shell.material.uniforms.uFloor.value = NEBULA_TUNE.shellFloor;
      shell.mesh.scale.setScalar(NEBULA_TUNE.shellRadius);
      shell.mesh.position.copy(eye);
    }
  }

  /**
   * The mist sheets far to near: `sortEvery` at rest, sooner once the camera has moved `sortMoved`,
   * and never oftener than `sortLeast`, which is the cap that holds at a jump's nine hundred metres
   * a second (where the distance alone would ask for a sort every few frames, each one rewriting
   * every instance buffer). Three sorts see-through objects as wholes and a set is one object, so
   * its own sheets have to be put in order here. Nothing is allocated: the keys, the order and the
   * sort's own scratch are buffers made with the set, and the sort takes no comparator.
   */
  private sortMist(eye: THREE.Vector3): void {
    const since = this.time - this.sortTime;
    if (since < NEBULA_TUNE.sortLeast) return;
    const moved = this.sortedAt.distanceToSquared(eye) > NEBULA_TUNE.sortMoved * NEBULA_TUNE.sortMoved;
    if (!moved && since < NEBULA_TUNE.sortEvery) return;
    this.sortTime = this.time;
    this.sortedAt.copy(eye);
    for (const set of this.sets) {
      if (!set.sorted) continue;
      const { count, source, keys, orderView: order } = set;
      for (let i = 0; i < count; i++) {
        const o = i * SHEET_FLOATS;
        const dx = source[o] - eye.x;
        const dy = source[o + 1] - eye.y;
        const dz = source[o + 2] - eye.z;
        keys[i] = dx * dx + dy * dy + dz * dz;
        order[i] = i;
      }
      sortFarToNear(order, keys, count, set.scratch);
      let field = 0;
      for (const a of set.data) {
        const size = a.itemSize;
        const array = a.array as Float32Array;
        for (let i = 0; i < count; i++) {
          const from = order[i] * SHEET_FLOATS + field;
          for (let k = 0; k < size; k++) array[i * size + k] = source[from + k];
        }
        a.needsUpdate = true;
        field += size;
      }
    }
  }

  /**
   * The strikes. Every nebula's clock is cut into ticks on the clock the weather reads and whether tick n strikes
   * is a hash of the nebula's name and n, so two browsers see the same strikes at the same moments
   * with nothing sent between them. A nebula is asked only while it is near enough to be seen or a
   * ship that may be struck is inside it; every strike standing is then tested against every ship.
   */
  private updateStrikes(dt: number, eye: THREE.Vector3): void {
    for (const beam of this.beams) {
      if (beam.age >= beam.seconds) continue;
      beam.age += dt;
      const live = beam.age < beam.seconds;
      const alpha = live ? beamEnvelope(beam.age, beam.seconds, NEBULA_TUNE) : 0;
      beam.material.uniforms.uAlpha.value = alpha;
      beam.material.uniforms.uWidth.value = NEBULA_TUNE.beamWidth;
      beam.material.uniforms.uWander.value = NEBULA_TUNE.beamWander;
      (beam.material.uniforms.uWaveRates.value as THREE.Vector4).set(NEBULA_TUNE.beamWaveSlowA, NEBULA_TUNE.beamWaveFastA, NEBULA_TUNE.beamWaveSlowB, NEBULA_TUNE.beamWaveFastB);
      beam.material.uniforms.uWaveMix.value = NEBULA_TUNE.beamWaveMix;
      // The flip-book runs at its own rate, as the appearance's timing gives it, over the frames
      // the appearance names rather than the whole sheet.
      const frame = this.firstFrame + (Math.floor(beam.age * this.frameFps) % this.frames);
      const cx = frame % this.gridColumns;
      const cy = Math.floor(frame / this.gridColumns);
      (beam.material.uniforms.uFrameOffset.value as THREE.Vector2).set(cx * this.frameSize, 1 - this.frameSize - cy * this.frameSize);
      if (!live) this.endBeam(beam);
    }
    const now = this.deps.now();
    const from = this.lastPoll;
    this.lastPoll = now;
    if (from && now > from) {
      const ships = this.deps.ships();
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        if (!rowStrikes(row)) continue;
        const bolt = row.lightning!;
        // A nebula far from the camera with nobody in it is not asked: its strikes would touch nothing
        // and show nothing. One holding a ship that may be struck is asked however far off it is.
        const away = Math.hypot(row.at[0] - eye.x, row.at[1] - eye.y, row.at[2] - eye.z) - row.radius;
        if (away > NEBULA_TUNE.strikeReach && !holdsShip(row, ships)) continue;
        const list = strikesBetween(this.seeds[i], bolt.every, bolt.maxSeconds, row.radius, from, now, tmpStrikes, NEBULA_TUNE);
        for (const strike of list) this.startStrike(i, strike, now, eye);
      }
    }
    this.testStrikes(now);
  }

  /** One strike off the clock: its two ends in the world, bent onto the player's ship only while `bendWithin` asks, then stood. */
  private startStrike(index: number, strike: NebulaStrike, now: number, eye: THREE.Vector3): void {
    // One that was over before this frame (the end of a gap caught up with) has nothing left to do.
    if (strike.at + strike.seconds * 1000 <= now) return;
    const row = this.rows[index];
    tmpA.set(row.at[0] + strike.from[0], row.at[1] + strike.from[1], row.at[2] + strike.from[2]);
    tmpB.set(row.at[0] + strike.to[0], row.at[1] + strike.to[1], row.at[2] + strike.to[2]);
    if (NEBULA_TUNE.bendWithin > 0) this.bend(row, tmpB);
    this.strikeThrough(index, tmpA, tmpB, strike.seconds, strike.roll, strike.at, eye);
  }

  /**
   * How this game aimed lightning before it took the game's rule, kept behind `bendWithin`: a strike
   * whose far end falls that near the player's ship, with the ship inside the nebula and rested from
   * the last strike, ends on the ship instead.
   */
  private bend(row: Nebula, b: THREE.Vector3): void {
    const ship = this.deps.playerShip();
    if (!ship || !strikable(ship) || !ship.combat?.lightningReady) return;
    const p = ship.vehicle.pos;
    if (p.distanceTo(b) >= NEBULA_TUNE.bendWithin || !insideOf(row, p)) return;
    b.copy(p);
  }

  /**
   * Every strike standing, against every ship that may be struck (READ: a bolt touches whatever it
   * passes): a quick test of the bolt's box grown by the ship's reach, then the nearest point on the
   * bolt to the ship's middle, which must be within `hitShare` of its radius. The ship's own path
   * says whether it took the strike (it rests between strikes); the amount is the row's band at the
   * strike's roll, at the owner's share, and nothing at all with the setting off. A strike that is
   * over frees its record. Nothing is made.
   */
  private testStrikes(now: number): void {
    const enabled = this.deps.damageEnabled();
    let ships: readonly NebulaShip[] | null = null;
    let player: NebulaShip | null = null;
    for (const s of this.live) {
      if (s.row < 0) continue;
      if (s.until <= now) {
        s.row = -1;
        continue;
      }
      if (!enabled) continue;
      const bolt = this.rows[s.row].lightning;
      if (!bolt) continue;
      const amount = strikeDamage(bolt.damage, s.roll, true, NEBULA_TUNE);
      if (!(amount > 0)) continue;
      if (!ships) {
        ships = this.deps.ships();
        player = this.deps.playerShip();
      }
      const a = s.a;
      const b = s.b;
      for (let k = 0; k < ships.length; k++) {
        const ship = ships[k];
        if (!strikable(ship) || !ship.combat?.lightningReady) continue;
        const p = ship.vehicle.pos;
        const r = Math.max(0, ship.vehicle.radius) * NEBULA_TUNE.hitShare;
        if (p.x < Math.min(a.x, b.x) - r || p.x > Math.max(a.x, b.x) + r) continue;
        if (p.y < Math.min(a.y, b.y) - r || p.y > Math.max(a.y, b.y) + r) continue;
        if (p.z < Math.min(a.z, b.z) - r || p.z > Math.max(a.z, b.z) + r) continue;
        if (segmentReach(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y, p.z, tmpReach) > r) continue;
        tmpAt.set(tmpReach.x, tmpReach.y, tmpReach.z);
        if (!this.deps.strike(ship, amount, tmpAt)) continue;
        this.tally.hits++;
        this.tally.damage += amount;
        if (ship === player) this.hitsByShip.player++;
        else this.hitsByShip.npc++;
      }
    }
  }

  /**
   * Put one strike on a free bolt of the pool, `age` seconds into its life; a strike that comes while
   * every bolt is busy is not drawn (it still strikes).
   */
  private startBeam(index: number, a: THREE.Vector3, b: THREE.Vector3, seconds: number, age: number, roll: number, eye: THREE.Vector3): StrikeOutcome {
    const row = this.rows[index];
    const bolt = row.lightning!;
    let beam: Beam | null = null;
    for (const free of this.beams) {
      if (free.age >= free.seconds) {
        beam = free;
        break;
      }
    }
    if (!beam) {
      this.tally.skipped++;
      return 'busy';
    }
    this.tally.drawn++;
    beam.age = Math.min(age, seconds);
    beam.seconds = seconds;
    const u = beam.material.uniforms;
    (u.uFrom.value as THREE.Vector3).copy(a);
    (u.uTo.value as THREE.Vector3).copy(b);
    // The bolt's wander, from the strike itself, so the same strike wanders the same way everywhere.
    u.uSeed.value = (Math.abs(this.seeds[index]) % 97) + roll * 97;
    u.uAlpha.value = 0;
    (u.uColourA.value as THREE.Color).setRGB(bolt.colour[1], bolt.colour[2], bolt.colour[3]);
    (u.uColourB.value as THREE.Color).setRGB(bolt.ramp[1], bolt.ramp[2], bolt.ramp[3]);
    beam.mesh.visible = true;
    // One pooled light at the near end, in the bolt's own colour.
    const near = a.distanceTo(eye) < b.distanceTo(eye) ? a : b;
    this.deps.flash(near, colourOf(bolt.colour), NEBULA_TUNE.flashIntensity, NEBULA_TUNE.flashDistance, NEBULA_TUNE.flashSeconds);
    // The appearance's own start and end effects, transient, at the bolt's two ends.
    if (this.lightning?.start) beam.startFx = this.deps.place(this.lightning.start, tmpMatrix.makeTranslation(a.x, a.y, a.z));
    if (this.lightning?.end) beam.endFx = this.deps.place(this.lightning.end, tmpMatrix.makeTranslation(b.x, b.y, b.z));
    return 'drawn';
  }

  private endBeam(beam: Beam): void {
    beam.mesh.visible = false;
    beam.material.uniforms.uAlpha.value = 0;
    if (beam.startFx) this.deps.remove(beam.startFx);
    if (beam.endFx) this.deps.remove(beam.endFx);
    beam.startFx = beam.endFx = null;
  }

  /**
   * Draw the haze with or without a depth test. It is a render state, not part of a program's key,
   * so this compiles nothing; without the test the haze is drawn over everything in front of the
   * camera, which is what the client's own near shader does.
   */
  setShellDepthTest(on: boolean): void {
    for (const shell of this.shells) shell.material.depthTest = on;
  }

  /**
   * Draw the nebulae, or none of them. Nothing is freed and nothing is made: it is the A and B for
   * reading what they cost, with the frame timers on and the same view held both ways.
   */
  setShown(on: boolean): void {
    this.shown = on;
    for (const set of this.sets) set.mesh.visible = on;
    if (!on) for (const shell of this.shells) shell.mesh.visible = false;
  }

  /**
   * Put each thing back at the place in three's see-through order the tune now gives it. Order is
   * not part of a program's key, so this compiles nothing; it is here because the numbers are ours
   * and an engine trail or a bolt drawing through the mist is the sort of thing only an eye settles.
   */
  applyOrders(): void {
    for (const set of this.sets) set.mesh.renderOrder = set.look === 'mist' ? NEBULA_TUNE.orderMist : NEBULA_TUNE.orderGlow;
    for (const shell of this.shells) shell.mesh.renderOrder = NEBULA_TUNE.orderHaze;
    for (const beam of this.beams) beam.mesh.renderOrder = NEBULA_TUNE.orderBeam;
  }

  private shown = true;

  /** Where the camera was on the last frame that ran: the console's stand-in for "here". */
  readonly lastEye = new THREE.Vector3();

  /** The player's Nebula opacity, 0 to 1 (1 when the game gives none). */
  get opacity(): number {
    return clampOpacity(this.deps.opacity ? this.deps.opacity() : 1);
  }

  /** How much of the lens flare is left where the camera is; 1 outside every nebula, and eased toward 1 as the opacity is turned down. */
  get flareDim(): number {
    return dimInside(seenDepth(this.depthInside, this.opacity), NEBULA_TUNE.dimFlare);
  }

  /** How much of the god rays is left where the camera is; 1 outside every nebula, eased the same way. */
  get rayDim(): number {
    return dimInside(seenDepth(this.depthInside, this.opacity), NEBULA_TUNE.dimRays);
  }

  /** How many strikes stand right now, drawn or not. */
  get liveCount(): number {
    const now = this.deps.now();
    let n = 0;
    for (const s of this.live) if (s.row >= 0 && s.until > now) n++;
    return n;
  }

  /**
   * What the console shows: the counts, where the camera is, what the lightning has done, and what the
   * nebulae are doing to every ship inside one (its engines', reactor's and shield recharge's factors).
   */
  report(): Record<string, unknown> {
    const player = this.deps.playerShip();
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    return {
      nebulae: this.rows.length,
      sheets: this.sheets,
      sets: this.sets.map((s) => ({ look: s.material.name, sheets: s.count, sorted: s.sorted })),
      inside: this.insideIndex >= 0 ? { name: this.rows[this.insideIndex].name, depth: Number(this.depthInside.toFixed(3)), jitter: this.rows[this.insideIndex].jitter, look: this.rows[this.insideIndex].shader } : null,
      dim: { flare: Number(this.flareDim.toFixed(3)), rays: Number(this.rayDim.toFixed(3)) },
      // The Graphics page's Nebula opacity, over the sheets, the haze and the two dims above.
      opacity: Number(this.opacity.toFixed(3)),
      haze: this.shells.map((s) => ({ look: s.look, drawn: s.mesh.visible, alpha: Number((s.material.uniforms.uAlpha.value as number).toFixed(3)) })),
      lightning: { ...this.tally, live: this.liveCount, beams: this.beams.filter((b) => b.age < b.seconds).length, damage: Number(this.tally.damage.toFixed(1)) },
      hitsByShip: { ...this.hitsByShip },
      live: this.liveCount,
      records: this.live.length,
      systems: this.deps
        .ships()
        .filter((s) => s.nebula.inside > 0 && !!s.combat)
        .map((s) => ({ ship: s.label, yours: s === player, inside: s.nebula.inside, engine: r2(s.combat!.nebula.engine), reactor: r2(s.combat!.nebula.reactor), shields: r2(s.combat!.nebula.shields) })),
      systemsTune: { ...NEBULA_SYSTEMS },
      shown: this.shown,
      ours: "how many sheets, how big, the pull-in, the haze, the strike clock's tick, how near a bolt must pass and how strongly a nebula weakens a ship are ours; when a nebula strikes, where its bolt stands, how long it lasts, whom it touches and what it takes are the game's rule",
    };
  }

  /** The line the world prints when a zone's nebulae are up. */
  get status(): string {
    return `${this.rows.length} nebulae, ${this.sheets} sheets in ${this.sets.length} sets, ${this.beams.length} bolts`;
  }

  /** Taken out of the world for good: the materials forgotten (both registers are strong), then everything freed. */
  dispose(forget: (materials: THREE.Material[]) => void): void {
    this.disposed = true;
    if (current === this) current = null;
    for (const beam of this.beams) this.endBeam(beam);
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
    this.sets.length = 0;
    this.shells.length = 0;
    this.beams.length = 0;
    for (const s of this.live) s.row = -1;
  }
}

/**
 * The zone's nebulae while there are any, and the console hook that reads and tunes them. The hook
 * lives here rather than beside the rest in the game's own debug block, so that everything about the
 * nebulae is in one file; it is added to whatever `__debug` is there and replaces nothing of it. It
 * answers whether or not a zone has nebulae, so asking in Deep Space or on a planet says so instead
 * of throwing, and it is put back whenever it is not there, since the game makes its `__debug` in
 * one go at startup and that would drop a hook installed before it.
 */
let current: Nebulae | null = null;

/** Knobs that are spent when the sheets are placed: changing one refills the buffers. */
const REBUILD_KEYS: readonly string[] = ['density', 'sheetsPer500m', 'sheetsMin', 'sheetsMax', 'zoneSheets', 'sizeMin', 'sizeMax', 'centrePower'];
/** Knobs that are spent when a mesh is made: changing one only has to put the meshes back in order. */
const ORDER_KEYS: readonly string[] = ['orderMist', 'orderGlow', 'orderHaze', 'orderBeam'];

/**
 * `__debug.nebulae()` says what the zone has and where the camera is in it.
 * `__debug.nebulae({ density: 2 })` (and every other name in NEBULA_TUNE) moves a number live; the
 * ones that place the sheets refill them on the spot, the ones that order them put the meshes back
 * in order, the ones that are spent when the bolt pool and the strike records are made are answered
 * with `atNextZone`, and nothing ever compiles. `{ systems: { engine, reactor, shields } }` moves how
 * strongly a nebula weakens a ship, per unit of its density (the ships take it on their next step).
 * `__debug.nebulae({ shellDepthTest: false })` draws the haze the way the client's own near shader
 * does, over everything; `{ strike: true }` stands a bolt through the player's ship (or, with none,
 * near the camera) without waiting for the clock.
 */
const nebulaeHook = (
  opts?: Partial<NebulaTune> & { shellDepthTest?: boolean; shown?: boolean; strike?: boolean; at?: [number, number, number]; systems?: Partial<typeof NEBULA_SYSTEMS> },
): Record<string, unknown> | string => {
  const nebulae = current;
  // A knob may be moved anywhere, whether or not a zone with nebulae is up.
  let refill = false;
  let reorder = false;
  const later: string[] = [];
  if (opts) {
    for (const [key, value] of Object.entries(opts)) {
      if (!(key in NEBULA_TUNE) || typeof value !== typeof (NEBULA_TUNE as unknown as Record<string, unknown>)[key]) continue;
      (NEBULA_TUNE as unknown as Record<string, unknown>)[key] = value;
      if (REBUILD_KEYS.includes(key)) refill = true;
      if (ORDER_KEYS.includes(key)) reorder = true;
      if (BUILD_ONLY_KEYS.includes(key)) later.push(key);
    }
    const systems = opts.systems;
    if (systems && typeof systems === 'object') {
      for (const key of ['engine', 'reactor', 'shields'] as const) {
        const v = systems[key];
        if (typeof v === 'number' && Number.isFinite(v)) NEBULA_SYSTEMS[key] = v;
      }
    }
  }
  if (!nebulae) {
    const answer = 'no nebulae here: a space zone with a pack converted at version 3 or later has them';
    return later.length ? `${answer} (${later.join(', ')} will be spent when one is)` : answer;
  }
  if (opts) {
    if (opts.shellDepthTest !== undefined) nebulae.setShellDepthTest(opts.shellDepthTest);
    if (opts.shown !== undefined) nebulae.setShown(opts.shown);
    if (refill) nebulae.fill();
    if (reorder) nebulae.applyOrders();
  }
  // The strike first, so the answer's tally already counts it.
  let struck: string | null = null;
  if (opts?.strike) {
    const at = opts.at ? new THREE.Vector3(opts.at[0], opts.at[1], opts.at[2]) : nebulae.lastEye;
    struck = nebulae.forceStrike(at);
  }
  const report = nebulae.report();
  if (struck !== null) report.struck = struck;
  report.tune = { ...NEBULA_TUNE };
  // These are spent when the bolt pool is made, so they are the next zone's, not this one's.
  if (later.length) report.atNextZone = later.join(', ');
  return report;
};

/**
 * Put the hook on `__debug` unless it is already there. It is called when this file loads and again
 * on every space zone's load, because the game builds its own `__debug` object in one go at startup
 * and a hook installed before that would go with the old object.
 */
export function installNebulaDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.nebulae !== nebulaeHook) debug.nebulae = nebulaeHook;
}

installNebulaDebug();

/** A point is inside a nebula's sphere. */
function insideOf(row: Nebula, p: THREE.Vector3): boolean {
  return Math.hypot(row.at[0] - p.x, row.at[1] - p.y, row.at[2] - p.z) < row.radius;
}

/** Whether any ship that may be struck is inside a nebula: an index loop over the world's own list, nothing made. */
function holdsShip(row: Nebula, ships: readonly NebulaShip[]): boolean {
  const r2 = row.radius * row.radius;
  for (let k = 0; k < ships.length; k++) {
    const s = ships[k];
    const p = s.vehicle.pos;
    const dx = row.at[0] - p.x;
    const dy = row.at[1] - p.y;
    const dz = row.at[2] - p.z;
    if (dx * dx + dy * dy + dz * dz < r2 && strikable(s)) return true;
  }
  return false;
}

/** A table colour (alpha, red, green, blue) as one 0xrrggbb number, for a pooled light. */
function colourOf(c: readonly number[]): number {
  const to = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (to(c[1]) << 16) | (to(c[2]) << 8) | to(c[3]);
}
