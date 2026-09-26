import * as THREE from 'three';
import { packIdOf, type PlanetDef } from '../data/planets';
import type { Physics, RAPIER } from '../core/physics';
import { CreatureManager } from './creatures';
import { NpcManager, type NpcDeps } from './npcs';
import { MobileManager } from './mobiles/manager';
import type { Mobile } from './mobiles/mobile';
import { MobileAssets } from './mobiles/assets';
import { MobileCatalogue } from './mobiles/catalogue';
import { ambientOverrides } from './mobiles/spawning';
import { scratchWanted, wildlifeWanted } from './spawnSeed.ts';
import { DayCycle } from './daycycle';
import { SwgSky, type SkyLighting } from './sky';
import { Weather, type WeatherViewContext, type WeatherWorldContext } from './weather';
import { WEATHER_UNIFORMS, WET_WRAP, wetWrap } from './wetness';
import { resetWaterDepth, Splashes, updateWaterDepth, type WaterMaterial } from './water';
import { addSimBody, stepWaterSim, type SimBody } from './waterSim';
import { WaterBodies, type WaterBody } from './waterBodies';
import { envLightFrom, isLavaWater, shaderKey, type WaterLook } from './waterLook';
import { coveringWaterShader, onSeaSurface, surfaceReach, underwaterVerdict, waterTopAt, type WaterLineQuery } from './waterLineMath.ts';
import { SEA_FEED, seaFeedReport, seaHeight, seaSwellAt, swellScaleAt, tuneSeaFeed, type SeaFeedTune, type SwellWave } from './seaFeed.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createLavaMaterial, LAVA_LOOK, lavaGeometry, lavaHeatTable, loadLavaTextures, refreshLavaFar, standInLavaTextures, type LavaMaterial, type LavaTextures } from './lava';
import { FALLBACK_LAVA_STYLE, groupLava, lavaStyleFor, type LavaStyle } from './lavaStyle';
import { applyLavaHarm, LAVA_HARM, lavaHarmReport, lavaTickDamage, newLavaHold, resetLavaHarm, resetLavaHold, stepLavaHold, tuneLavaHarm, type LavaHarmTune } from './lavaHarmMath.ts';
import { burnReport, clearBurn, newPlayerBurn, takeBurn, tunePlayerBurn, type PlayerBurn, type PlayerBurnTune } from '../combat/burnMath.ts';
import type { HeatSources, LavaHeatTable } from './heatSources';
import { setEnvironment } from './envmap';
import { PropFactory, type Collider, type Exclusion, type ScatterItem } from './props';
import { FloraPlanter } from './flora';
import { GROUND_NORMAL, TerrainTextures } from './terrainTextures.ts';
import { AssetPack, type LoadedModel } from './assetPack';
import { OUTPOSTS } from '../data/outposts';
import { Group, groups, RAPIER as R } from '../core/physics';
import { CHUNK_RES, CHUNK_SIZE, Terrain } from './terrain';
import { SwgTerrain, type BuildingLayerSource, type SwgWaterTable } from './swgTerrain';
import { LayoutStreamer, type Building, type CellState, type PlacedObject } from './layoutStream';
import { blockedBy, blockerName, clearRadius, groundVerdict, patchOfBounds, patchProbes, spotAhead } from './housePlace.ts';
import { outdoorNav } from './nav/outdoorNav.ts';
import { wildLife, type WildDeps } from './wildLife.ts';
import { standingPeople, type PeopleDeps, type StandingRow } from './standingPeople.ts';
import { CLONING_TUNE, facilitiesNear, SPAWN_CELL_NAME, type FacilityChoice, type NamedPlace } from './cloning.ts';
import { isLiftCell, liftStops, stopAt, type LiftStop } from './lifts';
import type { SunInfo } from '../core/postfx';
import { luminance, pointIrradiance } from '../core/fx/bladeGlowMath.ts';
import { isShadowOnly } from '../core/fxRegistry.ts';
import { ProgramQueue, resolveLinks } from '../core/programQueue.ts';
import { PACE_TUNE, framesFor } from '../core/programPace.ts';
import { pacingHard, shaderBudget } from '../core/shaderWatch.ts';
import { addPointLight, fillCascades, luminanceOf, resetFxLights, setDirectional, type FxLights } from '../core/fx/lights';
import { ParticleEffects, type EffectHandle, type EffectSounds } from './particles';
import { Ambience, type AmbienceContext, type BedRow, type RoomRow } from '../audio/ambience.ts';
import { OUTSIDE, type SoundSpace } from '../audio/distance.ts';
import { FOOT_TUNE, type FootGround } from '../audio/footsteps.ts';
import type { LoopHost } from '../audio/emitters.ts';
import { loadSpacePack, type SpacePack } from '../space/spaceData.ts';
import { Nebulae, installNebulaDebug } from '../space/nebulae.ts';
import { dropForceLightning, loadForceLightning, stepForceLightning } from '../combat/forceLightning.ts';
import { dropLooseProps, loadLooseProps, loosePropAt, stepLooseProps } from './looseProps.ts';
import { prepareForceEffects } from '../combat/forcePowers.ts';
import { liveSettings } from '../core/settings.ts';
import { peerBodies, type RemoteBodies } from '../net/remoteBodies.ts';
import { remoteInteriors, type RemoteInteriors } from '../net/remoteInterior.ts';
import { watchPeers } from '../net/remotePlayers.ts';
import { ShipContacts } from '../space/contacts';
import { NpcShipManager } from '../space/npcShips';
import { ZONE_TIER } from '../space/roster';
import { SPACE_SKY_TUNE, spaceBodyStandIn, standingBodyMaxDepth, standingBodyPlace, type StandingBodyPlace } from '../space/suns';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { ACTOR_LAYER, INTERIOR_LAYER, markActor, type PortalRenderer } from './portalRender';
import { createPlaceholderSpeeder } from '../vehicles/speeder';
import { Dust } from '../vehicles/dust';
import { Garage, SpawnCancelled, type RefitReport, type VehicleDef } from '../vehicles/garage';
import { fitKey, type ResolvedFit } from '../vehicles/shipFit';
import { inTurn } from '../vehicles/shipMounts';
import { Vehicle, type VehicleKind, type VehicleSpec } from '../vehicles/vehicle';
import { SHIP_ROOM } from '../vehicles/landing';
import { Bolts } from '../combat/bolts';
import { ShipInterior } from '../vehicles/interior';
import { Gallery } from './gallery';
import { surfaces } from './surfaces';
import { TurretManager, type TurretTarget } from '../combat/turrets';
import { PLAYER_KEY, type Aggression, type Hittable, type Living, type Side } from '../combat/kit';
import { clashes } from '../combat/clash.ts';

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
/** The ground's normal under a foot, for the print laid there; a step allocates nothing. */
const footNormal = new THREE.Vector3();
/**
 * The point the water reader asks the buildings about. Its own vector rather than the file's shared
 * scratch: the question is asked from inside `footSurfaces.waterTop`, which the feet, the blade and
 * the bolts call from outside this file at any moment, and a borrowed scratch is the kind of thing
 * that is right until something up the stack borrows it too.
 */
const roomProbe = new THREE.Vector3();
const lumOf = (c: THREE.Color): number => luminance(c.r, c.g, c.b);
const tmpM = new THREE.Matrix4();
/** How far out a space zone's planets hang, and the radius (metres) a planet of size 1 has there. */
const SPACE_REACH = 3;
const SPACE_BODY_DISTANCE = 2600;
const SPACE_BODY_SIZE = 240;
/**
 * Segments round a sky body's depth stand-in. Its vertices sit on the sphere, so its rim polygon
 * falls inside the true rim by the cosine of half a segment, which the cap's angle is widened by:
 * the stand-in then covers the body's disc and no more than a hundredth of a degree beside it.
 */
const STAND_IN_SEGMENTS = 48;
/** The axis a plane is built about, before it is turned square to a body's direction. */
const QUAD_AXIS = new THREE.Vector3(0, 0, 1);
/** One record the per-frame placement of the standing bodies writes into, so no frame allocates. */
const standPlace: StandingBodyPlace = { drawnAt: 0, scale: 1, tan: 0, depthScale: 1 };
/** Detailed ground chunks each way, by default; the settings move it (World.viewRadius). */
const VIEW_RADIUS = 6;
const STREAM_BUDGET = 3;
/** Coarse distant terrain: tile size, vertex resolution and radius in tiles. */
const FAR_TILE = 512;
const FAR_RES = 32;
const FAR_RADIUS = 6;
/** Fog is authored for a short view; scale it for the long one. */
/** The sea plane around the player that swells, its subdivision, and the sky-driven light strengths. */
const WATER_NEAR = 3000;
const WATER_SEGMENTS = 200;
const SWG_MAIN_LIGHT = 2.4;
const SWG_AMBIENT = 1.3;
const SWG_FILL = 1.0;
/** The client's fog densities read far thicker here than in the game; planets can override this. */
const DEFAULT_SWG_FOG_SCALE = 0.08;
/** Interior lights: how many point lights may be live at once, and how the client's colours map to three's intensities. */
/** Point lights a room may have at once. Every one lengthens every interior shader (and on some drivers each costs a second of compile time), so no more than a room needs. */
const INTERIOR_LIGHT_CAP = 8;
const INTERIOR_LIGHT_SCALE = 3;
const INTERIOR_AMBIENT_SCALE = 1.2;
const INTERIOR_AMBIENT_FLOOR = 0.18;
/** Seconds between ripple passes: dense enough that a swimmer's rings overlap into a wake. */
const RIPPLE_INTERVAL = 0.12;
/**
 * Seconds a body is kept in the water's height field after it has left it (INVENTED). Long enough
 * that walking in and out of the shallows does not make and unmake a mesh every second, short
 * enough that nothing is held for a world it has left.
 */
const SIM_BODY_KEEP = 8;

/**
 * One answer about one point and the water over it (`World.cameraUnderwaterAt`). The caller keeps
 * the record and hands it back every time, because `under` is read before it is written: that is
 * where the hysteresis lives, and it is what keeps one asker's verdict steady on its own.
 */
export interface UnderwaterInfo {
  /**
   * The conservative answer: water may be over the point, a passing crest included. What must not be
   * caught wrong reads this -- the reflections and the lens flare -- and it is true for up to a metre
   * and a half over the open sea's mean surface.
   */
  under: boolean;
  /** The strict answer: the point is really below the surface. Anything that paints the picture reads this one. */
  submerged: boolean;
  /** Metres of water over the point, 0 when the answer is no and 0 inside the margin band. */
  depth: number;
  /** The colour of the water over the point, in the renderer's working space; the water material's own. */
  readonly color: THREE.Color;
  /** That water's own opacity, as the converter read it from the client's texture. */
  opacity: number;
  /**
   * How far a crest can lift the surface over the point (`surfaceReach`): the sea's own measured
   * swell where the surface is the sea, a lake's fixed reach otherwise, 0 where there is no water
   * over the point at all. The surface above is the flat table height and the one drawn is that
   * height displaced by up to this, either way, and nothing on this side knows which -- so anything
   * that must not be drawn in the air (the specks) keeps this much clear of the line.
   */
  reach: number;
  /** The look the colour and the opacity were read from, so nothing re-reads a colour string while the water does not change. */
  look: WaterLook | null;
}

/** A record for `World.cameraUnderwaterAt` to fill. Dry, with the neutral colour, until a first answer. */
export function createUnderwaterInfo(): UnderwaterInfo {
  return { under: false, submerged: false, depth: 0, color: new THREE.Color(0x2e7fbb), opacity: 0.75, reach: 0, look: null };
}

/** The one question `World.cameraUnderwaterAt` asks the rule, refilled rather than made, so no call allocates. */
const waterLineQuery: WaterLineQuery = { y: 0, surface: 0, reach: 0, wasUnder: false, lava: false, dry: false };

/**
 * The footprint a person leaves in the water: two legs and a torso between them, so a wader cuts
 * two lines rather than pushing a disc. Built once and shared, since every wader is the same
 * shape at this scale; a mount or a droid that wants its own outline can pass its real geometry.
 */
function buildWaderProxy(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leg = new THREE.CylinderGeometry(0.15, 0.12, 1.6, 8);
  const left = leg.clone(); left.translate(-0.19, 0.8, 0); parts.push(left);
  const right = leg.clone(); right.translate(0.19, 0.8, 0); parts.push(right);
  const torso = new THREE.CylinderGeometry(0.3, 0.26, 1.1, 10);
  torso.translate(0, 2.15, 0); parts.push(torso);
  leg.dispose();

  let count = 0;
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    count += n.attributes.position.count;
    return n;
  });
  const pos = new Float32Array(count * 3);
  let off = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // The proxy stands with its feet at the origin, so it is placed at the wader's own position and
  // sinks from there; the splat only cares how far below the surface each triangle reaches.
  out.translate(0, -1.6, 0);
  return out;
}
const FOG_SCALE = 0.18;
/** Physics colliders only exist this many chunks out; nothing dynamic lives farther away. */
const PHYSICS_RADIUS = 3;
/**
 * How far the shadow cascades reach. The shadow pass is by far the most expensive thing in the
 * frame -- casters are culled against the light's frustum, not the camera's, so a long reach
 * draws the whole disc around the player in every cascade. A shorter reach is also *sharper*:
 * the same shadow map covers less ground, so every texel is smaller. Raise it for longer
 * shadows at a steep cost, lower it for crisper ones.
 */
const SHADOW_DISTANCE = 320;
/**
 * Placed objects smaller than this (metres of model radius) never cast. A shrub's shadow is a
 * smudge under the shrub; paying a draw call per cascade for it is the single biggest waste in
 * the frame. Objects keep receiving shadows either way.
 */
const SHADOW_MIN_RADIUS = 1.2;
/**
 * Shadow look. The client's own ambient keeps shadowed surfaces readable; this scales it, and
 * below 1 the world sits darker than retail did. Radius is the blur in shadow-map texels --
 * three's PCF path is a 20-tap Vogel disk, so 1 is a crisp contact edge and 2-3 is soft.
 * Normal bias pushes the lookup along the surface normal to hide acne; large values detach a
 * shadow from whatever casts it, so it stays small and the depth bias does the work.
 */
const AMBIENT_SCALE = 0.8;
const SHADOW_RADIUS = 1.4;
/**
 * Both biases are measured in shadow-map texels of the cascade they belong to, not in fixed
 * numbers, because a texel is 5 cm in the near cascade and 30 cm in the far one -- a single
 * value is either acne up close or a detached shadow far away.
 *
 * The depth bias especially: three stores it normalised over the shadow camera's depth range,
 * so its meaning in metres is (bias x range). CSM defaults that range to 1..2000, which turned
 * a -0.0004 bias into 0.8 m of offset and erased every contact shadow -- a standing character
 * lost its legs, and the shadow only reappeared once they jumped clear of it.
 */
const SHADOW_NORMAL_BIAS_TEXELS = 1;
const SHADOW_BIAS_TEXELS = 0.5;
/**
 * The shadow camera's depth range. The light sits LIGHT_MARGIN behind the cascade's bounding
 * box, so the range only has to cover that plus the cascade's own reach; keeping it tight is
 * what makes the depth bias mean centimetres instead of metres.
 */
const LIGHT_MARGIN = 150;
const LIGHT_NEAR = 1;
/** How dark a shadow goes, 0..1. The ambient decides what light still reaches it. */
const SHADOW_INTENSITY = 1;
/**
 * Shadow map edge, per cascade. Crispness is texel density, not filtering: the near cascade
 * covers about 55 m, so 2048 puts a texel at 2.7 cm and 4096 at 1.3 cm. Each step doubles the
 * memory (three cascades at 4096 is roughly 200 MB of depth) without costing draw calls.
 */
const SHADOW_MAP_SIZE = 2048;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  colliders: Collider[];
  heights: Float32Array;
  physics: RAPIER.Collider[] | null;
}


const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uNightTop;
  uniform vec3 uNightHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSun1;
  uniform vec3 uSun2;
  uniform vec3 uMoon;
  uniform float uSuns;
  uniform float uDay;
  uniform float uSunset;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 sunDisc(vec3 d, vec3 s, float strength) {
    float c = dot(d, s);
    return uSunColor * strength * (smoothstep(0.9975, 0.9992, c) * 1.6 + pow(max(c, 0.0), 32.0) * 0.28 + pow(max(c, 0.0), 4.0) * 0.06);
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y, 0.0, 1.0);
    vec3 top = mix(uNightTop, uTop, uDay);
    vec3 horizon = mix(uNightHorizon, uHorizon, uDay);
    vec3 flatD = normalize(vec3(d.x, 0.0, d.z));
    vec3 flatS = normalize(vec3(uSun1.x, 0.0, uSun1.z));
    horizon += vec3(0.6, 0.22, 0.02) * uSunset * pow(max(dot(flatD, flatS), 0.0), 3.0);
    vec3 col = mix(horizon, top, pow(t, 0.5));
    float sunVis = smoothstep(-0.12, 0.0, uSun1.y);
    col += sunDisc(d, uSun1, sunVis);
    if (uSuns > 1.5) col += sunDisc(d, uSun2, sunVis);
    float moon = smoothstep(0.9988, 0.9996, dot(d, uMoon));
    col += vec3(0.85, 0.88, 0.95) * moon * (1.0 - uDay * 0.8);
    float star = smoothstep(0.988, 1.0, hash(floor(d * 140.0))) * (1.0 - uDay) * smoothstep(0.0, 0.15, d.y);
    col += vec3(star);
    col = mix(col, horizon * 0.85, clamp(-d.y * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The standing "nobody has said what a blow does yet" callback, so `update` can tell. */
const NO_HURT = (): void => {};

/** How many of an actor's textures are uploaded before the frame is given a turn (`prepareActor`). */
const TEXTURES_PER_YIELD = 4;

/**
 * False when local storage holds `swg.shaderPace` = '0' (read once): the whole of the pacing is
 * then off and the game is what it was before it. A tier of placed objects is added to the scene
 * and drawn the moment it loads, and every other deferred compile -- an actor, a vehicle, a peer,
 * a weapon, an NPC hull -- is built outright a mesh at a time rather than a program a frame, which
 * is exactly what `compileReady` did before the queue existed. So the cost of being the first
 * frame to draw a material nothing had built can be seen on a real machine and compared with the
 * hold. Nothing about the picture differs either way -- the same objects, the same materials, the
 * same frame they are drawn in once they are up -- only which frame pays for their programs.
 *
 * What the switch does **not** undo is `resolveLinks`, which finishes a program's link where the
 * first draw used to. That is not pacing: it is the difference between a ship prepared in ten
 * seconds and one prepared at once, and putting it back would be putting a fault back.
 *
 * It is read once, so it takes effect on the next world loaded.
 */
const SHADER_PACING: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.shaderPace') !== '0';
  } catch {
    return true;
  }
})();

/**
 * Told when the player lands a blow: what was hurt, by how much, and whether that blow finished it.
 * The interface's damage feedback is the one thing that listens (`World.watchPlayerHits`).
 */
export type PlayerHitWatch = (target: Living, amount: number, killed: boolean) => void;

/**
 * The player as one of the living: the only one the game makes exactly one of, so its key is a
 * named constant. `main` fills in where it stands, whether it may be attacked at all (noclip,
 * aboard, dead: not) and what a blow does, once a frame before everything alive is stepped.
 */
class PlayerTarget implements Living {
  readonly key = PLAYER_KEY;
  readonly label = 'you';
  readonly side: Side = 'player';
  readonly aggression: Aggression = 'aggressive';
  readonly pos = new THREE.Vector3();
  readonly halfHeight = 0.9;
  /**
   * False while the player may be attacked; true while noclipping, aboard, dead or not
   * simulating. It starts true, so nothing can pick on a player at the origin before the loop
   * has said where they are.
   */
  dead = true;
  /** What the loop does with a blow, and where it came from: it filters mounted, noclip and aboard itself. */
  hurt: (damage: number, from?: THREE.Vector3) => void = NO_HURT;
  /**
   * The fire the player is carrying, if any: how hard it burns, how long it has left and where its
   * tick clock stands (`src/combat/burnMath.ts`, which owns every rule about it).
   *
   * It lives **here**, on the record every striker already reaches, rather than on the player's own
   * body, because `afflict` is the one contract a flame has ever had and this is the object it is
   * offered to. It is spent in `Player.update`, beside the regeneration delay, so it pauses with a
   * panel exactly as regeneration does and `__debug.advance` steps it.
   */
  readonly burn: PlayerBurn = newPlayerBurn();
  /**
   * Whether the player is alight right now: the one thing anything outside this file need ask, and
   * what the burning manager reads to decide whether to draw, sound and heat a fire on them.
   */
  get burning(): boolean {
    return this.burn.left > 0;
  }
  /**
   * And **how long it has left**, which is the reading every other living thing answers and the one
   * the burning manager picks bodies by: it refuses to light a fire for the last fraction of a burn,
   * so it wants the seconds and not a yes or no. A `burning` that answered only *whether* left the
   * player's own fire invisible, silent and unheated while their health bar was being eaten, and
   * nothing anywhere would have failed or warned -- the field is optional on the manager's side, so
   * the mismatch is exactly the kind that type checking cannot see.
   *
   * There is deliberately **no** `dead` test in it, unlike the creature's and the mobile's. On this
   * record `dead` means noclipping, aboard a hull's rooms or in a panel as well as really down, and
   * the manager draws on a body that may be attacked while it chimes on the burn itself: a walk up a
   * boarding ramp must not sound as though the fire had gone out and come back. A body that has
   * really died carries no burn to read, because the fire is put out where the body dies
   * (`Player.startRagdoll`).
   */
  get burningFor(): number {
    return this.burn.left;
  }
  radiusToward(): number {
    return 0.35;
  }
  /**
   * `from` is where whatever struck was standing. It is a parameter of the contract every striker
   * already passes, and it is handed straight to the callback, which is what turns the red flash into
   * an arc on the side the blow came from.
   */
  damage(amount: number, from?: THREE.Vector3): void {
    this.hurt(amount, from);
  }
  /**
   * Set the player alight for a while: `dps` a second for `seconds`, the greater of `dps x seconds`
   * winning, exactly as it does on a creature, a fighter and a mobile. It is the same method on the
   * same contract, so anything that can already set one of those alight sets the player alight with
   * no change to itself.
   *
   * `dead` here is the record's own meaning -- not simulated, noclipping, aboard a hull's rooms,
   * dying or down -- and refusing then is what keeps this in step with the rest of the record: a
   * body nothing may hurt is a body nothing may set alight either.
   */
  afflict(dps: number, seconds: number): void {
    if (this.dead) return;
    takeBurn(this.burn, dps, seconds);
  }
  /**
   * The fire out and forgotten, in **silence**: a death, a travel, a respawn, a switch turned off.
   * Nothing is said, deliberately -- "the fire is out" over a corpse, or shouted at a loading
   * screen, is the one line this ought never to say.
   */
  clearBurn(): void {
    clearBurn(this.burn);
  }
}

export class World {
  planet!: PlanetDef;
  terrain!: Terrain;
  creatures!: CreatureManager;
  /** The fighters stood to fight the player and each other, on this planet. */
  npcs!: NpcManager;
  /** Everything stood from the creature and NPC catalogue on this planet (the `mobiles` pack). */
  mobiles!: MobileManager;
  /** How many may be spawned and how far their clips run: the settings, kept for the managers later loads make. */
  private mobileDetail = { cap: 40, animRange: 160 };
  /** The mobiles' version the target list was last built at. */
  private mobilesAt = -1;
  /**
   * Set by the game: a sentence when the player is somewhere nothing may be stood (aboard a
   * ship's rooms), else null. Asked by the mobiles' manager on every spawn, whoever calls it.
   */
  refuseMobiles: (() => string | null) | null = null;
  /** What the fighters need from the game, kept across planets and given to each new manager. */
  npcDeps: Partial<NpcDeps> = {};
  /** The player as something that can be hurt and fought: its place and state are set each frame. */
  readonly playerTarget = new PlayerTarget();
  /**
   * Seconds of simulated play since the world loaded: advanced by `stepLiving`, by dt, never from
   * a wall clock, so `__debug.advance` exercises everything that runs on a timer.
   */
  simTime = 0;
  /** Whether the caller has said where the player stands since the last `update`; see `update`. */
  private playerTargetSet = false;
  /** The one list handed round each frame, rebuilt only when a manager has gained or lost a body. */
  private readonly livingList: Living[] = [];
  private livingAt = { creatures: -1, npcs: -1, peers: -1, player: false };
  /** Who is told when the player lands a blow (`watchPlayerHits`), and which bodies already tell them. */
  private hitWatch: PlayerHitWatch | null = null;
  private readonly hitWatched = new WeakSet<Living>();
  /** Blaster turrets standing near where the player arrived. */
  turrets!: TurretManager;
  /** The gallery world's labels and animated mannequins, on that planet only. */
  gallery: Gallery | null = null;
  /** Every blaster bolt in the air, whoever fired it. */
  readonly bolts: Bolts;
  readonly day = new DayCycle(0, 1);
  /** Every vehicle on the world: the placeholder bike and whatever the garage (B) spawned. */
  readonly vehicles: Vehicle[] = [];
  garage: Garage | null = null;
  /**
   * The ships that fight (NPC ships, the player's, idle garage ships), beside the living list and not in it.
   * Assigned in the constructor right after `bolts.visuals` (it reads `shipFx` and `bolts`, both made there).
   */
  readonly ships: ShipContacts;
  /** This world's NPC ships (patrols and the NPC tab's), made by `load`; null before the first load. */
  npcShips: NpcShipManager | null = null;
  /** The ship the player flies or is aboard, and whether play is simulated: both set by the game's `stepVehicles` every step. */
  playerShip: Vehicle | null = null;
  /**
   * Whatever the player rides or drives, or null: set by the game's `stepVehicles` every step, which
   * runs in the frame loop and in `__debug.advance` alike. It is what an environmental hurt reaches
   * instead of the rider, since a rider in a flow is inside the thing that is burning.
   */
  playerRides: Vehicle | null = null;
  /**
   * The player's whole health, for a hazard that takes a share of it rather than a number of points;
   * set beside `playerRides`. It is 100 today and the default is the same 100, so the tick is right
   * whether or not the game ever writes it.
   */
  playerMaxHp = 100;
  /**
   * What the world says once, in words: the game's message line (main sets it). Null with nothing
   * listening, which is every test and every headless use, and nothing here may depend on it.
   */
  onNote: ((text: string) => void) | null = null;
  simulating = true;
  private props!: PropFactory;
  private readonly chunks = new Map<string, Chunk>();
  private readonly farTiles = new Map<string, THREE.Mesh>();
  private readonly chunkRoot = new THREE.Group();
  private lastTx = Number.NaN;
  private lastTz = Number.NaN;
  private readonly terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private water: THREE.Mesh | null = null;
  private localWater: THREE.Mesh[] = [];
  /** Real flora from the planet's terrain, replacing procedural props when a pack provides the models. */
  private flora: FloraPlanter | null = null;
  /** The planet's ground textures, when the pack carries them; the ground material comes from here. */
  private groundTextures: TerrainTextures | null = null;
  /** Texture anisotropy the renderer supports, set once by main. */
  static anisotropy = 4;
  /** Detailed ground chunks each way around the player, and coarse far tiles; the settings move them. */
  viewRadius = VIEW_RADIUS;
  farRadius = FAR_RADIUS;
  /** How far placed objects load, over the game's ranges; the settings move it. */
  objectReach = 1;
  private readonly dayFog = new THREE.Color();
  private readonly nightFog = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly moonColor = new THREE.Color(0x8fa8d8);
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private exclusions: Exclusion[] = [];
  pack: AssetPack | null = null;
  packStatus = 'no pack';
  /** How far the pack's own loading has got, 0 to 1, by stage; the loading screen reads it. */
  packProgress = 1;
  private packBase = '';
  private readonly structures: THREE.Object3D[] = [];
  private structureColliders: RAPIER.Collider[] = [];
  private layoutStream: LayoutStreamer | null = null;
  /** Particle effects from the pack (campfires, smoke, sparks), placed by the streamer. */
  private particles: ParticleEffects | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  /** The building cell the player is in, or null outside. */
  cellState: CellState | null = null;
  private readonly prevPlayerPos = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly hiddenGround: THREE.Object3D[] = [];
  private groundHiddenFor: Building | null = null;
  private csm: CSM | null = null;
  /** How far the cascades reach; `__debug.shadows(m)` rebuilds them at a new distance. */
  shadowDistance = SHADOW_DISTANCE;
  /** Model radius below which a placed object does not cast; `__debug.shadows(m, r)` changes it. */
  shadowMinRadius = SHADOW_MIN_RADIUS;
  /** Multiplier on the sky's ambient: below 1 is darker than retail. */
  ambientScale = AMBIENT_SCALE;
  private shadowRadius = SHADOW_RADIUS;
  private shadowIntensity = SHADOW_INTENSITY;
  private shadowMapSize = SHADOW_MAP_SIZE;

  /** Which ramp row feeds ambient, and how hard. Reports the colour it lands on. */
  setAmbient(row?: number, scale?: number): { row: number; scale: number; color: string; intensity: number; ground: string; shadowRow: string | null } {
    if (row !== undefined && this.swgSky) this.swgSky.ambientRow = row;
    if (scale !== undefined) this.ambientScale = scale;
    return { row: this.swgSky?.ambientRow ?? -1, scale: this.ambientScale, color: this.hemi.color.getHexString(), intensity: this.hemi.intensity, ground: this.hemi.groundColor.getHexString(), shadowRow: this.swgSky?.lighting.shadow.getHexString() ?? null };
  }
  /** The planet's own sky when its pack carries one; the procedural dome is hidden while it is up. */
  swgSky: SwgSky | null = null;
  /** Rain, dust storms and snow, and which area's rows the sky draws (weather.ts). Made in the constructor. */
  readonly weather: Weather;
  /** Set by main before update: the player is aboard a ship's rooms. */
  aboard = false;
  /** Set by main before update: the ship the player rides (its box keeps rain out of the canopy), or null. */
  weatherHull: Vehicle | null = null;
  /** Set by main before update: whatever the player rides (never a roof for the rain), or null. */
  weatherRidden: Vehicle | null = null;
  /** How far the weather has faded the cascades' shadows: 1 none, 0 a storm row that turns them off. */
  private weatherShadowScale = 1;
  private readonly groundAtCached = (x: number, z: number): number | null => this.terrain.heightIfCached(x, z, FAR_TILE, FAR_RES);
  private readonly waterAtFn = (x: number, z: number): number => this.terrain.waterHeightAt(x, z);
  /** Set by main: needed to filter the sky into an environment map for reflective surfaces. */
  renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  /** The first face of the reflection cube wanted (loading or loaded), or null while the dome is filtered instead. */
  private envWant: string | null = null;
  /** First faces of cubes that failed to load: never asked for again on this sky. */
  private readonly envFailed = new Set<string>();
  private envTimer = 99;
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0);
  private waterFar: THREE.Mesh | null = null;
  private waterTime = 0;
  private readonly waterMaterials: WaterMaterial[] = [];
  /** Every water surface with the look its own terrain shader asks for, and what it reflects. */
  readonly waterBodies = new WaterBodies();
  private waterNear: WaterBody | null = null;
  private waterFarBody: WaterBody | null = null;
  /** Heat sources the effects read: the lava tables are handed over here (App sets it). */
  heat: HeatSources | null = null;
  /** Lava where the terrain puts it: one merged mesh per look (loadLava). */
  private readonly localLava: THREE.Mesh[] = [];
  private readonly lavaMaterials: LavaMaterial[] = [];
  /** Per table (shared with the heat haze) and merged. */
  private readonly lavaGeometries: THREE.BufferGeometry[] = [];
  /** Owned by this planet: never the runtime noise or the stand-in ramp, which live for the app. */
  private readonly lavaTextures: THREE.Texture[] = [];
  private readonly lavaTables = new Set<SwgWaterTable>();
  private lavaLooks: { style: string; tables: number; textures: LavaTextures['source'] }[] = [];
  /**
   * The hazard tick's own clock, in simulated seconds and only while play runs, so a panel held open
   * over a flow does not bank up a minute of burning to be paid the moment it closes. It is not
   * `simTime` minus a mark for the same reason.
   */
  private lavaClock = 0;
  /**
   * The tick's standing in the flow: the verdict, whether this very step's own was true, how long it
   * has been false, and the last depth that really was in it (`LavaHold` in `lavaHarmMath.ts`). The
   * record and the one function that steps it are shared with the player's sink, so the burn and the
   * drop on the figure draw the same line from the same numbers rather than each writing the rule
   * out -- which is how one of them came to have the hysteresis band without the bridge across it.
   */
  private readonly lavaHold = newLavaHold();
  /** What is burning right now, so the message line is told once when it starts and once when it stops. */
  private lavaBurning: 'no' | 'you' | 'ride' = 'no';
  /** Multiplier on the sky's fog density, for tuning from the console. */
  fogScale = 1;
  /** The player's own fog setting, over the planet's: 1 as the planet has it. */
  userFog = 1;
  private rippleClock = 0;
  /** Where each mover was at the last ripple pass, for its velocity through the water. */
  private readonly lastSeen = new WeakMap<object, THREE.Vector3>();
  /** One body in the water's height field per thing that wades, swims or floats. */
  private readonly simBodies = new Map<object, SimBody>();
  /** Bodies touched this frame; the rest are switched off so they cost nothing. */
  private readonly simSeen = new Set<object>();
  /** How long each body has been out of the water, so one that has gone for good can be let go. */
  private readonly simIdle = new Map<object, number>();
  /** A hull box per vehicle spec, shared by every vehicle of that kind. */
  private readonly hullProxies = new Map<string, THREE.BufferGeometry>();
  private waderProxy: THREE.BufferGeometry | null = null;
  private readonly splashes = new Splashes();
  private readonly dust = new Dust();
  private dustDue = 0;
  private readonly dustColor = new THREE.Color();
  /**
   * A fixed pool of lights for building interiors, on the interior layer only: the cell the
   * player is in borrows them. A fixed count keeps the shader variants stable, so entering a new
   * room never recompiles every material in the scene.
   */
  private readonly interiorPoints: THREE.PointLight[] = [];
  private readonly interiorParallel = new THREE.DirectionalLight(0xffffff, 0);
  private readonly interiorAmbient = new THREE.AmbientLight(0xffffff, 0);
  private interiorLightsFor: { building: Building; cell: number } | null = null;
  private portals: PortalRenderer | null = null;
  private readonly csmMaterials = new WeakSet<THREE.Material>();
  private csmScanAt = 0;
  private loadToken = 0;
  /**
   * True while this world is being loaded only to stand a character in one of the captured places.
   *
   * It skips exactly one thing: the placed-object streamer. The ground, the sky, the water, the
   * flora and the weather all load and run as they always do, because those are what make the hour
   * real; the objects come from `scenes/`, already culled to the one frustum that camera can see.
   * Set before `loadPack` and cleared when the world is left.
   */
  sceneOnly = false;

  /** The ships pack's particle effects (bolts in flight, their hits), played wherever the ships go, on every planet. */
  readonly shipFx: ParticleEffects;
  /** The weapons pack's particle effects: the guns' own bolts, muzzle flashes, hits and beams. */
  readonly weaponFx: ParticleEffects;
  private readonly warmedFx = new Set<string>();

  constructor(readonly scene: THREE.Scene, readonly physics: Physics) {
    // First: nothing below reads it, but main configures it right after constructing the world.
    this.weather = new Weather(physics);
    this.bolts = new Bolts(scene);
    this.shipFx = new ParticleEffects(scene, `${import.meta.env.BASE_URL}assets-private/ships/`);
    this.weaponFx = new ParticleEffects(scene, `${import.meta.env.BASE_URL}assets-private/weapons/`);
    this.bolts.weaponVisuals = this.weaponFx;
    this.bolts.visuals = this.shipFx;
    // The ships that fight: here, since shipFx and bolts are made just above. npcDeps is a field initialiser (so
    // it exists), and the garage is read when a combat is made, not now.
    this.ships = new ShipContacts(this.shipFx, this.bolts, () => this.npcDeps.effects ?? null, () => this.garage ?? null);
    this.ships.onShipDown = (v) => this.npcShips?.destroyed(v, this.simTime);
    void this.ships.load(import.meta.env.BASE_URL);
    // The rooms of a hull another player flies are bound to this world now rather than on the first
    // ask: binding is what lets go of the rooms built in the world before this one (their bodies are
    // in a physics world that is about to be freed), and what puts them in earshot of the peers.
    // Nothing is built until somebody asks for a hull to be made a place.
    this.remoteRooms();
    scene.add(this.chunkRoot, this.sun, this.sun.target, this.hemi, this.fill, this.fill.target, this.splashes.points, this.dust.points);
    markActor(this.splashes.points);
    markActor(this.dust.points);
    for (let i = 0; i < INTERIOR_LIGHT_CAP; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.layers.set(INTERIOR_LAYER);
      this.interiorPoints.push(l);
      scene.add(l);
    }
    this.interiorParallel.layers.set(INTERIOR_LAYER);
    this.interiorAmbient.layers.set(INTERIOR_LAYER);
    scene.add(this.interiorParallel, this.interiorParallel.target, this.interiorAmbient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(7000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uNightTop: { value: new THREE.Color(0x04060e) },
          uNightHorizon: { value: new THREE.Color(0x0e1424) },
          uSunColor: { value: new THREE.Color() },
          uSun1: { value: new THREE.Vector3() },
          uSun2: { value: new THREE.Vector3() },
          uMoon: { value: new THREE.Vector3() },
          uSuns: { value: 1 },
          uDay: { value: 1 },
          uSunset: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    markActor(this.sky);
  }

  // ---- The sound the world makes. ----

  /**
   * The area's beds, the room's bed, the game's placed sound objects and the loops a particle
   * effect names. Null until the game hands its mixer over, which is what a gallery, a preview or a
   * node test does not do: the world then runs exactly as it did before there was any sound.
   */
  ambience: Ambience | null = null;
  /** Where the ear is, written by the game after its camera's last move; -1 is the open world. */
  readonly listenerSpace: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };
  private audio: LoopHost | null = null;
  /** The game's own numbering of buildings and boarded hulls, so a sound and the ear agree on "the same room". */
  private spaceId: (of: object | null) => number = () => -1;
  /** The sky and the effects this planet's sound has already been wired to (both arrive with the pack). */
  private soundSky: SwgSky | null = null;
  private soundParticles: ParticleEffects | null = null;
  private soundPack: AssetPack | null = null;
  /** The sound pack's own tables, once the bank has them; handed to the ambience for the room beds. */
  private soundTables: object | null = null;
  /** The grid pass count the last update saw, so the sources' own bounded work runs on the grid's beat. */
  private soundPass = -1;
  /** This frame's sky rows for the beds; a kept array, refilled, so a frame allocates nothing. */
  private readonly bedRows: BedRow[] = [{ sounds: null, weight: 0 }, { sounds: null, weight: 0 }, { sounds: null, weight: 0 }, { sounds: null, weight: 0 }];
  private bedRowCount = 0;
  /** The interior row for the room the player is in, kept while the room is the same. */
  private roomRow: RoomRow | null = null;
  private roomFor: object | null = null;
  private roomForCell = -1;
  /** Which version of the interior tables that row was looked up in; both tables arrive late. */
  private roomForTables = -1;
  /** Handed to WorldEmitters; a kept object, since the emitters copy the two numbers out of it. */
  private readonly foundSpace: SoundSpace = { building: -1, cell: -1 };
  /** Handed to the ambience every frame; a kept object, refilled, so a frame allocates nothing. */
  private readonly bedContext: AmbienceContext = { rows: this.bedRows, rowCount: 0, daylight: 1, room: null, space: this.listenerSpace, pass: false };

  /**
   * The mixer, and the game's own numbering of the spaces a sound or the ear can be in. Called once,
   * before any planet loads.
   */
  attachAudio(audio: LoopHost, spaceIdOf: (of: object | null) => number): void {
    this.audio = audio;
    this.spaceId = spaceIdOf;
    this.ambience = new Ambience(audio, import.meta.env.BASE_URL);
    this.ambience.sources.spaceAt = (x, y, z) => {
      const state = this.layoutStream?.buildingAt(tmpV.set(x, y, z));
      if (!state) return null;
      this.foundSpace.building = this.spaceId(state.building);
      this.foundSpace.cell = state.cell;
      return this.foundSpace;
    };
  }

  /**
   * One of the game's sounds played once, at a point or (with no point) at the ear. The one way in
   * for everything the world does that is not a bed or a standing emitter -- a client effect's own
   * `PSND`, a lift, a hit. Returns the voice's key, or 0 when there is no mixer, no such template or
   * no free voice; `__debug.audio().recent` says which.
   */
  playSound(id: string, x?: number, y?: number, z?: number, space?: SoundSpace): number {
    return this.audio?.play(id, { x, y, z, space }) ?? 0;
  }

  /**
   * What the world's sound does with a placed particle effect: a standing one (a waterfall, a fire,
   * a steam vent) keeps a loop that follows it, and a passing one (a hit, a burst) plays each sound
   * it names once where it plays. Kept, so nothing is allocated when an effect is placed.
   */
  private readonly effectSounds: EffectSounds = {
    start: (handle, sounds, x, y, z) => {
      if (sounds[0]) this.ambience?.sources.attach(handle, sounds[0], x, y, z, handle.contained);
    },
    move: (handle, x, y, z) => this.ambience?.sources.moveAttached(handle, x, y, z),
    once: (handle, sound, x, y, z) => {
      const space = handle.contained ? (this.ambience?.sources.spaceAt?.(x, y, z) ?? undefined) : undefined;
      this.playSound(sound, x, y, z, space);
    },
    stop: (handle) => this.ambience?.sources.detach(handle),
  };

  /**
   * The beds this planet can play asked for, the placed effects wired to the mixer, and the weather
   * given somewhere to send its channels' sounds. The sky and the effects both arrive inside
   * `loadPack`, which runs after `warmUp`, so this is called from both and does its work on the
   * first call that finds them -- still behind the loading screen, which does not lift until the
   * pack is in and its programs are built.
   */
  private readySound(): void {
    const a = this.ambience;
    if (!a) return;
    if (this.weather.audio !== a) this.weather.audio = a;
    // The shared interior table comes with the sound pack, some frames after the game starts; the
    // rooms it names are the same on every planet, so it is handed over once and then kept.
    const tables = this.audio?.bank.sources ?? null;
    if (tables !== this.soundTables) {
      this.soundTables = tables;
      a.setRooms((tables?.rooms as RoomRow[] | undefined) ?? null);
    }
    if (this.pack !== this.soundPack) {
      this.soundPack = this.pack;
      // The emitters' places are the snapshot's own, so they need the layout's centre to be put
      // down, exactly as every other placed object does. A pack with no layout has no emitters, and
      // its centre is nothing either way.
      if (this.pack) this.ambience?.setFrame(this.pack.layout?.center.x ?? 0, this.pack.layout?.center.z ?? 0);
    }
    if (this.particles !== this.soundParticles) {
      this.soundParticles = this.particles;
      if (this.particles) this.particles.sounds = this.effectSounds;
    }
    if (this.swgSky === this.soundSky) return;
    this.soundSky = this.swgSky;
    if (!this.swgSky) return;
    const buildings: string[] = [];
    for (const m of this.pack?.category('layout') ?? []) if ((m.cells?.length ?? 0) > 1) buildings.push(m.id);
    a.prepare(this.swgSky.data.blocks, buildings);
  }

  /** The interior table's row for the room the player stands in, or null in the open. */
  private roomRowNow(): RoomRow | null {
    const state = this.cellState;
    if (!state) {
      this.roomFor = null;
      this.roomForCell = -1;
      this.roomRow = null;
      return null;
    }
    const def = state.building.model.def;
    // The tables' version is part of the key: the shared interior table arrives some frames after
    // the game starts and a planet's own rows with its pack, and a row looked up before either
    // landed is the table's fallback. Standing in the room as the pack lands would otherwise keep
    // that answer until the player changed cell.
    const tables = this.ambience?.tableVersion ?? -1;
    if (def === this.roomFor && state.cell === this.roomForCell && tables === this.roomForTables) return this.roomRow;
    this.roomFor = def;
    this.roomForCell = state.cell;
    this.roomForTables = tables;
    let name = 'default';
    for (const c of def.cells ?? []) if (c.index === state.cell) name = c.name;
    // A building's model key is the portal layout's own name, which is what the interior table keys
    // its rows on: the 166 buildings it names match the packs' model ids, and the rest fall through
    // to the table's `default` row as they did in the client.
    this.roomRow = this.ambience?.roomRow(def.id, name) ?? null;
    return this.roomRow;
  }

  /**
   * Whether a point stands in a building's room, for the water rule in `footSurfaces.waterTop`: the
   * streamed buildings' own cell boxes, which is the very answer `footSurfaces.roomSurface` and the
   * sound's `space` already take for a point that is not the player's. A building whose interior has
   * not been built yet still answers, since the boxes come with the model's def and not with the
   * meshes; a building the streamer has not reached does not, and nobody is standing in one of those.
   *
   * It is **not** the player's tracked cell. That cell is the better answer for the player and only
   * for the player -- it is walked through doorways rather than read off boxes -- and this reader is
   * asked about a fighter's blade and a mobile's feet as readily as about the player's own. What the
   * boxes cost when they are wrong is a step near a wall that a room's box overhangs; what reading
   * the player's cell instead would cost is every other body's answer.
   *
   * A kept arrow, so the reader hands it over without allocating a closure per call, and
   * `LayoutStreamer.indoorsAt` rather than its `buildingAt`, which allocates a `{ building, cell }`
   * per hit: this answers with a number out of `cellAt` and allocates nothing at all.
   *
   * Public because the console reports it (`__debug.player().inRoom`). It is the reader's **own**
   * answer, which is the only honest witness for what the reader did: the box test over the streamed
   * buildings, which answers before a building's interior is built and before any cell is tracked,
   * and so can differ from `World.inside` (the portal-walked cell) in either direction.
   */
  readonly indoorsAt = (x: number, y: number, z: number): boolean => {
    const stream = this.layoutStream;
    if (!stream) return false;
    return stream.indoorsAt(roomProbe.set(x, y, z));
  };

  /**
   * **The second water reader: the sea as it is drawn, for what floats and for nothing else.**
   *
   * The flat table (exactly what `Terrain.waterHeightAt` answers, lava tables and all) plus the
   * swell's own height over the point. Every reader that is not about floating keeps the flat one and
   * must go on keeping it: the swell reaches about 1.19 m and a wader swims at 1.1 m of water, so a
   * breathing shared height would flip a body in and out of swimming with every crest. The swim
   * line, the feet, the blade, the spawn heights, the splashes, the weather and the camera's own
   * water line all read `waterHeightAt`, `waterColumnAt` or `footSurfaces.waterTop`.
   *
   * There is exactly one other consumer, and it is a consequence of this one rather than a second
   * decision: a rule that measures **a floating hull's own height** against a water surface must read
   * the same surface the springs floated it on, or the wave eats the margin between them and the rule
   * flickers at sea. `Vehicle.onWater` does, and the wake's depth window does through `seaSwellOver`
   * below. Nothing else in the game may.
   *
   * It answers the flat height **exactly**, to the bit, wherever the swell does not reach:
   *   * over a lake or a pool, because a surface that is not the global table's own height is not
   *     the sea (`onSeaSurface`, the same float-exact compare the camera's water line takes). That
   *     is the **only** guard a lake has here, and it is one guard rather than two: the wave
   *     uniforms read below are always the near sea's own material's, whose `uWaveHeight` is 1, and
   *     a lake's own flat material is never asked;
   *   * in water under 0.3 m, and **only** under it: the shader's own `smoothstep(0.3, 5, depth)` is
   *     what is mirrored, so the swell is dead at 0.3 m, half of it is there at 2.65 m and the whole
   *     of it by 5 m. "The shallows are unchanged" is true of the shoreline, where the surface must
   *     hold still, and not of a hull in three metres of water, which bobs by about half the sea;
   *   * over a flow, since the lava planet's global table is not a sea to swell;
   *   * with the switch off (`__debug.sea({ on: false })`) or with no wave sum registered.
   *
   * Two things it does **not** answer, because a reader that looks exhaustive is read as one:
   *   * it has no room rule of its own. A hull inside a building floats on neither water, and that
   *     is `Vehicle.update`'s doing -- it passes no sea reader at all while `inRoom`. The next
   *     caller gets no such guard and must bring its own, as every other water reader's caller does.
   *   * with `farFade` off (the default) it answers the swell at any distance, while the drawn sea
   *     is flat wherever the near plane does not reach: that plane is 3000 m across and follows the
   *     player, so a hull more than about 1500 m from the player floats on a swell the far ring
   *     draws flat (`waves: false`, `uWaveHeight` 0). Nothing is watched at that range today. It is
   *     a second disagreement with the picture and not the same one as the mesh's 15 m quads.
   *
   * `groundY` is the ground height under the point where the caller already has it -- the hover
   * springs work it out for every corner before they ask -- so the depth costs nothing there; leave
   * it out and the terrain is asked. Allocates nothing and makes no closure: it is called once per
   * hover point per physics step.
   */
  seaAt(x: number, z: number, groundY = Number.NaN): number {
    const terrain = this.terrain;
    if (!terrain) return -Infinity;
    const flat = terrain.waterHeightAt(x, z);
    return seaHeight(flat, this.swellOver(x, z, flat, groundY));
  }

  /**
   * The swell **alone** over a point: exactly what `seaAt` adds to the flat table, and 0 wherever it
   * adds nothing at all. For a caller that already has the flat height in hand and wants to know how
   * far the drawn sea stands over it -- the wake's own depth window, which measures a hull that now
   * rides the waves against a surface read from the flat table.
   */
  seaSwellOver(x: number, z: number, groundY = Number.NaN): number {
    const terrain = this.terrain;
    if (!terrain) return 0;
    return this.swellOver(x, z, terrain.waterHeightAt(x, z), groundY);
  }

  /**
   * The swell over a point whose flat surface the caller **already has in hand**, which is every
   * body that floats: the swim reads the lava-filtered column and a swimming creature reads the
   * terrain's own table, and neither wants that sampling done twice. 0 is "no swell here", so a
   * lake, a pool, the shallows and a planet with no sea all answer the flat surface unchanged.
   *
   * `groundY` is only the depth the swell fades out in; left out, it is sampled, which costs
   * nothing that is not already warm because the guards above it mean this line is reached only
   * over a swelling sea.
   */
  seaSwellOverFlat(x: number, z: number, flat: number, groundY = Number.NaN): number {
    return this.swellOver(x, z, flat, groundY);
  }

  /**
   * Why the swell over a point is the height it is: every term the fade is built from, in the order
   * it is applied, and the first one that took it to nothing. For the console only -- it samples
   * the ground and builds an object.
   *
   * It exists because "the body is not riding the wave I can see" has half a dozen causes that look
   * identical from outside: the switch, a mesh with no swell (every lake and the far ring carry
   * `uWaveHeight` 0), water too shallow to carry one, the camera fade, our own scale, and a ground
   * height that is not the seabed. The last is the one worth naming: the fade is on the water's
   * **depth**, and a reader that believes the water is a metre deep asks for a fiftieth of the wave
   * a reader that knows it is forty metres deep asks for -- while the shader, which reads its own
   * grid of ground heights, carries on drawing the wave it always drew.
   */
  seaSwellWhy(x: number, z: number, groundY = Number.NaN): Record<string, unknown> {
    const terrain = this.terrain;
    const flat = terrain ? terrain.waterHeightAt(x, z) : Number.NaN;
    const near = this.waterNear;
    const u = near?.lit.userData.uniforms;
    const waveHeight = (u?.uWaveHeight?.value as number | undefined) ?? 0;
    const ground = Number.isFinite(groundY) ? groundY : (terrain?.heightAt(x, z) ?? Number.NaN);
    const depth = flat - ground;
    const camera = SEA_FEED.farFade ? this.camera : null;
    const cameraDistance = camera ? Math.hypot(camera.position.x - x, camera.position.z - z) : 0;
    const onSea = !!terrain && Number.isFinite(flat) && !!near && onSeaSurface(flat, terrain.waterLevel, !!this.water?.visible);
    const scale = onSea ? swellScaleAt(depth, waveHeight, cameraDistance) : 0;
    const swell = this.swellOver(x, z, flat, groundY);
    const why = !terrain ? 'no terrain'
      : !SEA_FEED.on ? 'the sea reader is switched off (sea({ on: true }))'
      : this.globalWaterIsLava ? 'this world s water is lava'
      : !Number.isFinite(flat) ? 'no water over this point'
      : !near ? 'no near sea mesh built here'
      : !onSea ? 'this table is not the sea (a lake, a pool, or the sea not drawn)'
      : waveHeight <= 0 ? 'this mesh carries no swell at all (uWaveHeight 0: every lake and the far ring)'
      : !(scale > 0) ? (depth < 5 ? `the water is only ${depth.toFixed(2)} m deep here, and the swell fades out under 5 m` : 'the scale came to nothing')
      : null;
    return {
      swell: Number.isFinite(swell) ? Number(swell.toFixed(4)) : null,
      why,
      flat: Number.isFinite(flat) ? Number(flat.toFixed(3)) : null,
      waterLevel: terrain ? Number(terrain.waterLevel.toFixed(3)) : null,
      onSea,
      // The seabed the fade believes is under this point, and how deep that makes the water. The
      // shader reads its own 16 m grid for the same thing, so these two disagreeing is exactly the
      // case where a body holds a line the drawn water knows nothing about.
      ground: Number.isFinite(ground) ? Number(ground.toFixed(3)) : null,
      groundFrom: Number.isFinite(groundY) ? 'the caller' : 'terrain.heightAt',
      depth: Number.isFinite(depth) ? Number(depth.toFixed(3)) : null,
      waveHeight,
      farFade: SEA_FEED.farFade,
      cameraDistance: Number(cameraDistance.toFixed(1)),
      ourScale: SEA_FEED.scale,
      // What the fade came to in the end. 1 is the whole authored wave; the shader multiplies its
      // own copy of this by the same numbers, bar the ground grid and our own scale.
      scale: Number(scale.toFixed(4)),
    };
  }

  /** The swell over a point whose flat height the caller has already paid for. 0 is "no swell here". */
  private swellOver(x: number, z: number, flat: number, groundY: number): number {
    const terrain = this.terrain;
    // The cheapest possible answers first: the switch, no sea on this planet, and the flow guard.
    if (!terrain || !SEA_FEED.on || !Number.isFinite(flat) || this.globalWaterIsLava) return 0;
    const near = this.waterNear;
    // One guard, not two: the uniforms below are always the near sea's own material, whose
    // `uWaveHeight` is hard-wired to 1, so a lake is kept flat by this float-exact compare alone.
    if (!near || !onSeaSurface(flat, terrain.waterLevel, !!this.water?.visible)) return 0;
    const u = near.lit.userData.uniforms;
    const waveHeight = (u.uWaveHeight?.value as number | undefined) ?? 0;
    const depth = flat - (Number.isFinite(groundY) ? groundY : terrain.heightAt(x, z));
    const camera = SEA_FEED.farFade ? this.camera : null;
    const scale = swellScaleAt(depth, waveHeight, camera ? Math.hypot(camera.position.x - x, camera.position.z - z) : 0);
    if (!(scale > 0)) return 0;
    const waves = u.uWaves?.value as SwellWave[] | undefined;
    const omega = u.uOmega?.value as number[] | undefined;
    if (!waves || !omega) return 0;
    return seaSwellAt(waves, omega, x, z, this.waterTime, scale);
  }

  /**
   * The sea reader as a kept arrow, so the frame loop hands it to every vehicle's step without
   * making a closure per vehicle per frame.
   */
  readonly seaAtFn = (x: number, z: number, groundY?: number): number => this.seaAt(x, z, groundY ?? Number.NaN);

  /** The numbers the sea reader runs on, with the knobs written first. `__debug.sea` prints it. */
  setSeaFeed(tune?: SeaFeedTune): ReturnType<typeof seaFeedReport> & { swell: number; time: number; sea: boolean } {
    tuneSeaFeed(tune);
    return { ...seaFeedReport(), swell: this.waterBodies.swell, time: this.waterTime, sea: !!this.water?.visible && !this.globalWaterIsLava };
  }

  /**
   * The water over a **column**: the height of whatever table covers this x and z, with lava
   * filtered out, and no room asked at all. -Infinity where there is no water over the column.
   *
   * This is the reader for a body that has a better room rule of its own than the boxes -- the
   * player, whose swim reads the cell the portal renderer walks it through (`Player.inside`). It
   * must stay separate from `footSurfaces.waterTop`: that one answers -Infinity for a point in a
   * room box, and a swimmer who consumed that would read a depth of -Infinity and fall out of the
   * water mid-stroke. Rooms overhang their hulls and `cellAt` pads every box by a further half
   * metre, so a padded box really can straddle the water line -- 89 of the 938 placed portal
   * buildings in the converted packs have one that does so at the building's own point, reaching
   * under the line by a median of 11 m. Swimming down to an entrance that sits under a lake is the
   * plain case: the point is inside the padded box before the doorway is crossed.
   *
   * Lava is water to the terrain and is water to nothing else: `waterHeightAt` answers with the
   * height of whatever table covers the column, a flow as readily as a lake, so without this guard a
   * step over a flow reads as wading. Any finite depth at all means the water over this column is a
   * flow, whatever height is asked about (`World.lavaAt`).
   */
  waterColumnAt(x: number, z: number): number {
    if (Number.isFinite(this.lavaAt(x, 0, z))) return -Infinity;
    return this.terrain?.waterHeightAt(x, z) ?? -Infinity;
  }

  /**
   * What a foot lands on, as the world alone can say it: the water over a point, the interior
   * table's surface for the room it is in, the object template of whatever it is standing on, and
   * the surface the terrain paints there. The words are none of this file's business -- the sound
   * side turns the templates into `metal`, `sand` and the rest -- and the whole of it is one kept
   * object, so nothing is allocated when a foot lands.
   *
   * The ray is cast from a little above the foot and keeps only what stands still: from inside a
   * body's own capsule an unfiltered ray finds that capsule and calls its middle the floor.
   */
  readonly footSurfaces = {
    /**
     * The water over a **point**: the column (lava filtered out, `waterColumnAt`), and then the room
     * rule. A room is never under the planet's water, whatever height its floor stands at: caves and
     * bunkers really do sit below a water table, and read by height alone every one of them had the
     * feet wading and a lit blade boiling indoors. `waterTopAt` asks the room only for a point the
     * surface would otherwise cover, so a step on dry land costs what it always did.
     *
     * Everything that has no room rule of its own reads this -- a foot as it lands, a lit blade four
     * times a second, a bolt where it stopped. The player's swim does **not**: it reads
     * `waterColumnAt` and its own tracked cell, because the box this asks is padded and can overhang
     * open water, and the worst a wrong box can do to a footstep is silence it while the same answer
     * would take a swimmer's water away underneath them.
     */
    waterTop: (x: number, y: number, z: number): number => waterTopAt(x, y, z, this.waterColumnAt(x, z), this.indoorsAt),
    /**
     * The room the player is in, from the cell the frame already tracked. The floor is asked for by
     * itself rather than taken off the bed's own row: `roomRow` steps over a row whose bed the bank
     * has not got, which is right for the bed and wrong for the floor, since the less specific row it
     * then falls to has a floor that is not this room's.
     */
    playerRoom: (): string | null => {
      const state = this.cellState;
      if (!state) return null;
      const def = state.building.model.def;
      let name = 'default';
      for (const c of def.cells ?? []) if (c.index === state.cell) name = c.name;
      return this.ambience?.roomSurfaceFor(def.id, name) ?? null;
    },
    roomSurface: (x: number, y: number, z: number): string | null => {
      const state = this.layoutStream?.buildingAt(tmpV.set(x, y, z));
      if (!state) return null;
      const def = state.building.model.def;
      let name = 'default';
      for (const c of def.cells ?? []) if (c.index === state.cell) name = c.name;
      return this.ambience?.roomSurfaceFor(def.id, name) ?? null;
    },
    objectTemplate: (x: number, y: number, z: number, inside: boolean): string | null => {
      const stream = this.layoutStream;
      if (!stream) return null;
      const filter = inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : undefined;
      const hit = this.physics.topHit(x, z, y + FOOT_TUNE.probe, FOOT_TUNE.reach, filter, World.staticOnly);
      return hit ? stream.templateOfCollider(hit.handle) : null;
    },
    /**
     * What the ground under a foot is shaped like, for the mark laid there rather than for the
     * sound: the surface's own normal, so a print lies in a dune's face instead of cutting through
     * it, and the collider it stands on, so a print laid on a placed object goes down with that
     * object. Fills the caller's record and says whether anything could be said.
     *
     * It is asked for **only when a mark is really going to be laid** -- a walk over stone never
     * reaches here -- so it can afford a look of its own. The normal is the terrain's, which is
     * four height samples half a metre apart and no ray at all; the block under a body that is
     * standing on it is already generated, so nothing is built on the main thread to answer.
     *
     * A body standing on top of a placed object takes that object's collider and the ground's own
     * slope. That is the honest answer and not an oversight: the surface word came from the ground
     * underneath in the first place (most placed things are made of nothing of their own, which is
     * what the client's surface type 0 means), and what matters is that the mark dies with the
     * thing it was laid on.
     */
    footGround: (x: number, y: number, z: number, inside: boolean, out: FootGround): boolean => {
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      // Null is the world itself: the marks system names that value, not this.
      out.owner = null;
      const terrain = this.terrain;
      if (terrain) {
        const n = terrain.normalAt(x, z, footNormal);
        out.nx = n.x;
        out.ny = n.y;
        out.nz = n.z;
      }
      const stream = this.layoutStream;
      if (stream) {
        // The same ray, filter and predicate `objectTemplate` above casts, so what a print is laid
        // on and what it sounds like can never name two different things.
        const filter = inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : undefined;
        const hit = this.physics.topHit(x, z, y + FOOT_TUNE.probe, FOOT_TUNE.reach, filter, World.staticOnly);
        if (hit) out.owner = hit.handle;
      }
      return true;
    },
    groundTemplate: (x: number, z: number): string | null => this.terrain?.surfaceAt(x, z) ?? null,
    space: (x: number, y: number, z: number): SoundSpace | null => this.ambience?.sources.spaceAt?.(x, y, z) ?? null,
    /**
     * What a collider belongs to. A foot lands on whatever a short ray down from it finds; a bolt is
     * stopped by the thing it struck and knows which, and the mark it leaves on a wall is metres
     * above anything a ray down from it could name.
     */
    templateOfCollider: (handle: number): string | null => this.layoutStream?.templateOfCollider(handle) ?? null,
  };

  /** The pack directory this planet (or zone) loads from. */
  packId = '';

  load(planet: PlanetDef, packId = packIdOf(planet)): void {
    this.unload();
    this.planet = planet;
    this.packId = packId;
    this.terrain?.detachSwg();
    this.terrain = new Terrain(planet);
    this.props = new PropFactory(planet);
    this.creatures = new CreatureManager(planet, this.terrain, this.physics);
    this.scene.add(this.creatures.group);
    this.turrets = new TurretManager(this.physics, this.terrain);
    this.scene.add(this.turrets.group);
    this.npcs = new NpcManager(this.scene, this.physics, this.terrain, import.meta.env.BASE_URL);
    this.npcs.attach(this.npcDeps);
    // The catalogue's mobiles. The asset cache outlives the planet; the catalogue is a getter,
    // not a value, because on a cold first load it is usually still in flight here.
    const mobileAssets = MobileAssets.for(import.meta.env.BASE_URL);
    mobileAssets.prepare = (root) => this.prepareActor(root);
    mobileAssets.forget = (mats) => this.forgetMaterials(mats);
    this.mobiles = new MobileManager({
      physics: this.physics,
      terrain: this.terrain,
      bolts: this.bolts,
      assets: mobileAssets,
      effects: () => this.npcDeps.effects ?? null,
      catalogue: () => MobileCatalogue.loaded(import.meta.env.BASE_URL),
      targets: () => this.targets(),
      groundAt: (x, y, z, inside) => this.groundAt(x, y, z, inside),
      // So a swimming creature lies on the drawn sea rather than on the flat table under it.
      seaSwellAt: (x, z, flat) => this.seaSwellOverFlat(x, z, flat),
      // What a carried blade finds when it sweeps. It goes through the fighters' own lookup when
      // there is one, since that is the one that knows the player's capsule and it asks ours for
      // everything else itself; asking ours again after it would search every collider twice for
      // every wall a blade touches, which is most of what a blade touches.
      hittableAt: (h) => (this.npcDeps.hittableAt ? this.npcDeps.hittableAt(h) : this.hittableAt(h)),
      // A mobile put down inside starts in the room whose box holds it (else the player's, who is
      // inside when anything is), then is followed through the portals as the player is.
      cellAt: (p) => this.layoutStream?.buildingAt(p) ?? this.cellState,
      followCell: (state, prev, pos) => (this.layoutStream ? this.layoutStream.trackCell(state, prev, pos) : null),
      spawnSpot: (from, forward, distance, inside) => this.spawnSpot(from, forward, distance, inside),
      refuse: () => (this.planet?.space ? 'nothing can be stood in space' : (this.refuseMobiles?.() ?? null)),
      shadows: () => this.renderer?.shadowMap.enabled ?? false,
      // A getter: the rack arrives after the world is made, and a person spawned before it is unarmed.
      weapons: () => this.npcDeps.weapons ?? null,
    });
    // The fighters stand on a building's floor as the mobiles do: their room followed through the
    // portals (the floor under them is then found by a ray, the terrain outside).
    this.npcs.attach({
      cellAt: (p) => this.layoutStream?.buildingAt(p) ?? this.cellState,
      followCell: (state, prev, pos) => (this.layoutStream ? this.layoutStream.trackCell(state, prev, pos) : null),
      // And whether that room has collision under it this instant: a building's colliders come and
      // go with the player's distance while the room a body is in goes on answering, so a fighter
      // with a character controller under it has to be able to ask for the floor and not the room.
      cellSolid: (state) => this.layoutStream?.cellsSolid(state) ?? true,
      // What stands near a body that it could get behind: the streamer's own placed objects, each
      // as a disc over its model's box. It is the only thing the cover search has to be given --
      // every ray it casts it casts itself -- and with nothing wired it finds no blockers and
      // answers none, which is a fighter walking into the open exactly as it always did.
      blockers: (x, z, reach, out, cap) => this.layoutStream?.blockersNear(x, z, reach, out, cap) ?? 0,
    });
    // The NPC ships of this world (unload disposed the last one's). `this.terrain` is assigned above and
    // `this.playerTarget` is a field initialiser; everything else is an arrow read when it is called.
    this.npcShips = new NpcShipManager({
      bolts: this.bolts,
      ships: this.ships,
      vehicles: this.vehicles,
      garage: async () => (this.garage ??= await Garage.load(import.meta.env.BASE_URL)),
      spawnHull: (def, fit, at, heading) => this.spawnHull(def, fit, at, heading),
      prepareExtras: (objects) => this.prepareExtras(objects),
      dispose: (v) => this.disposeVehicle(v),
      effects: () => this.npcDeps.effects ?? null,
      physics: this.physics,
      groundAt: planet.space ? null : (x, z) => this.terrain.heightAt(x, z),
      space: !!planet.space,
      zoneTier: ZONE_TIER[planet.id] ?? 3,
      playerPos: this.playerTarget.pos,
    });
    this.mobiles.cap = this.mobileDetail.cap;
    this.mobiles.animRange = this.mobileDetail.animRange;
    this.scene.add(this.mobiles.group);
    this.mobilesAt = -1;
    // A fresh planet, a fresh clock and a fresh list of the living.
    this.simTime = 0;
    this.livingAt.creatures = -1;
    this.livingAt.npcs = -1;
    this.physics.setGravity(planet.gravity);

    const s = planet.sky;
    this.day.configure(s.sunAzimuth, s.sunElevation);
    const u = this.sky.material.uniforms;
    u.uTop.value.set(s.top);
    u.uHorizon.value.set(s.horizon);
    u.uSunColor.value.set(s.sunColor);
    u.uSuns.value = s.suns;

    this.dayFog.set(planet.fog.color);
    this.nightFog.set(planet.fog.color).multiplyScalar(0.08).lerp(new THREE.Color(0x0a0f1c), 0.5);
    this.scene.fog = new THREE.FogExp2(planet.fog.color, planet.fog.density * FOG_SCALE);
    this.sunColor.set(s.sunColor);
    this.hemi.color.set(planet.light.ambientSky);
    this.hemi.groundColor.set(planet.light.ambientGround);

    if (planet.water) this.createGlobalWater(this.waterBodies.lookFor(null, planet), planet.water.level);

    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.exclusions = [];
    this.loadToken++;
    // The planet's places (its sound objects, its own interior rows) start coming now. Nothing waits
    // on them: a pack that lands after the player has arrived simply adds its emitters then, and a
    // planet whose places have not been converted at all still sounds, from its sky's own rows.
    this.ambience?.begin(packId);
    this.day.update(0, false);
    this.applyLighting();
  }

  /** Load converted SWG content for this planet, if the private pack exists. */
  async loadPack(spawn: THREE.Vector3): Promise<THREE.Vector3 | null> {
    const token = this.loadToken;
    const planet = this.planet;
    this.packStatus = 'loading';
    this.packProgress = 0;
    const pack = await AssetPack.load(this.packId);
    if (token !== this.loadToken) return null;
    if (!pack) {
      this.packStatus = 'no pack';
      this.packProgress = 1;
      return null;
    }
    this.pack = pack;
    // The world's outdoor walkability grid, written beside the manifest by the `navgrid` command.
    // A world with no `nav.json` answers false to everything and every body in it steers exactly as
    // it did before any of this existed. Awaited rather than left in flight so the loading screen
    // covers it -- about 3.7 MB for a 16 km world, a tenth of a second to inflate -- and the token
    // is checked after, because a travel during that fetch must not leave the next world holding
    // the last one's ground.
    await outdoorNav.load(this.packId);
    if (token !== this.loadToken) return null;
    // The world's own wildlife: where the server's spawn areas are and what may stand in them. A
    // few hundred kilobytes a world beside the fleet's one manifest, and a world with no such pack
    // simply has the wildlife it always had.
    await wildLife.load(this.packId, import.meta.env.BASE_URL);
    if (token !== this.loadToken) return null;
    // The people who stand somewhere and stay there ride in the same pack the wildlife does, so the
    // rows are taken from what that fetch already holds rather than fetched a second time.
    standingPeople.adopt(wildLife.peopleRows() as StandingRow[]);
    this.packProgress = 0.12;

    const scatter: ScatterItem[] = [];
    const addScatter = async (category: string, density: number, minScale: number, maxScale: number) => {
      const models = await pack.models(pack.category(category).map((m) => m.id));
      for (const model of models) scatter.push({ model, density: density / Math.max(1, models.length), minScale, maxScale });
    };
    await addScatter('rocks', planet.props.rockDensity * 1.2, 0.8, 1.6);
    await addScatter('debris', 0.35, 0.9, 1.1);
    await addScatter('vaporators', 0.25, 1, 1);
    await addScatter('flora', 0.9, 0.8, 1.2);
    if (token !== this.loadToken) return null;
    this.packProgress = 0.3;

    const layout = pack.layout;
    const placements = layout ? [] : (OUTPOSTS[planet.id] ?? []);
    const structures: { model: LoadedModel; x: number; z: number; rot: number; flatten: number }[] = [];
    for (const p of placements) {
      try {
        const model = await pack.model(p.model);
        structures.push({ model, x: spawn.x + p.x, z: spawn.z + p.z, rot: p.rot, flatten: p.flatten ?? model.radius + 6 });
      } catch {
        console.warn(`outpost: ${p.model} not in pack, skipped`);
      }
    }
    if (token !== this.loadToken) return null;

    // Level the ground under each structure, keep procedural props off it, then rebuild.
    for (const st of structures) {
      this.terrain.flattenZones.push({ x: st.x, z: st.z, r: st.flatten, h: this.terrain.rawHeightAt(st.x, st.z) });
      this.exclusions.push({ x: st.x, z: st.z, r: st.model.radius + 4 });
    }

    // The planet's real terrain, with every building's ground modification applied where the snapshot puts it.
    if (layout?.terrain) {
      const trn = await pack.terrain();
      if (token !== this.loadToken) return null;
      if (trn) {
        const layers: BuildingLayerSource[] = [];
        for (const o of layout.objects) {
          if (!o.layer || o.contained) continue;
          const bytes = await pack.bytes(o.layer);
          if (!bytes) continue;
          layers.push({ bytes, x: o.x, z: o.z, yaw: yawOf(o.q) });
        }
        if (token !== this.loadToken) return null;
        try {
          const t0 = performance.now();
          const swg = await SwgTerrain.create(trn, layers, layout.center.x, layout.center.z, (file) => pack.bytes(file));
          if (token !== this.loadToken) return null;
          this.terrain.attachSwg(swg);
          await this.waterBodies.load(pack, planet.id);
          if (token !== this.loadToken) return null;
          this.applySwgWater(swg);
          await this.loadLava(pack, swg); // never rejects; drops its own work if another load began meanwhile
          if (token !== this.loadToken) return null;
          this.packProgress = 0.55;
          console.info(`terrain: ${this.terrain.swg!.template.name} with ${layers.length} building layers loaded in ${(performance.now() - t0).toFixed(0)} ms`);
          await this.loadFlora(pack, swg);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.7;
          await this.loadGroundTextures(pack);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.85;
          await this.loadSky(pack, spawn);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.92;
        } catch (err) {
          console.warn('terrain: failed to load the planet terrain, keeping procedural ground', err);
        }
      }
    }

    // A pack with a sky but no terrain (the gallery, a space zone) still gets its sky, and a space zone its planets.
    if (!layout?.terrain) {
      try {
        await this.loadSky(pack, spawn);
        if (planet.space) await this.loadSpaceBodies(pack);
      } catch (err) {
        console.warn('sky: failed to load', err);
      }
      if (token !== this.loadToken) return null;
    }
    if (planet.id === 'gallery' && layout) {
      this.gallery?.dispose();
      this.gallery = new Gallery(this.scene, pack.url(''), layout.center, (x, z) => this.terrain.heightAt(x, z));
      void this.gallery.load();
    }

    // Snapshot objects stream in around the player from here on (see LayoutStreamer).
    //
    // A scene skips this whole branch and nothing else. The creation and selection screens show one
    // of the owner's captured places: the ground, the sky, the water and the weather are the
    // world's own, which is what makes the sun of that hour really light a character and the clouds
    // really move, but the placed objects come from `scenes/` already culled to the one frustum
    // that camera can see. Streaming a whole planet's worth beside them would build thousands of
    // things nobody can look at, and take the load from seconds to a minute. Everything above this
    // -- the terrain, the sky, the flora, the ground textures -- runs exactly as it always does.
    if (layout && !this.sceneOnly) {
      this.layoutStream?.dispose();
      this.particles?.dispose();
      this.particles = new ParticleEffects(this.scene, pack.url(''));
      this.particles.heightAt = (x, z) => this.terrain.heightAt(x, z);
      // The gallery is one long walk of exhibits with nothing else to draw: everything loads from anywhere on it.
      this.layoutStream = new LayoutStreamer(this.scene, this.physics, pack, layout, this.particles, { reach: planet.id === 'gallery' ? 4 : this.streamReach(), hugeColliders: !!planet.space });
      // A tier is built hidden and shown once its programs exist, so no frame is ever the first to
      // draw a material nothing had built: that was thirteen programs and two frames of over a
      // second for a player who had not moved. `swg.shaderPace` = '0' in local storage leaves it
      // null, which is the behaviour this had before -- a tier drawn the moment it loads -- and is
      // the way to see for yourself what the hold is worth on your own machine.
      if (SHADER_PACING) this.layoutStream.prepare = (objects) => this.prepareStreamed(objects);
      // A space zone's hyperspace effects are made ready now (their textured batches hidden in the scene, their
      // textures uploaded), so settle() compiles them behind the loading screen and no jump builds a program on a
      // live frame. Not `solid`: the jump places them without it (placeZoneEffect). `spaceData` was set by
      // loadSpaceBodies above.
      if (planet.space) {
        const fx = this.particles;
        for (const f of Object.values(this.hyperspaceEffects())) if (f) await fx.prepare(f, this.renderer);
        if (token !== this.loadToken) return null;
        // The zone's nebulae, once the particles exist (a strike plays two of the game's own
        // effects): built into the scene here, so the warm-up compiles every one of their
        // materials behind the loading screen and nothing of theirs is ever made on a live frame.
        await this.loadNebulae(pack);
        if (token !== this.loadToken) return null;
      }
      // Placed objects pull the procedural ground up to their feet, so buildings stand on it;
      // in space nothing stands on anything, and an anchor would raise a needle of ground three
      // kilometres tall under every asteroid.
      if (!this.terrain.swg && !planet.space) {
        for (const p of this.layoutStream.objects) if (p.radius >= 2 && !p.contained) this.terrain.addAnchor({ x: p.x, z: p.z, y: p.y, r: p.radius });
      }
    }
    // The Force's own beams: a small pool built into the scene here, hidden, so the warm-up
    // compiles it behind the loading screen and no beam is ever made on the frame a power is used.
    // Every world has one, since a Jedi fights on the ground as well as in a ship.
    await loadForceLightning(this, () => token === this.loadToken);
    if (token !== this.loadToken) return null;
    // The Force powers' own effects, out of the weapons pack: their batches made hidden in the
    // scene and their textures uploaded here, so the warm-up compiles them behind the loading
    // screen and no power builds a program on the frame it is first used. The rack is the world's
    // own and is null only while it is still coming (the kit asks again when it lands); a second
    // call over the same files prepares nothing again.
    const forceReady = await prepareForceEffects(this.weaponFx, this.renderer, this.npcDeps.weapons?.manifest);
    if (token !== this.loadToken) return null;
    if (forceReady) console.info(`the Force: ${forceReady} of the powers' own effects made ready`);
    this.props.dispose();
    this.props = new PropFactory(planet, this.flora ? [] : scatter);
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const [key, t] of this.farTiles) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
      const [tx, tz] = key.split(',').map(Number);
      this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
    }
    this.farTiles.clear();
    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.stream(spawn, Infinity);
    this.streamFar(spawn, Infinity);

    for (const st of structures) this.placeStructure(st.model, st.x, st.z, st.rot);
    this.packBase = `${scatter.length} scatter models, ${structures.length} structures${this.terrain.swg ? ', SWG terrain' : ''}`;
    this.packStatus = this.packBase;
    this.packProgress = 1;
    if (!this.layoutStream) return this.terrain.swg ? new THREE.Vector3(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z) : null;
    this.layoutStream.update(spawn);
    return this.layoutStream.clearSpawn(spawn, (x, z) => this.terrain.heightAt(x, z)) ?? new THREE.Vector3(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z);
  }

  private placeStructure(model: LoadedModel, x: number, z: number, rot: number): void {
    const y = this.terrain.heightAt(x, z);
    const obj = model.scene.clone();
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.updateMatrixWorld(true);
    this.scene.add(obj);
    this.structures.push(obj);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
    for (const prim of model.primitives) {
      const pos = prim.geometry.getAttribute('position');
      const idx = prim.geometry.getIndex();
      if (!pos || !idx) continue;
      const vertices = new Float32Array(pos.array as ArrayLike<number>);
      const indices = new Uint32Array(idx.array as ArrayLike<number>);
      const desc = R.ColliderDesc.trimesh(vertices, indices).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.8);
      this.structureColliders.push(this.physics.world.createCollider(desc));
    }
  }

  /** Leave the planet: everything it streamed goes, for the select screen to show over nothing. */
  leave(): void {
    // No new load follows, so a lava (or sky) load still in flight must see its token go stale, or
    // it would add to an empty scene behind the select screen. The planet's places are the same: a
    // sound pack still in flight would otherwise start a town's emitters over the select screen.
    this.loadToken++;
    this.ambience?.leave();
    this.unload();
  }

  /** Moved on by every unload: a vehicle being prepared for the world that went is not made (spawnVehicle's `alive`). */
  private loadGeneration = 0;

  private unload(): void {
    this.loadGeneration++;
    // Everything still queued belonged to the world that is going: the objects are about to be
    // taken out of the scene, and whoever was waiting on one (a tier holding itself back until it
    // can be drawn without a stall) is answered rather than left waiting for ever.
    this.programs.clear();
    // The outdoor walkability grid: about forty megabytes of typed arrays for a 16 km world, and
    // nothing else holds them.
    outdoorNav.unload();
    wildLife.unload();
    standingPeople.unload();
    // The water's height field holds a mesh and a material per thing that waded here, and the keys
    // are the bodies themselves: a world left with them still in the map holds every one of them.
    for (const body of this.simBodies.values()) body.dispose();
    this.simBodies.clear();
    this.simIdle.clear();
    this.simSeen.clear();
    // Two blades meeting: the pairs that have clashed lately go with the world they clashed in
    // (src/combat/clash.ts). The step holds no renderer between steps, so there is nothing here
    // to free -- this is only the ring saying so rather than waiting for the clock to go back.
    clashes.clear();
    // Every bed, emitter and weather channel let go before the things they follow are disposed: the
    // particle effects go a few lines down, and a loop left on one would follow a point in a world
    // that has gone. The sky and the effects are wired again on the next planet's first frames.
    this.ambience?.leave();
    this.soundSky = null;
    this.soundParticles = null;
    this.soundPack = null;
    this.roomFor = null;
    this.roomForCell = -1;
    this.roomForTables = -1;
    this.roomRow = null;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const t of this.farTiles.values()) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
    }
    this.farTiles.clear();
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    for (const o of this.structures) this.scene.remove(o);
    this.structures.length = 0;
    this.layoutStream?.dispose();
    this.layoutStream = null;
    // A hold belongs to the world it was taken out on: nothing may carry one into the next one.
    this.streamHold = false;
    this.particles?.dispose();
    this.particles = null;
    if (this.spaceBodies) {
      this.scene.remove(this.spaceBodies);
      this.disposeSpaceBodies(this.spaceBodies);
      this.spaceBodies = null;
    }
    this.dropNebulae();
    dropForceLightning(this);
    // The loose props go with the world they were stood in: their bodies out of the one Rapier
    // world (which outlives a planet and would otherwise keep two dozen of them for ever), their
    // materials forgotten by the portal set and the cascades, then freed.
    dropLooseProps(this);
    this.flora = null;
    this.groundTextures?.dispose();
    this.groundTextures = null;
    this.dropSky();
    this.waterBodies.clear();
    // The verdict and the looks belong to the world they were read in: a world left under water must
    // not hand the next one its hysteresis, or its colour.
    this.cameraWater.under = false;
    this.cameraWater.submerged = false;
    this.cameraWater.depth = 0;
    this.cameraWater.look = null;
    this.forgetCameraWater();
    this.waterLooks.clear();
    this.globalWaterShader = null;
    this.globalWaterIsLava = false;
    // What a pack said goes with the world it was said for, back to "nobody has said", and nothing is
    // announced about a burn that ended because the ground under it was taken away.
    resetLavaHarm();
    this.lavaClock = 0;
    resetLavaHold(this.lavaHold);
    this.lavaBurning = 'no';
    // And a fire the player was carrying goes with the world it was lit in: travel puts it out in
    // silence, so nobody arrives on the next planet still alight and nothing is said about it over
    // a loading screen. Here rather than in `Player.update` because a travel unloads the world from
    // outside the frame loop, and a burn left standing would be spent on the next planet's clock.
    this.playerTarget.clearBurn();
    this.waterNear = this.waterFarBody = null;
    for (const m of this.localWater) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    this.dropLava();
    this.cellState = null;
    this.groundHiddenFor = null;
    this.prevPlayerPos.x = Number.NaN;
    this.hiddenGround.length = 0;
    for (const c of this.structureColliders) this.physics.removeCollider(c);
    this.structureColliders = [];
    this.pack?.dispose();
    // The houses' pack goes with the world it was used in, although it is not the world's own. Its
    // materials joined this world's shadow cascades and the portal renderer's set when they were
    // prepared, and nothing but a dispose takes them out again: kept across a world change it would
    // be a leak in both, which shows as a stutter the next time the shadow distance moves. Fetching
    // it again is a manifest and whichever buildings are put down, and only for a player who puts
    // one down at all.
    this.housePack?.then((p) => p?.dispose()).catch(() => undefined);
    this.housePack = null;
    surfaces.sweep();
    this.pack = null;
    this.packStatus = 'no pack';
    if (this.creatures) {
      this.scene.remove(this.creatures.group);
      this.creatures.dispose();
    }
    this.npcs?.dispose();
    // The spawned and ambient mobiles go with the planet (their ragdolls with them); their models
    // stay in the cache, released, and anything held by nothing is trimmed to the budget.
    if (this.mobiles) {
      this.scene.remove(this.mobiles.group);
      this.mobiles.dispose();
    }
    this.mobilesAt = -1;
    MobileAssets.for(import.meta.env.BASE_URL).trim();
    // Nothing may hand out a body from the world that has just gone.
    this.livingList.length = 0;
    this.livingAt.creatures = -1;
    this.livingAt.npcs = -1;
    if (this.turrets) {
      this.scene.remove(this.turrets.group);
      this.turrets.dispose();
    }
    this.bolts.clear();
    this.gallery?.dispose();
    this.gallery = null;
    this.spaceData = null;
    // The NPC ships go with the world: the manager forgets them (its spawns still being built throw theirs
    // away), the contacts are dropped, and the loop below disposes their vehicles with every other one.
    this.npcShips?.dispose();
    this.npcShips = null;
    this.ships.clear();
    for (const sp of [...this.vehicles]) this.disposeVehicle(sp);
    this.vehicles.length = 0;
    this.props?.dispose();
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      this.water = null;
    }
    if (this.waterFar) {
      this.scene.remove(this.waterFar);
      this.waterFar.geometry.dispose();
      this.waterFar = null;
    }
    // One lit material per body now, so a planet leaves a couple of dozen behind rather than three:
    // both the portal renderer's set and the cascades' map are strong, and the first is walked on
    // every stencil change.
    this.forgetMaterials(this.waterMaterials);
    for (const m of this.waterMaterials) m.dispose();
    this.waterMaterials.length = 0;
    // The depth window holds ground heights by world coordinate and slides with the player, keeping
    // what it knows: right inside one world, wrong the instant those coordinates are another's. An
    // arrival within the window's own width of the last one would otherwise slide the old planet's
    // bed into the new one and hold it until the far-tile cache warms, which the surface's own
    // opacity now reads.
    resetWaterDepth();
    // The rooms of a hull another player flies belong to the world that has just gone. A room somebody
    // is standing in is not freed under them: it is cut loose and left where it was until they step out.
    this.remoteRooms().releaseAll();
  }

  /**
   * The sea: a finely divided plane around the player that swells, and a flat ring beyond it
   * out to the horizon. Both follow the player, the near plane snapping to its own cell size.
   */
  private createGlobalWater(look: WaterLook, level: number): void {
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_NEAR, WATER_NEAR, WATER_SEGMENTS, WATER_SEGMENTS).rotateX(-Math.PI / 2));
    this.water.name = 'water:sea';
    this.water.position.y = level;
    this.water.receiveShadow = true;
    this.water.frustumCulled = false;
    this.waterNear = this.waterBodies.add(this.water, true, look, 'seaNear');
    this.scene.add(this.water);
    this.waterFar = new THREE.Mesh(new THREE.RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1).rotateX(-Math.PI / 2));
    this.waterFar.name = 'water:sea-far';
    this.waterFar.position.y = level - 0.05;
    this.waterFar.frustumCulled = false;
    this.waterFarBody = this.waterBodies.add(this.waterFar, false, look, 'seaFar');
    this.scene.add(this.waterFar);
    this.waterMaterials.push(this.waterNear.lit, this.waterFarBody.lit);
  }

  /** The planet's sky from its pack: replaces the procedural dome and drives the lights, fog and reflections. */
  /** A space zone's planets and moons: textured spheres hung far out in the directions the zone's terrain file gives, riding with the camera like the sky. */
  private spaceBodies: THREE.Group | null = null;

  /** The space zone's whole pack (space.json), null on a ground planet and before it loads. Public, read-only by convention. */
  spaceData: SpacePack | null = null;

  /** The zone's nebulae while a space zone is loaded: its sheets, the haze inside one and its lightning. */
  nebulae: Nebulae | null = null;

  /**
   * Hold the placed-object streamer where it is: no tier loaded, none dropped. Set while something
   * moves the player faster than the streamer can usefully follow, and cleared by whatever set it.
   */
  streamHold = false;

  /** The name of the scenery at a point (the Star Destroyer): the nearest whose radius plus a kilometre covers it, or null. Game frame. */
  sceneryNameAt(x: number, z: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of this.spaceData?.scenery ?? []) {
      const d = Math.hypot(-s.x - x, s.z - z);
      if (d < s.radius + 1000 && d < bestD) {
        bestD = d;
        best = s.name;
      }
    }
    return best;
  }

  /** The jump's two converted warp effects (pack-relative particle JSON), from the zone's pack; null where there is none. */
  hyperspaceEffects(): { enter: string | null; exit: string | null } {
    const fx = this.spaceData?.hyperspace?.effects;
    return { enter: fx?.enter ?? null, exit: fx?.exit ?? null };
  }

  /**
   * Place one of the jump's effects framed on a hull (`frame`, its live matrixWorld, `local` in that frame):
   * transient, and not `solid`, so only its textured streaks and stars draw. Its untextured quads (the enter's
   * 90 m black drop, the exit's white-to-blue backdrop) were made for the client's camera fixed behind the ship
   * and showed as flat boxes in space from ours; the jump's own tunnel covers the move. Null outside a pack.
   */
  placeZoneEffect(file: string, local: THREE.Matrix4, frame: THREE.Matrix4): EffectHandle | null {
    return this.particles?.place(file, local, false, true, frame, false) ?? null;
  }

  /** Take one of the jump's effects away (nothing happens if the world it was placed in has gone). */
  removeZoneEffect(h: EffectHandle): void {
    this.particles?.remove(h);
  }

  /**
   * What a station's dock plays, by the part of docking it belongs to, at a point in the world. Every
   * dock effect in the retail archives names a sound and no particle, so this is one sound; false when
   * the zone has no such effect (a pack converted before they were carried), so a caller can say so.
   *
   * A pack that ever did carry a particle here would place it on a live frame, and its program would be
   * compiled there: nothing prepares the dock effects at zone load as the jump's are. That is why only
   * the sound is played, and a particle is left to whoever adds the preparation.
   */
  dockEffect(part: string, x: number, y: number, z: number): boolean {
    const fx = this.spaceData?.dockEffects?.[part];
    if (!fx) return false;
    return fx.sound ? this.playSound(fx.sound, x, y, z) !== 0 : false;
  }

  /**
   * A body that stands somewhere: its own copy of the depth stand-in's material. The program is one
   * for all of them (three keys a shader material's program on its source), so a zone pays for one
   * however many bodies it has, and it is built with the rest behind the loading screen.
   *
   * It writes the depth of the true surface under each pixel and no colour at all. The sphere it
   * traces is the DRAWN one -- pulled in to the sky's reach and scaled by the same ratio -- and the
   * depth it finds is multiplied back out by `uDepthScale`: a true middle two hundred kilometres
   * out, squared in the maths, is past what a float in a shader can hold, and the drawn one is not.
   */
  private makeWorldBodyStandIn(): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uRadius: { value: 1 },
        uDepthScale: { value: 1 },
        uMaxDepth: { value: 1 },
        uProjZ: { value: new THREE.Vector2() },
        uProjW: { value: new THREE.Vector2() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCentre;
        uniform float uRadius;
        uniform float uDepthScale;
        uniform float uMaxDepth;
        uniform vec2 uProjZ;
        uniform vec2 uProjW;
        varying vec3 vView;
        void main() {
          vec3 ray = normalize(vView);
          float b = dot(ray, uCentre);
          float c = dot(uCentre, uCentre) - uRadius * uRadius;
          float disc = b * b - c;
          if (disc < 0.0) discard;
          float root = sqrt(disc);
          float t = b - root;
          if (t < 0.0) t = b + root;
          if (t < 0.0) discard;
          // The depth buffer holds distance along the camera's forward axis, not from the camera.
          float depth = clamp(-(ray.z * t) * uDepthScale, 0.1, uMaxDepth);
          float viewZ = -depth;
          gl_FragDepthEXT = (uProjZ.x * viewZ + uProjZ.y) / (uProjW.x * viewZ + uProjW.y) * 0.5 + 0.5;
          gl_FragColor = vec4(0.0);
        }
      `,
      side: THREE.DoubleSide,
      fog: false,
    });
    m.colorWrite = false;
    m.depthWrite = true;
    m.depthTest = true;
    // Unlit: kept out of the shadow cascades, whose defines are part of a program's key.
    m.userData.unlit = true;
    return m;
  }

  /**
   * A body the pack stands somewhere rather than hanging on the sky, and everything the per-frame
   * placement needs of it. `at` is the world place (the game frame), `radius` its true radius; the
   * mesh and the stand-in are both children of the group that rides the camera.
   */
  private readonly spaceWorldBodies: { mesh: THREE.Mesh; stand: THREE.Mesh; at: THREE.Vector3; radius: number; material: THREE.ShaderMaterial }[] = [];

  private async loadSpaceBodies(pack: AssetPack): Promise<void> {
    const token = this.loadToken;
    // This zone's NPC ship manager, captured before the wait: a zone left meanwhile is not given anchors.
    const mgr = this.npcShips;
    // The whole pack, fetched once per zone and shared with the System Map's catalogue (the same promise).
    const data = await loadSpacePack(import.meta.env.BASE_URL, this.packId);
    if (token !== this.loadToken) return;
    this.spaceData = data;
    // The patrols' anchors (stations, hyperspace points, the arrival lane); they never stop the sky loading.
    try {
      if (mgr && mgr === this.npcShips) mgr.setAnchors(data);
    } catch (err) {
      console.warn('npc ships: no anchors', err);
    }
    if (!data) return;
    const group = new THREE.Group();
    const loader = new THREE.TextureLoader();
    const discs: { dir: THREE.Vector3; cos: number }[] = [];
    // One material for every body's depth stand-in, so the zone pays for one program, compiled with
    // the rest behind the loading screen. Unlit: kept out of the shadow cascades, whose defines are
    // part of a program's key, and it has no colour to light anyway. Back side, because every
    // stand-in is a piece of a sphere the camera sits inside.
    const depthStandIn = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: false, fog: false, side: THREE.BackSide });
    depthStandIn.userData.unlit = true;
    /** The axis a sphere cap is built about, before it is turned onto a body's direction. */
    const capAxis = new THREE.Vector3(0, 1, 0);
    /** How far out the last stand-in stood, for the console line alone. */
    let standAt = 0;
    /** The bodies that stand somewhere, kept here until this set of bodies is the one in the sky. */
    const standing: { mesh: THREE.Mesh; stand: THREE.Mesh; at: THREE.Vector3; radius: number; material: THREE.ShaderMaterial }[] = [];
    for (const p of data.planets) {
      // The direction is in the game's own coordinates, mirrored in X like everything converted.
      const dir = new THREE.Vector3(-p.direction[0], p.direction[1], p.direction[2]);
      if (dir.lengthSq() < 1) continue;
      dir.normalize();
      const tex = p.texture ? await loader.loadAsync(pack.url(p.texture)).catch(() => null) : null;
      // A travel or a jump while the pictures load: this zone's bodies must never land in the next one's sky.
      if (token !== this.loadToken) {
        tex?.dispose();
        this.disposeSpaceBodies(group);
        return;
      }
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      // A body that stands somewhere (a made-up system's) is built at its true size and moved every
      // frame; one hung on the sky is built at the sky's reach and never moves again.
      const stands = p.place === 'world' && Array.isArray(p.at) && typeof p.radius === 'number' && p.radius > 0;
      const radius = stands ? (p.radius as number) : SPACE_BODY_SIZE * p.size;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshLambertMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : 0x8a97a6, fog: false, depthWrite: false }));
      mesh.position.copy(dir).multiplyScalar(SPACE_BODY_DISTANCE);
      mesh.renderOrder = -4;
      mesh.frustumCulled = false;
      group.add(mesh);
      if (stands) {
        const at = p.at as [number, number, number];
        const material = this.makeWorldBodyStandIn();
        material.uniforms.uMaxDepth.value = standingBodyMaxDepth(this.camera?.far ?? 9000);
        const stand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        // After the body's own picture, which writes no depth: at a stand-off of a kilometre or two
        // the depth written is nearer than the picture is drawn, and the picture would fail its own
        // test and vanish.
        stand.renderOrder = -3;
        stand.frustumCulled = false;
        stand.onBeforeRender = (_r, _s, cam) => {
          const e = (cam as THREE.PerspectiveCamera).projectionMatrix.elements;
          material.uniforms.uProjZ.value.set(e[10], e[14]);
          material.uniforms.uProjW.value.set(e[11], e[15]);
          // The DRAWN SPHERE's middle in view space, read off the matrix the frame already built:
          // the picture's, never the quad's. The quad is only the surface the ray is cast from, hung
          // a few metres away; the sphere the shader traces stands where the picture is drawn, and
          // its radius is that picture's. Reading the quad's place instead traced a sphere round the
          // camera: the depth came out kilometres wrong and no pixel ever fell outside the disc, so
          // the limb was the quad's square edge rather than the body's.
          material.uniforms.uCentre.value.setFromMatrixPosition(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        };
        group.add(stand);
        standing.push({ mesh, stand, at: new THREE.Vector3(at[0], at[1], at[2]), radius, material });
        // It is placed before the first frame draws, so nothing is ever seen at the sky's reach.
        standAt = radius;
        continue;
      }
      // A depth stand-in: the body's own disc on the sky, far out, writing depth and no colour. A
      // planet here is a picture with no true distance and writes none itself, so without this the
      // god rays shone straight through it, and so would anything else that reads the frame's
      // depth. It is a cap of a sphere centred where this group is, which is the camera: every
      // point of it is the same distance off in every direction, and it covers exactly the body's
      // own angle and nothing else on the screen.
      const stand = spaceBodyStandIn(radius, SPACE_BODY_DISTANCE);
      standAt = stand.distance;
      const rings = Math.max(4, Math.round(STAND_IN_SEGMENTS / 4));
      const angle = Math.min(Math.PI, stand.halfAngle / Math.cos(Math.PI / STAND_IN_SEGMENTS));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(stand.distance, STAND_IN_SEGMENTS, rings, 0, Math.PI * 2, 0, angle), depthStandIn);
      // The cap is built about +Y and turned onto the body's direction; it stands at the group's
      // own origin, which every frame puts back on the camera.
      cap.quaternion.setFromUnitVectors(capAxis, dir);
      cap.renderOrder = -4;
      cap.frustumCulled = false;
      group.add(cap);
      // The disc it covers on the sky, for the lens flare (SwgSky.setSpaceOccluders).
      const sin = Math.min(1, radius / SPACE_BODY_DISTANCE);
      discs.push({ dir: dir.clone(), cos: Math.sqrt(1 - sin * sin) });
    }
    // Only one set of bodies is ever in the sky: one left from an earlier load of this zone goes first.
    if (this.spaceBodies) {
      this.scene.remove(this.spaceBodies);
      this.disposeSpaceBodies(this.spaceBodies);
    }
    this.spaceBodies = group;
    // The standing bodies are this set's, and only now that this set is the one in the sky.
    this.spaceWorldBodies.length = 0;
    for (const b of standing) this.spaceWorldBodies.push(b);
    this.scene.add(group);
    markActor(group);
    // A star behind a planet must not flare through it: the body itself writes no depth, and its
    // stand-in stands far beyond the sky the flare's occlusion measures, so the flare cannot see it.
    this.swgSky?.setSpaceOccluders(discs);
    console.info(`space: ${discs.length} planets and moons in the sky, each writing its depth ${Math.round(standAt)} m out`);
  }

  /**
   * The bodies that stand somewhere, placed for this frame. Each one is drawn at its true direction
   * from the camera, pulled in to no further than the sky's own reach and scaled by the same ratio,
   * so it covers exactly the angle it truly covers and grows with true parallax as a ship closes on
   * it; its stand-in then writes the depth of its true surface, so anything beyond it is hidden and
   * anything in front of it draws over.
   *
   * A few vector operations per body, nothing allocated, and nothing that could make a program.
   */
  private placeStandingBodies(camPos: THREE.Vector3): void {
    for (const b of this.spaceWorldBodies) {
      tmpV.subVectors(b.at, camPos);
      const d = Math.max(1, tmpV.length());
      tmpV.multiplyScalar(1 / d);
      const place = standingBodyPlace(b.radius, d, SPACE_BODY_DISTANCE, SPACE_SKY_TUNE.quadTan, standPlace);
      b.mesh.position.copy(tmpV).multiplyScalar(place.drawnAt);
      b.mesh.scale.setScalar(place.scale);
      // The stand-in is a quad square to the body, near the camera and just wide enough for its disc.
      // Its three numbers are ours and live (`__debug.suns`), read here rather than kept, so a turn
      // of the knob shows on the next frame.
      b.stand.position.copy(tmpV).multiplyScalar(SPACE_SKY_TUNE.quadAt);
      b.stand.quaternion.setFromUnitVectors(QUAD_AXIS, tmpV);
      const across = 2 * SPACE_SKY_TUNE.quadAt * place.tan * SPACE_SKY_TUNE.quadMargin;
      b.stand.scale.set(across, across, 1);
      // The sphere the shader traces is the drawn one; what it finds is multiplied back out.
      b.material.uniforms.uRadius.value = b.radius * place.scale;
      b.material.uniforms.uDepthScale.value = place.depthScale;
    }
  }

  /** A set of space bodies taken out of the world for good: their materials forgotten, then everything they own freed. */
  private disposeSpaceBodies(group: THREE.Group): void {
    // Nothing standing survives the set it belonged to, so the per-frame placement never reaches a
    // mesh whose geometry has been freed.
    if (this.spaceWorldBodies.some((b) => b.mesh.parent === group)) this.spaceWorldBodies.length = 0;
    // A set, because every body's depth stand-in shares one material.
    const materials = new Set<THREE.Material & { map?: THREE.Texture | null }>();
    for (const o of group.children) {
      const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material & { map?: THREE.Texture | null }>;
      if (!mesh.isMesh) continue;
      mesh.geometry.dispose();
      materials.add(mesh.material);
    }
    const list = [...materials];
    this.forgetMaterials(list);
    for (const m of list) {
      m.map?.dispose();
      m.dispose();
    }
  }

  /**
   * What the nebulae need of the world: the effects a strike plays, a pooled light for its flash,
   * where the player's ship is and how to hurt it, and whether the player lets lightning hurt a
   * ship at all. One kept record, so a load allocates nothing and a strike allocates nothing.
   */
  private readonly nebulaDeps = {
    place: (file: string, matrix: THREE.Matrix4): unknown | null => this.particles?.place(file, matrix, false, true) ?? null,
    remove: (handle: unknown): void => this.particles?.remove(handle as EffectHandle),
    flash: (at: THREE.Vector3, colour: number, intensity: number, distance: number, seconds: number): void => {
      this.npcDeps.effects?.flash(at, colour, intensity, distance, seconds);
    },
    shipAt: (out: THREE.Vector3): number => {
      const contact = this.ships.playerShip;
      const v = contact?.vehicle;
      // A ship in a jump is ghosted and nothing may strike it, as nothing else may.
      if (!contact || !v || contact.dead || contact.ghosted) return 0;
      out.copy(v.pos);
      return Math.max(1, v.radius);
    },
    hurtShip: (amount: number, from: THREE.Vector3): void => {
      const contact = this.ships.playerShip;
      if (!contact || contact.dead || contact.ghosted) return;
      // The ship's own damage path, so the layers, the game's hit effect and the retaliation memory
      // are the same as for a bolt; nobody struck, so nothing is blamed for it.
      contact.combat?.take(amount, from, null);
    },
    damageEnabled: (): boolean => liveSettings().nebulaLightningDamage,
    now: (): number => Date.now(),
  };

  /**
   * The zone's nebulae. Built after the particles exist and before the warm-up, so every material
   * they own is compiled behind the loading screen; a travel or a jump part way through leaves
   * nothing behind (the build is dropped and freed where it stands).
   */
  private async loadNebulae(pack: AssetPack): Promise<void> {
    const token = this.loadToken;
    const data = this.spaceData;
    // The console hook answers in every zone, including one whose table has no nebulae at all.
    installNebulaDebug();
    if (!data) return;
    const fx = this.particles;
    const built = await Nebulae.build(
      this.nebulaDeps,
      data,
      (file) => pack.url(file),
      async (file) => {
        await fx?.prepare(file, this.renderer);
      },
      () => token === this.loadToken,
    );
    if (!built) return;
    if (token !== this.loadToken) {
      built.dispose((m) => this.forgetMaterials(m));
      return;
    }
    this.dropNebulae();
    this.nebulae = built;
    this.scene.add(built.group);
    console.info(`space: ${built.status}`);
  }

  /** The nebulae taken out of the world for good: their materials forgotten (both registers are strong), then freed. */
  private dropNebulae(): void {
    const nebulae = this.nebulae;
    if (!nebulae) return;
    this.nebulae = null;
    this.scene.remove(nebulae.group);
    nebulae.dispose((m) => this.forgetMaterials(m));
  }

  /** `spawn` is where the player arrives: the weather reads the area there, and its sky's textures load before the loading screen lifts. */
  private async loadSky(pack: AssetPack, spawn: THREE.Vector3): Promise<void> {
    const token = this.loadToken;
    const sky = await SwgSky.load(pack);
    if (!sky) return;
    // Another world was loaded while the textures came: this sky is not wanted any more.
    if (token !== this.loadToken) {
      sky.dispose(this.scene, (m) => this.forgetMaterials(m));
      return;
    }
    this.dropSky();
    this.swgSky = sky;
    this.scene.add(sky.group, sky.cloudGroup);
    markActor(sky.group);
    markActor(sky.cloudGroup);
    this.sky.visible = false;
    this.day.swg = true;
    this.day.fixed = sky.spaceLightDir;
    this.fogScale = this.planet.swgFogScale ?? DEFAULT_SWG_FOG_SCALE;
    this.envTimer = 99;
    this.envWant = null;
    // The weather's effects are made and its arrival area's sky loaded inside the awaited loadPack,
    // so the warm-up that follows compiles them and the first frame shows the area's own sky.
    await this.weather.attach({ pack, sky, terrain: this.terrain, planet: this.planet, packId: this.packId, renderer: this.renderer, at: spawn });
    if (token !== this.loadToken) return;
    console.info(`sky: ${sky.data.blocks.length} environment blocks, ${sky.hasGradient ? 'gradient sky' : sky.data.skybox ? 'skybox' : 'clear colour'}, ${sky.data.sun ? 'sun' : 'no sun'}, ${sky.data.moon ? 'moon' : 'no moon'}, ${sky.data.stars?.count ?? 0} stars, reflections from ${sky.environment.day ? 'the planet cube maps' : 'the sky'}`);
  }

  private dropSky(): void {
    if (this.swgSky) {
      this.swgSky.dispose(this.scene, (m) => this.forgetMaterials(m));
      this.swgSky = null;
    }
    this.sky.visible = true;
    this.day.swg = false;
    this.day.fixed = null;
    this.fill.intensity = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.envWant = null;
    this.envFailed.clear();
    this.weather.detach();
    // No sky, no storm: the shadows come back whole.
    this.weatherShadowScale = 1;
    for (const l of this.csm?.lights ?? []) l.shadow.intensity = this.shadowIntensity;
    if (this.portals) this.portals.shadowsWanted = true;
    setEnvironment(null);
  }

  /**
   * The filter the environment cubes go through, with its own three programs built here rather
   * than on the frame that first asks for a cube. Three builds them inside `fromCubemap`, and the
   * cube arrives in a loader's callback, which usually lands after the loading screen has lifted:
   * on a machine where a program costs hundreds of milliseconds that is a visible freeze, and the
   * warning it prints (`_applyPMREM` in the stack) is what put us on to this.
   */
  private makePmrem(renderer: THREE.WebGLRenderer): THREE.PMREMGenerator {
    const gen = new THREE.PMREMGenerator(renderer);
    gen.compileCubemapShader();
    // `compileCubemapShader` covers the cube the pack brings and nothing else: the filter three
    // runs over a *scene* is another program again, and a planet with no cube map of its own
    // reaches it four seconds into play, from `refreshEnvironment`, on whatever frame that lands
    // on. Measured on a machine where a program costs about nine milliseconds, that one frame was
    // 47 ms; on a machine where a program costs a third of a second it is a visible freeze, in
    // play, for a picture nobody asked for. One throw-away filter of an empty scene builds it here
    // instead, with the very numbers the real call uses so that nothing about the program can
    // differ, and the target it hands back is given up at once. Nothing is kept and no frame that
    // is drawn is changed by it.
    try {
      const empty = new THREE.Scene();
      gen.fromScene(empty, 0.04, 1, 20000, { size: 128 }).dispose();
    } catch (err) {
      console.warn('sky: the environment filter could not be warmed; its first reflection will cost a frame', err);
    }
    return gen;
  }

  /**
   * The environment reflective surfaces see: the block's day or night cube map when the pack
   * has one, otherwise the sky dome itself, filtered again every few seconds as it changes.
   */
  private refreshEnvironment(dt: number): void {
    const sky = this.swgSky;
    if (!sky || !this.renderer) return;
    this.pmrem ??= this.makePmrem(this.renderer);
    // The heaviest block's cube for the hour (the weather's mix picks the block), by its first face:
    // a new area or level with another cube loads that one; a cube that failed is never asked again.
    const cube = this.day.isDay ? sky.environment.day : sky.environment.night;
    const usable = cube && cube.faces.length && !this.envFailed.has(cube.faces[0]) ? cube : null;
    if (usable) {
      const want = usable.faces[0];
      if (this.envWant === want) return;
      this.envWant = want;
      const pmrem = this.pmrem;
      new THREE.CubeTextureLoader().load(
        usable.faces.map((f) => this.pack!.url(f)),
        (tex) => {
          // Another cube was asked for (or the sky went) while this one came: not wanted any more.
          if (this.swgSky !== sky || this.envWant !== want) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          const env = pmrem.fromCubemap(tex).texture;
          tex.dispose();
          this.envTexture?.dispose();
          this.envTexture = env;
          setEnvironment(env, 1);
        },
        undefined,
        () => {
          console.warn(`sky: reflection cube map ${want} failed to load; reflecting the sky instead`);
          this.envFailed.add(want);
          if (this.envWant === want) this.envWant = null;
        },
      );
      return;
    }
    this.envWant = null;
    this.envTimer += dt;
    if (this.envTimer < 4) return;
    this.envTimer = 0;
    // Filtered from a 128 px cube like every other environment water may see, so swapping to it
    // never changes a water material's program key (envMapCubeUVHeight is in that key).
    const env = this.pmrem.fromScene(sky.domeScene, 0.04, 1, 20000, { size: 128 }).texture;
    this.envTexture?.dispose();
    this.envTexture = env;
    setEnvironment(env, 1);
  }

  /**
   * A person's legs, a hull's keel line: the shape that goes into the water is the shape the
   * ripple takes. Each wader and every floating vehicle keeps a proxy in the height field
   * waterSim.ts steps, moved here every frame so a wake is continuous rather than a row of rings.
   * Spray stays on its own slower clock, since particles do not need the frame rate.
   */
  private emitRipples(dt: number, playerPos: THREE.Vector3): void {
    this.splashes.update(dt, (x, z) => this.terrain.waterHeightAt(x, z));
    if (!this.waterMaterials.length) return;
    this.rippleClock += dt;
    const spray = this.rippleClock >= RIPPLE_INTERVAL;
    if (spray) this.rippleClock = 0;
    this.simSeen.clear();

    const touch = (key: object, p: THREE.Vector3, geo: THREE.BufferGeometry, draft: number, q: THREE.Quaternion | null, strength: number, floats = false) => {
      // Lava takes no rings and throws no spray (`World.lavaAt`: finite is a flow over this column).
      if (Number.isFinite(this.lavaAt(p.x, p.y, p.z))) return;
      // Nor does a room. This reader asked the water table by column, as the feet and the blade once
      // did, so in the 87 placed buildings whose floors stand under their planet's water table a
      // walker indoors pushed the ripple field about and left rings on a stone floor. The shared
      // reader tells a room from open water, and -Infinity is its own "no water over this point".
      const surface = this.footSurfaces.waterTop(p.x, p.y, p.z);
      if (!Number.isFinite(surface)) return;
      // What floats is floated by `seaAt`, so its own height breathes with the swell while this
      // reader's does not: measured against the flat table alone the window below would open and
      // shut with the wave under the hull rather than with where the hull is. The swell over the
      // column is added back, which leaves the depth bit for bit what it was on a flat sea whatever
      // the wave does, and is 0 on a lake, in the shallows, over a flow and with the switch off. A
      // wader is not lifted by anything and takes none of it: the swim line, the feet and the
      // splashes all keep the flat table, which is the whole reason there are two readers (D17).
      const lift = floats ? this.seaSwellOver(p.x, p.z) : 0;
      const depth = surface + lift - p.y;
      let last = this.lastSeen.get(key);
      if (!last) {
        last = new THREE.Vector3(Number.NaN, 0, 0);
        this.lastSeen.set(key, last);
      }
      const known = !Number.isNaN(last.x);
      const vx = known && dt > 0 ? (p.x - last.x) / dt : 0;
      const vz = known && dt > 0 ? (p.z - last.z) / dt : 0;
      const vy = known && dt > 0 ? (last.y - p.y) / dt : 0;
      last.copy(p);
      if (depth < -0.3 || depth > 2.5) return;

      let body = this.simBodies.get(key);
      if (!body) {
        body = addSimBody(geo, draft);
        this.simBodies.set(key, body);
      }
      body.active = true;
      body.draft = draft;
      body.object.position.copy(p);
      if (q) body.object.quaternion.copy(q);
      // Only a real arrival punches a crater; a wader bobbing does not.
      body.velDown = Math.max(0, Math.min((vy - 1.5) / 12, 1)) * strength;
      this.simSeen.add(key);

      // Spray past a brisk walk, more the faster the mover and the shallower it sits. It is thrown
      // from the **flat** surface even under a hull riding a crest, because a droplet dies when it
      // falls back through the height `Splashes.update` is fed, which is the flat table: born on the
      // sea instead, a burst in a trough would spawn under that height and die on its first step.
      // The two must agree, and moving both is the floating ship's work, not this reader's.
      const speed = Math.hypot(vx, vz);
      if (spray && speed > 1.6 && depth < 1.6) {
        this.splashes.spawn(p.x, surface, p.z, Math.round(1 + Math.min(speed, 8) * 0.9 * strength), vx, vz);
      }
    };

    const wader = (this.waderProxy ??= buildWaderProxy());
    touch(this, playerPos, wader, 1.1, null, 1);
    for (const t of this.targets()) if (!t.dead && t !== this.playerTarget) touch(t, t.pos, wader, 1.0, null, 0.9);

    // A hull displaces along its whole length, so the proxy is the vehicle's own box, turned with
    // it: the wake comes off the real beam and draught instead of two points near the middle.
    for (const v of this.vehicles) {
      if (!v.onWater) continue;
      const b = v.spec.bounds;
      let geo = this.hullProxies.get(v.spec.id);
      if (!geo) {
        geo = new THREE.BoxGeometry(
          Math.max(0.3, b.max[0] - b.min[0]),
          Math.max(0.3, b.max[1] - b.min[1]),
          Math.max(0.3, b.max[2] - b.min[2]),
        );
        geo.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
        this.hullProxies.set(v.spec.id, geo);
      }
      v.quaternion(tmpQ);
      tmpV.copy(v.pos);
      // The last argument is what says this one floats: its height was written by springs fed the sea.
      touch(v, tmpV, geo, Math.max(0.5, v.radius * 0.7), tmpQ, 1.4 + v.radius * 0.3, true);
    }

    // Anything not touched this frame has left the water, so it stops being drawn into the field.
    // Anything not touched this frame has left the water, so it stops being drawn into the field;
    // one that has been out of it for a while is let go altogether. Without that the map holds a
    // mesh, a material and the dead body itself for everything that has ever waded, for the life of
    // the page and across travels. A body that comes back makes an identical material, so three
    // finds the program it already has and nothing is compiled for it.
    for (const [key, body] of this.simBodies) {
      if (this.simSeen.has(key)) {
        this.simIdle.set(key, 0);
        continue;
      }
      body.active = false;
      const idle = (this.simIdle.get(key) ?? 0) + dt;
      if (idle <= SIM_BODY_KEEP) {
        this.simIdle.set(key, idle);
        continue;
      }
      body.dispose();
      this.simBodies.delete(key);
      this.simIdle.delete(key);
    }
  }

  /**
   * Dust behind every machine (not the animals) running over ground: more the faster it goes,
   * in the colour of the ground there, none over water, none in the air.
   */
  private emitDust(dt: number): void {
    this.dust.update(dt);
    this.dustDue += dt;
    if (this.dustDue < 0.05) return;
    const interval = this.dustDue;
    this.dustDue = 0;
    for (const v of this.vehicles) {
      const speed = Math.abs(v.speed);
      if (v.spec.animal || v.groundedPoints < 2 || v.onWater || speed < 2.5) continue;
      const ground = this.terrain.heightAt(v.pos.x, v.pos.z);
      const height = v.pos.y + v.spec.bounds.min[1] - ground;
      if (height > v.spec.hover * 2 + 1) continue;
      v.quaternion(tmpQ);
      const l = v.spec.bounds.max[2] - v.spec.bounds.min[2];
      const w = v.spec.bounds.max[0] - v.spec.bounds.min[0];
      tmpV.set(0, 0, -l * 0.35).applyQuaternion(tmpQ).add(v.pos);
      const vel = v.body.linvel();
      const count = Math.round(interval * (12 + 70 * Math.min(1, speed / 35)) * (0.6 + Math.min(1.4, w * 0.35)));
      this.dust.spawn(tmpV.x, ground, tmpV.z, count, vel.x, vel.z, Math.max(0.6, w * 0.9), this.groundColorAt(tmpV.x, tmpV.z, this.dustColor));
    }
  }

  /** The colour of the ground at a point: its texture family's mean on a real planet, the palette's elsewhere. */
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color {
    if (this.terrain.swg && this.groundTextures) {
      const c = this.groundTextures.averageColor(this.terrain.swg.shaderAt(x, z));
      if (c) return out.copy(c);
    }
    return this.terrain.groundColorAt(x, z, out);
  }

  /** Lights, fog and clear colour straight from the sky's colour ramps for this moment. */
  private applySwgLighting(L: SkyLighting, playerPos: THREE.Vector3): void {
    this.sun.color.copy(L.main);
    this.sun.intensity = SWG_MAIN_LIGHT * L.mainScale;
    // A storm row that turns shadows off fades them through the cascades' intensity (never a light,
    // castShadow or shadowMap.enabled, all of which recompile), and the shadow pass is skipped at zero.
    this.weatherShadowScale = this.weather.shadowFactor(L);
    if (this.csm) {
      for (const l of this.csm.lights) {
        l.color.copy(this.sun.color);
        l.intensity = this.sun.intensity;
        l.shadow.intensity = this.shadowIntensity * this.weatherShadowScale;
      }
    }
    if (this.portals) this.portals.shadowsWanted = this.weatherShadowScale > 0.001;
    // What a wet surface reflects at a low angle: the sky's fog colour, a little dimmed.
    WEATHER_UNIFORMS.uWetSky.value.copy(L.fog).multiplyScalar(0.9);
    // Sky above, ground bounce below: the two halves of the client's ambient. Both carry their
    // own scale in the ramp's alpha, so the colours go in as they are and the scales set the
    // light's strength; the bounce is the darker half, mixed toward the sky so it never blackens.
    this.hemi.color.copy(L.ambient).multiplyScalar(L.ambientScale);
    this.hemi.groundColor.copy(L.bounce).multiplyScalar(L.bounceScale).lerp(this.hemi.color, 0.35);
    this.hemi.intensity = SWG_AMBIENT * this.ambientScale;
    this.fill.color.copy(L.fill);
    this.fill.intensity = SWG_FILL * L.fillScale;
    // The client's fill light sits 45 degrees up on the far side from the main light.
    const d = this.day.lightDir;
    const h = Math.hypot(d.x, d.z) || 1;
    this.fill.position.set(playerPos.x - (d.x / h) * 140, playerPos.y + 140, playerPos.z - (d.z / h) * 140);
    this.fill.target.position.copy(playerPos);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(L.fog);
    // The client's fog is Direct3D's EXP2, the same curve as three's, so the density carries over as is.
    fog.density = L.fogDensity * this.fogScale * this.userFog;
  }

  private disposeChunk(c: Chunk): void {
    this.chunkRoot.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.removeChunkPhysics(c);
  }

  private removeChunkPhysics(c: Chunk): void {
    if (!c.physics) return;
    for (const col of c.physics) this.physics.removeCollider(col);
    c.physics = null;
  }

  private addChunkPhysics(c: Chunk): void {
    if (c.physics) return;
    const cols: RAPIER.Collider[] = [];
    cols.push(this.physics.createHeightfield(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, c.heights));
    for (const p of c.colliders) {
      const ground = this.terrain.heightAt(p.x, p.z) - 0.5;
      const halfH = (p.top - ground) / 2;
      const col = this.physics.createStaticCylinder(p.x, ground + halfH, p.z, p.r, halfH);
      if (col) cols.push(col);
    }
    c.physics = cols;
  }

  /** The converted flora models, keyed by the appearance file the terrain names. */
  /** The pack's ground textures; existing chunks and far tiles switch to them when they arrive. */
  private async loadGroundTextures(pack: AssetPack): Promise<void> {
    try {
      const swg = this.terrain.swg;
      const planet = new Map<number, string>();
      if (swg) for (const f of swg.template.generator.shaderGroup.families.values()) planet.set(f.id, f.name);
      const textures = await TerrainTextures.load(pack, World.anisotropy, planet);
      if (!textures) return;
      this.groundTextures?.dispose();
      this.groundTextures = textures;
      const mat = textures.groundMaterial(this.csm);
      this.csmMaterials.add(mat);
      for (const c of this.chunks.values()) c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === this.terrainMat) (o as THREE.Mesh).material = mat; });
      for (const t of this.farTiles.values()) if (t.material === this.terrainMat) t.material = mat;
      console.info(`terrain: ${textures.families.length} ground textures (${textures.texture.image.width} px)`);
    } catch (err) {
      console.warn('terrain: ground textures failed to load', err);
    }
  }

  /** The material for new ground meshes: textured when the planet has textures, tinted otherwise. */
  private get groundMaterial(): THREE.Material {
    return this.groundTextures && this.terrain.swg ? this.groundTextures.groundMaterial(this.csm) : this.terrainMat;
  }

  private async loadFlora(pack: AssetPack, swg: SwgTerrain): Promise<void> {
    const defs = pack.category('flora').filter((d) => d.appearance);
    if (!defs.length) return;
    const models = await pack.models(defs.map((d) => d.id));
    const byAppearance = new Map<string, LoadedModel>();
    defs.forEach((d, i) => {
      const m = models[i];
      if (m) byAppearance.set(d.appearance!.replace(/\\/g, '/').toLowerCase(), m);
    });
    const families = swg.template.generator.floraGroup.families.size;
    this.flora = new FloraPlanter(swg, byAppearance);
    console.info(`flora: ${byAppearance.size} models for ${families} families`);
  }

  /**
   * Water where the terrain says it is: the global table's height, plus every lake and pool, each
   * drawn with the look of the water shader its own table names.
   */
  private applySwgWater(swg: SwgTerrain): void {
    const planet = this.planet;
    const bodies = this.waterBodies;
    // The pack's water.json has landed by now, so anything cached before it is out of date.
    this.waterLooks.clear();
    this.cameraWater.look = null;
    this.forgetCameraWater();
    this.globalWaterShader = swg.template.useGlobalWaterTable ? shaderKey(swg.template.globalWaterTableShaderTemplateName) || null : null;
    // The global table gets the lava reading the local ones get below, since nothing else gives it
    // one: it has no terrain water type of its own, so the pack's entry and then its shader's name.
    this.globalWaterIsLava = !!this.globalWaterShader && isLavaWater(this.globalWaterShader, 0, bodies.data?.shaders[this.globalWaterShader]);
    if (swg.template.useGlobalWaterTable) {
      const look = bodies.lookFor(shaderKey(swg.template.globalWaterTableShaderTemplateName) || null, planet);
      if (!this.water) this.createGlobalWater(look, swg.template.globalWaterTableHeight);
      else {
        if (this.waterNear) bodies.restyle(this.waterNear, look);
        if (this.waterFarBody) bodies.restyle(this.waterFarBody, look);
      }
      this.water!.visible = true;
      this.water!.position.y = swg.template.globalWaterTableHeight;
      if (this.waterFar) {
        this.waterFar.visible = true;
        this.waterFar.position.y = swg.template.globalWaterTableHeight - 0.05;
      }
    } else if (this.water) {
      this.water.visible = false;
      if (this.waterFar) this.waterFar.visible = false;
    }
    for (const m of this.localWater) {
      bodies.remove(m);
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    const shaders = new Set<string>();
    let lava = 0;
    for (const w of swg.waterTables) {
      // Lava is never water: loadLava draws it with its own material, and it gets no body, no
      // reflections, rings or splashes.
      if (isLavaWater(w.shader, w.waterType, bodies.data?.shaders[w.shader])) {
        lava++;
        continue;
      }
      const pts = w.points.map((p) => new THREE.Vector2(p.x, p.z));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      if (!tris.length) continue;
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      for (const p of pts) pos.push(p.x, w.height, p.y);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g);
      mesh.receiveShadow = true;
      mesh.name = `water:${w.name}`;
      // Lakes are triangulated outlines with no interior vertices, so they ripple but do not swell.
      const body = bodies.add(mesh, false, bodies.lookFor(w.shader || null, planet), 'lake');
      this.waterMaterials.push(body.lit);
      if (w.shader) shaders.add(w.shader);
      this.localWater.push(mesh);
      this.scene.add(mesh);
    }
    bodies.lavaTables = lava;
    // What this planet's water does to what stands in it, out of the pack's own `harm` block (the
    // client's own tables, as the water command wrote them). Seeded on every load, lava or not, so
    // nothing carries over from the last world; a pack converted before the command read them
    // carries no block, and then nothing burns and the warning says which command mends it.
    //
    // `bodies.data` is `readWaterPack`'s record and it carries the block through untouched. That is
    // load-bearing and not incidental: the reader builds its own object, so a field it stopped
    // carrying would take the whole burn away in silence, and `waterLook.ts` says so where it does it.
    const harm = applyLavaHarm(bodies.data, lava > 0);
    if (harm.note) console.warn(harm.note);
    else if (lava > 0) console.info(`lava: ${(harm.share * 100).toFixed(0)}% of a life every ${harm.interval} s (${harm.source})`);
    if (swg.waterTables.length) console.info(`water: ${swg.waterTables.length} local tables (${this.localWater.length} water in ${shaders.size} shaders, ${lava} lava)${swg.template.useGlobalWaterTable ? `, global at ${swg.template.globalWaterTableHeight.toFixed(1)} m` : ', no global table'}`);
  }

  /** Lava where the terrain puts it: one merged mesh per look, the client's textures when the pack has them, the tables handed to the heat haze. */
  private async loadLava(pack: AssetPack, swg: SwgTerrain): Promise<void> {
    const token = this.loadToken;
    const data = this.waterBodies.data;
    const tables = swg.waterTables.filter((w) => isLavaWater(w.shader, w.waterType, data?.shaders[w.shader]));
    if (!tables.length) {
      this.heat?.setLava([]);
      return;
    }
    if (!data) console.warn('lava: no water.json in this pack, drawn in the stand-in look (npm run swg -- water @SWG all assets-private --retail-only)');
    else {
      // An entry written before the lava look has no `lava` block (null is an unreadable MATL, which a reconversion does not mend).
      const stale = [...new Set(tables.map((t) => t.shader))].filter((s) => { const e = data.shaders[s]; return e?.kind === 'lava' && !e.missing && e.lava === undefined && /lava/i.test(e.effect ?? ''); });
      if (stale.length) console.warn(`lava: water.json has no lava look for ${stale.join(', ')}, drawn in the stand-in look (npm run swg -- water @SWG all assets-private --retail-only)`);
    }
    const owned: THREE.Texture[] = [];
    const cache = new Map<string, THREE.Texture>();
    const materials: LavaMaterial[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    const heatTables: LavaHeatTable[] = [];
    const looks: { style: string; tables: number; textures: LavaTextures['source'] }[] = [];
    const discard = () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of owned) t.dispose();
    };
    for (const group of groupLava(tables).values()) {
      const { shader, shaderSize } = group[0];
      let style = lavaStyleFor(shader, data?.shaders[shader]);
      let textures: LavaTextures;
      try {
        textures = await loadLavaTextures(pack, style, World.anisotropy, cache, owned);
      } catch (err) {
        // loadLavaTextures guards each piece; this is the last line.
        console.warn(`lava: ${shader} textures failed, stand-in look`, err);
        style = { ...FALLBACK_LAVA_STYLE, key: `stand-in:${shader}` };
        textures = standInLavaTextures();
      }
      // Travelled while the textures came: touch nothing.
      if (token !== this.loadToken) return discard();
      this.buildLavaLook(group, style, shaderSize, textures, { materials, geometries, meshes, heatTables, looks });
    }
    if (token !== this.loadToken) return discard();
    this.commitLava(tables, { materials, geometries, meshes, heatTables, looks, owned });
  }

  /** One look's tables as one merged mesh; a look that fails is left out on its own and never stops the rest. */
  private buildLavaLook(group: SwgWaterTable[], style: LavaStyle, shaderSize: number, textures: LavaTextures, out: { materials: LavaMaterial[]; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; heatTables: LavaHeatTable[]; looks: { style: string; tables: number; textures: LavaTextures['source'] }[] }): void {
    const shader = group[0].shader;
    try {
      const material = createLavaMaterial(style, shaderSize, textures);
      out.materials.push(material);
      const parts = group.map((t) => lavaGeometry(t));
      out.geometries.push(...parts);
      const drawn = parts.filter((p) => p.index !== null);
      if (!drawn.length) throw new Error('no table triangulates');
      const merged = mergeGeometries(drawn);
      if (!merged) throw new Error('geometries do not merge');
      out.geometries.push(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `lava:${shader}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Planet-wide bounds: never frustum-tested, and each draw is under a few thousand vertices.
      mesh.frustumCulled = false;
      out.meshes.push(mesh);
      // Only what is drawn shimmers: a table that does not triangulate has nothing for the haze to trace.
      group.forEach((t, i) => { if (parts[i].index) out.heatTables.push(lavaHeatTable(t, parts[i])); });
      out.looks.push({ style: style.key, tables: group.length, textures: textures.source });
    } catch (err) {
      console.warn(`lava: ${shader} (${group.length} tables) not drawn`, err);
    }
  }

  /** Put a finished lava load in the world. Nothing here awaits, so a load that got this far is whole. */
  private commitLava(tables: SwgWaterTable[], built: { materials: LavaMaterial[]; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; heatTables: LavaHeatTable[]; looks: { style: string; tables: number; textures: LavaTextures['source'] }[]; owned: THREE.Texture[] }): void {
    this.dropLava();
    for (const m of built.meshes) this.scene.add(m);
    this.localLava.push(...built.meshes);
    this.lavaMaterials.push(...built.materials);
    this.lavaGeometries.push(...built.geometries);
    this.lavaTextures.push(...built.owned);
    for (const t of tables) this.lavaTables.add(t);
    this.lavaLooks = built.looks;
    this.heat?.setLava(built.heatTables);
    console.info(`lava: ${tables.length} tables in ${built.looks.length} looks (${built.looks.map((l) => `${l.style} ×${l.tables}`).join(', ')})`);
  }

  /** Every lava piece this planet owns, gone; the heat haze lets go of the tables first, since their geometries go with them. */
  private dropLava(): void {
    this.heat?.setLava([]);
    for (const m of this.localLava) this.scene.remove(m);
    this.localLava.length = 0;
    this.forgetMaterials(this.lavaMaterials);
    for (const m of this.lavaMaterials) m.dispose();
    this.lavaMaterials.length = 0;
    for (const g of this.lavaGeometries) g.dispose();
    this.lavaGeometries.length = 0;
    // The runtime noise and the stand-in ramp are never in this list: they live for the app.
    for (const t of this.lavaTextures) t.dispose();
    this.lavaTextures.length = 0;
    this.lavaTables.clear();
    this.lavaLooks = [];
  }

  /** The lava drawn now, the look every lava material shares, and what it does to whoever stands in it (`__debug.lava`). */
  get lavaStatus(): {
    tables: number;
    looks: { style: string; tables: number; textures: LavaTextures['source'] }[];
    intensity: number;
    glow: number;
    glowFrom: number;
    glowTo: number;
    axes: 'xyz' | 'xzy';
    harm: ReturnType<typeof lavaHarmReport>;
    burning: 'no' | 'you' | 'ride';
    /** Metres under the flow over the player (or under it at the belly of what they ride), negative above it; null where the water there is not lava. */
    depth: number | null;
    /** Whether the tick is holding a verdict that has gone false, and for how long (`LAVA_HARM.linger`). */
    held: { for: number; linger: number } | null;
  } {
    const e = LAVA_LOOK.axes.value.elements;
    const at = this.playerRides ?? null;
    const p = at ? at.pos : this.playerTarget.pos;
    // The same point the tick measures, or the console would report a depth the burn is not using.
    const lift = at ? Math.min(at.spec.bounds.min[1], at.spec.bounds.max[1]) : 0;
    const depth = this.lavaAt(p.x, p.y + lift, p.z);
    return {
      tables: this.lavaTables.size,
      looks: this.lavaLooks.map((l) => ({ ...l })),
      intensity: LAVA_LOOK.intensity.value,
      glow: LAVA_LOOK.glow.value,
      glowFrom: LAVA_LOOK.glowFrom.value,
      glowTo: LAVA_LOOK.glowTo.value,
      axes: e[4] === 1 ? 'xyz' : 'xzy',
      harm: lavaHarmReport(),
      burning: this.lavaBurning,
      depth: Number.isFinite(depth) ? depth : null,
      held: this.lavaHold.in && this.lavaHold.gap > 0 && Number.isFinite(this.lavaHold.gap) ? { for: this.lavaHold.gap, linger: LAVA_HARM.linger } : null,
    };
  }

  /** Writes LAVA_HARM: what a flow takes, how often, and where its two lines are drawn (`__debug.lava`). */
  setLavaHarm(harm: LavaHarmTune): void {
    tuneLavaHarm(harm);
  }

  /**
   * The player's own fire: the numbers in force and the burn as it stands (`__debug.burn`).
   *
   * `light` sets the player alight now, which is the only way anyone can see a fire at all until
   * something in the game reaches `PlayerTarget.afflict` -- today nothing does, and the notes with
   * this wave say exactly why. It goes through `afflict`, so it is refused while the player may not
   * be hurt and it obeys the greater-of-the-two rule like any other burn.
   */
  setPlayerBurn(tune?: PlayerBurnTune & { light?: { dps: number; seconds: number }; out?: boolean }): ReturnType<typeof burnReport> {
    if (tune) {
      tunePlayerBurn(tune);
      // The switch thrown off puts a fire already lit out **here**, not at the next step. The step
      // is in `Player.update`, which does not run while a panel is open, so a switch thrown from the
      // console with the menu up would otherwise leave the player burning -- drawn, heated and
      // sounded by the manager, which reads the burn and not the switch -- until the menu closed.
      if (tune.on === false) this.playerTarget.clearBurn();
      if (tune.out) this.playerTarget.clearBurn();
      if (tune.light) this.playerTarget.afflict(tune.light.dps, tune.light.seconds);
    }
    return burnReport(this.playerTarget.burn);
  }

  /** Writes LAVA_LOOK; a threshold change recomputes every lava material's far values. */
  setLavaLook(look: { intensity?: number; glow?: number; glowFrom?: number; glowTo?: number; axes?: 'xyz' | 'xzy' }): void {
    const num = (v: number | undefined) => v !== undefined && Number.isFinite(v);
    if (num(look.intensity)) LAVA_LOOK.intensity.value = look.intensity!;
    if (num(look.glow)) LAVA_LOOK.glow.value = look.glow!;
    const thresholds = num(look.glowFrom) || num(look.glowTo);
    if (num(look.glowFrom)) LAVA_LOOK.glowFrom.value = look.glowFrom!;
    if (num(look.glowTo)) LAVA_LOOK.glowTo.value = look.glowTo!;
    // Rows of the matrix: 'xzy' feeds the world's z to the noise's y and y to its z.
    if (look.axes === 'xyz') LAVA_LOOK.axes.value.identity();
    else if (look.axes === 'xzy') LAVA_LOOK.axes.value.set(1, 0, 0, 0, 0, 1, 0, 1, 0);
    if (thresholds) for (const m of this.lavaMaterials) refreshLavaFar(m);
  }

  /** Find a comfortable spot near the origin: dry, gentle slope. */
  spawnPoint(): THREE.Vector3 {
    // A space zone has no ground to stand on: its arrival point is the zone's origin, in a ship.
    if (this.planet.space) return new THREE.Vector3(0, 0, 0);
    const n = new THREE.Vector3();
    let best = new THREE.Vector3(0, this.terrain.heightAt(0, 0), 0);
    let bestScore = -Infinity;
    for (let r = 0; r < 200; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h < this.terrain.waterLevel + 1.5) continue;
        const ny = this.terrain.normalAt(x, z, n).y;
        const score = ny * 10 - r * 0.02;
        if (score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(x, h, z);
        }
        if (ny > 0.97) return best;
      }
    }
    return best;
  }

  /**
   * Cascaded shadow maps: three cascades that follow the camera out to SHADOW_DISTANCE instead
   * of one 280 m box around the player. Every lit material must be set up for it, so materials
   * are scanned as objects appear.
   */
  attachCamera(camera: THREE.PerspectiveCamera, shadows: boolean, portals: PortalRenderer): void {
    this.portals = portals;
    this.camera = camera;
    // The sun, sky light and their shadows stay on the world layer: rooms are lit by their own
    // lights, as in the client, and never by sunlight through the walls.
    if (!shadows || this.csm) return;
    this.csm = new CSM({ camera, parent: this.scene, cascades: 3, maxFar: this.shadowDistance, mode: 'practical', shadowMapSize: this.shadowMapSize, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: LIGHT_MARGIN, lightNear: LIGHT_NEAR, lightFar: LIGHT_MARGIN + this.shadowDistance });
    this.csm.fade = true;
    this.applyShadowQuality();
    this.sun.castShadow = false;
    this.sun.visible = false;
    this.setupShadowMaterials();
  }

  /**
   * Retune the shadows and report what they cost. `distance` rebuilds the cascades at a new
   * reach (shorter is cheaper *and* sharper); `minRadius` re-gates which placed objects cast.
   */
  setShadows(distance?: number, minRadius?: number): { distance: number; minRadius: number; casters: number; notCasting: number } {
    // Retune in place. CSM.dispose() deletes every patched material's onBeforeCompile, which
    // would take the ground's texture blending with it, and it leaves its lights in the scene;
    // updateFrustums() re-splits the cascades and refreshes their uniforms without either.
    if (distance !== undefined && distance !== this.shadowDistance) {
      this.shadowDistance = distance;
      if (this.csm) {
        this.csm.maxFar = distance;
        this.csm.lightFar = LIGHT_MARGIN + distance;
        this.csm.updateFrustums();
        // The cascade boxes just changed size, so the texel-relative biases have to follow.
        this.applyShadowQuality();
      }
    }
    if (minRadius !== undefined) {
      this.shadowMinRadius = minRadius;
      this.scene.traverse((o) => {
        const m = o as THREE.InstancedMesh;
        if (!m.isInstancedMesh) return;
        if (!m.boundingSphere) m.computeBoundingSphere();
        const g = m.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        m.castShadow = (g.boundingSphere?.radius ?? 0) >= minRadius;
      });
    }
    let casters = 0;
    let notCasting = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      if (m.castShadow) casters++;
      else notCasting++;
    });
    return { distance: this.shadowDistance, minRadius: this.shadowMinRadius, casters, notCasting };
  }

  /**
   * The cascades are fitted to the camera's frustum, so a new aspect ratio resizes every
   * cascade box -- and with it the texel size the biases are derived from.
   */
  onCameraResized(): void {
    if (!this.csm) return;
    this.csm.updateFrustums();
    this.applyShadowQuality();
  }

  /** Push the current bias, blur and darkness onto every cascade. */
  private applyShadowQuality(): void {
    const size = this.shadowMapSize;
    for (const l of this.csm?.lights ?? []) {
      const cam = l.shadow.camera;
      cam.near = LIGHT_NEAR;
      cam.far = LIGHT_MARGIN + this.shadowDistance;
      cam.updateProjectionMatrix();
      // One texel of this cascade, in metres: its map covers the whole cascade box.
      const texel = (cam.right - cam.left) / size;
      l.shadow.normalBias = SHADOW_NORMAL_BIAS_TEXELS * texel;
      // Back to normalised depth, which is the unit three stores this one in.
      l.shadow.bias = -(SHADOW_BIAS_TEXELS * texel) / (cam.far - cam.near);
      l.shadow.radius = this.shadowRadius;
      // A retune keeps the weather's fade.
      l.shadow.intensity = this.shadowIntensity * this.weatherShadowScale;
      if (l.shadow.mapSize.width !== size) {
        l.shadow.mapSize.set(size, size);
        // The render target is sized on creation, so drop it and let three make a new one.
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
  }

  /**
   * Shadow look, live. `radius` is the blur in shadow-map texels (1 crisp, 3 soft) and
   * `intensity` how dark a shadow goes (1 full). Reports the cascade split distances, which
   * are what actually decide how crisp a near shadow can be.
   */
  setShadowLook(radius?: number, intensity?: number, mapSize?: number): { radius: number; intensity: number; mapSize: number; cascades: { range: string; boxMetres: string; metresPerTexel: string; normalBiasCm: string; depthBiasCm: string }[] } {
    if (radius !== undefined) this.shadowRadius = radius;
    if (intensity !== undefined) this.shadowIntensity = intensity;
    if (mapSize !== undefined) this.shadowMapSize = mapSize;
    this.applyShadowQuality();
    const csm = this.csm;
    const size = this.shadowMapSize;
    const cascades: { range: string; boxMetres: string; metresPerTexel: string; normalBiasCm: string; depthBiasCm: string }[] = [];
    if (csm) {
      const near = this.camera?.near ?? 0.1;
      let from = near;
      csm.breaks.forEach((b, i) => {
        const to = near + (this.shadowDistance - near) * b;
        const l = csm.lights[i];
        const cam = l?.shadow.camera;
        // The map covers the cascade's bounding box, which is wider than the slice it is fitted
        // to -- that box over the map's edge is the real texel size, and what decides aliasing.
        const box = cam ? cam.right - cam.left : 0;
        cascades.push({
          range: `${from.toFixed(0)}-${to.toFixed(0)}m`,
          boxMetres: box.toFixed(0),
          metresPerTexel: (box / size).toFixed(4),
          normalBiasCm: ((l?.shadow.normalBias ?? 0) * 100).toFixed(1),
          depthBiasCm: cam ? (Math.abs(l.shadow.bias) * (cam.far - cam.near) * 100).toFixed(1) : '0',
        });
        from = to;
      });
    }
    return { radius: this.shadowRadius, intensity: this.shadowIntensity, mapSize: size, cascades };
  }

  get buildings(): Iterable<Building> {
    return this.layoutStream?.buildings ?? [];
  }

  /**
   * The pack the buildings a player can put down come out of, fetched once and then kept for the
   * session. It is the gallery's: a snapshot pack holds what the game's own worlds placed, and the
   * player houses are not placed on any world. On the gallery world itself it is the world's own
   * pack and nothing is fetched twice.
   */
  private housePack: Promise<AssetPack | null> | null = null;

  housesPack(): Promise<AssetPack | null> {
    if (this.pack && this.pack.manifest.planet === 'gallery') return Promise.resolve(this.pack);
    this.housePack ??= AssetPack.load('gallery');
    return this.housePack;
  }

  /**
   * Put a building on the ground in the world that is loaded, as a player placing a house does.
   *
   * This is the placing itself and the ground test in front of it; whether it is written down and
   * who is told is the relay's (`src/net/homes.ts`). What it hands back says either where the house
   * went or, in words, why the ground would not take it.
   *
   * The `y` it stands the building at is the ground, not the bottom of its box: a house's origin is
   * its ground line and its cellar is modelled sixteen metres below that. A `y` given by the caller
   * is used as it stands and the ground is still measured, because a house standing on a world has
   * one height and that is the one the server wrote down -- a second browser re-measuring would
   * agree today and would not the day the terrain changes under everybody.
   *
   * `key` is what it is filed under, and is what takes it away again. The default is a name of its
   * own per model, so `__debug.house` on its own puts one down and can take it back; a home carries
   * the id the server gave it.
   */
  async placeBuilding(
    model: string,
    opts: { at?: { x: number; z: number }; from?: { x: number; z: number }; yaw?: number; force?: boolean; key?: string; y?: number; tryOnly?: boolean } = {},
  ): Promise<{ ok: boolean; why: string | null; key: string; x: number; z: number; y: number; yaw: number; rise: number; sink: number; slope: number; clear: number; building: Building | null }> {
    const stream = this.layoutStream;
    const key = opts.key ?? `runtime/${model}`;
    const refuse = (why: string) => ({ ok: false, why, key, x: 0, z: 0, y: 0, yaw: 0, rise: 0, sink: 0, slope: 0, clear: 0, building: null });
    if (!stream) return refuse('no world is loaded');
    if (this.planet.space) return refuse('there is no ground out here');
    const pack = await this.housesPack();
    if (!pack) return refuse('the gallery pack is not converted, so there are no buildings to put down');
    if (!pack.find(model)) return refuse(`${model} is not in the gallery pack`);
    stream.useGuestPack(pack);
    let loaded: LoadedModel;
    try {
      loaded = await pack.model(model);
    } catch (err) {
      return refuse(`${model} would not load: ${err instanceof Error ? err.message : String(err)}`);
    }
    const patch = patchOfBounds({ min: loaded.bounds.min.toArray(), max: loaded.bounds.max.toArray() });
    const yaw = opts.yaw ?? 0;
    const at = opts.at ?? (opts.from ? spotAhead(opts.from, yaw, patch) : null);
    if (!at) return refuse('no spot was given to put it on');
    const probes = patchProbes(patch, at, yaw);
    const verdict = groundVerdict(
      probes,
      probes.map((p) => this.terrain.heightAt(p.x, p.z)),
    );
    const clear = clearRadius(patch);
    // A height the caller already has is the one to stand it at, whatever the ground says now; the
    // ground is measured either way, so the numbers come back and a refusal is still a refusal.
    const y = opts.y ?? verdict.y;
    const given = opts.y !== undefined;
    if (!verdict.ok && !opts.force && !given) return { ...verdict, key, x: at.x, z: at.z, yaw, clear, why: verdict.why, building: null };
    // What the world already has standing there. A house put down in a town's street would look
    // exactly like a bug, and the world's own objects are the only thing that knows where a town
    // is: nothing in the archives marks a no-build zone, and the real server's were a table it
    // kept rather than anything the client shipped.
    if (!given && !opts.force) {
      const blocker = blockedBy(patch, at, yaw, stream.objectsNear(at.x, at.z, clear));
      if (blocker) {
        const why = `${blockerName(blocker.template)} is already standing there`;
        return { ...verdict, ok: false, key, x: at.x, z: at.z, yaw, clear, why, building: null };
      }
      // And not in the water. The sea is drawn over the ground rather than instead of it, so the
      // ground test passes perfectly well on a lake bed.
      const wet = probes.find((p) => this.terrain.waterHeightAt(p.x, p.z) > this.terrain.heightAt(p.x, p.z));
      if (wet) return { ...verdict, ok: false, key, x: at.x, z: at.z, yaw, clear, why: 'that is under water', building: null };
    }
    // Every test made and nothing built: what the relay path asks, since there the house goes up
    // when the server answers and a building put into the world here and taken out again a moment
    // later is a model loaded, its programs built and a flicker, all for an answer already known.
    if (opts.tryOnly) return { ok: true, why: verdict.ok ? null : `the ground is not level, but: ${verdict.why}`, key, x: at.x, z: at.z, y, yaw, rise: verdict.rise, sink: verdict.sink, slope: verdict.slope, clear, building: null };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const building = await stream.place({
      model,
      template: key,
      x: at.x,
      y,
      z: at.z,
      q,
      // Its own radius, which is which size tier it joins and so how far off it is drawn. There is
      // no need to force it into the far tier to be sure that tier is loaded: every tier of the
      // region the player is standing in is within its own range of them.
      radius: loaded.radius,
      clear,
    });
    return { ok: true, why: verdict.ok ? null : `stood anyway: ${verdict.why}`, key, x: at.x, z: at.z, y, yaw, rise: verdict.rise, sink: verdict.sink, slope: verdict.slope, clear, building };
  }

  /** Take a building placed in play back out of the world, by what it was filed under. */
  unplaceBuilding(key: string): boolean {
    return this.layoutStream?.unplace(key) ?? false;
  }

  /**
   * Stand a named catalogue mobile at a place and leave it there, as the world's own standing people
   * are stood: spawned rather than roaming, with a world name so the hand-spawn cap and the NPC
   * tab's clear both step over it.
   */
  standMobile(id: string, at: { x: number; z: number; heading?: number }, inside: boolean, worldId: string, essential = false): Mobile | null {
    const entry = this.mobileCatalogue?.byId(id);
    if (!entry) return null;
    const m = this.mobiles?.spawn(entry, at, { origin: 'spawned', inside, worldId, essential });
    return typeof m === 'string' || !m ? null : m;
  }

  /**
   * Why the last spawn was refused, in the manager's own words, or null.
   *
   * `standMobile` answers null for half a dozen quite different reasons -- no catalogue yet, no
   * manager, a model with no file, a full memory budget, a cell with no floor built -- and a caller
   * that means to ask again needs to know which, or an empty spot has no explanation anywhere.
   */
  mobileNote(): string | null {
    if (!this.mobileCatalogue) return 'the creature and NPC catalogue has not loaded yet';
    if (!this.mobiles) return 'this world has no mobiles manager';
    return this.mobiles.lastNote ?? null;
  }

  /** One of those taken away again. */
  unstandMobile(m: Mobile): void {
    this.mobiles?.remove(m);
  }

  /**
   * Stand a plain model somewhere, out of this world's own pack.
   *
   * It is `placeBuilding` with every one of the house rules taken off, and that is the whole of the
   * difference: no ground verdict, nothing asked about what is already standing there, no water
   * test, no flora kept off, no gallery pack behind the world's own. Those exist because a player
   * chooses where a house goes; a thing the game's own data says stands here goes where the data
   * says, and refusing it would be refusing the world.
   *
   * Filed under `key`, which is a name of its own, so a removal is one lookup and can never reach
   * something the snapshot placed.
   */
  async placeProp(model: string, o: { key: string; at: { x: number; y: number; z: number }; yaw: number; inside?: boolean; solid?: boolean }): Promise<boolean> {
    const stream = this.layoutStream;
    if (!stream || !this.pack) return false;
    if (!this.pack.find(model)) return false;
    let loaded: LoadedModel;
    try {
      loaded = await this.pack.model(model);
    } catch (err) {
      console.warn(`prop ${model} would not load`, err);
      return false;
    }
    if (this.layoutStream !== stream) return false;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw);
    await stream.place({ model, template: o.key, x: o.at.x, y: o.at.y, z: o.at.z, q, radius: loaded.radius, inside: o.inside, solid: o.solid });
    return true;
  }

  /**
   * What the world already has standing near a point: each one's place and its own size on the
   * ground. Empty with no world, which reads as "nothing is in the way" and is right: a placement
   * with no world loaded has already been refused for having no world.
   */
  standingNear(x: number, z: number, reach: number): { x: number; z: number; radius: number; template?: string }[] {
    return this.layoutStream?.objectsNear(x, z, reach) ?? [];
  }

  /**
   * The nearest placed object of one of these templates within `reach` metres, or null.
   *
   * Unlike `standingNear` it keeps the objects **inside** buildings, because that is where the
   * things anybody asks about by template stand: the ship terminals the game places in its
   * starports are every one of them contained.
   */
  placedNear(templates: ReadonlySet<string>, at: { x: number; y: number; z: number }, reach: number): PlacedObject | null {
    return this.layoutStream?.nearestPlaced(templates, at, reach) ?? null;
  }

  /** Materials whose shaders have been asked for ahead of their first draw. */
  private readonly compiledMaterials = new WeakSet<THREE.Material>();

  /**
   * New materials join the shadow cascades and the portal stencil scheme, and then have their
   * shaders compiled in the background: a building that streams in would otherwise compile on
   * the first frame it is looked at, a stall of a good fraction of a second.
   */
  private setupShadowMaterials(): void {
    const fresh = this.adoptMaterials(this.scene);
    if (fresh.length) this.compileObjects(fresh);
  }

  /**
   * Everything a material must join before it is drawn: the portal stencil scheme, the normal-map
   * convention and the shadow cascades. Called over the whole scene by the quarter-second scan
   * and over one root by `prepareActor`, so an actor made at run time is ready at once rather
   * than at the next scan. Returns the objects whose materials were new, for the compile queue.
   *
   * The order is fixed and the cascades must come before any compile: `CSM.setupMaterial` sets
   * `defines.USE_CSM` and an `onBeforeCompile`, both part of the program key, so compiling first
   * builds a program that is never drawn. A material flagged `userData.unlit` is kept out of the
   * cascades altogether, for the same reason in reverse.
   */
  /** Public because a baked place's materials are adopted from outside: see sceneWorld.ts. */
  adoptMaterials(root: THREE.Object3D): THREE.Object3D[] {
    const csm = this.csm;
    const fresh: THREE.Object3D[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let isNew = false;
      for (const m of mats) {
        this.portals?.registerMaterial(m, m.userData.interior === true);
        if (!this.compiledMaterials.has(m)) {
          this.compiledMaterials.add(m);
          isNew = true;
          const std = m as THREE.MeshStandardMaterial;
          if (std.normalMap && std.normalScale) std.normalScale.copy(this.normalScale);
          // The only place an animated surface is joined: this material is in the scene now.
          if (m.userData.swgTrack || m.userData.swgScroll) surfaces.adopt(m);
        }
        if (csm && !this.csmMaterials.has(m) && !(m as THREE.ShaderMaterial).isShaderMaterial && m.userData.unlit !== true) {
          csm.setupMaterial(m);
          this.csmMaterials.add(m);
        }
        // The wet-surface wrap, in this same iteration and after the cascades' own hook
        // (CSM.setupMaterial overwrites onBeforeCompile, so nothing may come before it), and so
        // before the program is ever asked for: rain then moves uniforms and compiles nothing.
        // Every material reaches this point; none is wrapped before `csm` exists.
        if (csm && WET_WRAP) wetWrap(m, o);
      }
      if (isNew) fresh.push(o);
    });
    return fresh;
  }

  /**
   * Make an actor ready to be shown without a stall: its materials join the portal stencil and
   * the shadow cascades now rather than at the next quarter-second scan, its textures are
   * uploaded a few a frame, and its programs are compiled for every pass that draws it.
   *
   * Every mesh under `root` is left casting and receiving, and never frustum-culled on its own:
   * a converted actor's meshes sit wherever their GLB put them under the model root, so three's
   * per-mesh sphere is not what anyone wants; the whole actor is culled as one group instead.
   */
  async prepareActor(root: THREE.Object3D): Promise<void> {
    markActor(root);
    this.adoptMaterials(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    await this.uploadTextures([root]);
    await this.compileReady([root]);
  }

  /**
   * Upload every texture the drawables under some roots use, a few per breath: an upload is cheap
   * next to a program compile, so a body with a dozen textures is ready in a few short steps, and
   * a hidden tab (a scripted check) is not held to one chained timer a minute (`breath`).
   */
  private async uploadTextures(roots: THREE.Object3D[]): Promise<void> {
    const r = this.renderer;
    if (!r) return;
    const textures = new Set<THREE.Texture>();
    for (const root of roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!(mesh.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) || !mesh.material) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m as unknown as Record<string, unknown>)) {
            if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
          }
        }
      });
    }
    let n = 0;
    for (const t of textures) {
      r.initTexture(t);
      if (++n % TEXTURES_PER_YIELD === 0) await this.breath();
    }
  }

  /**
   * Make a vehicle ready to be shown without a stall (the garage calls it through `vehiclePrepare` before the vehicle
   * exists): its materials join the portal stencil scheme and the shadow cascades, its textures are uploaded, and its
   * programs are compiled a drawable at a time (the model with its parts and cockpit frame, the engine glows, the
   * trails). Unlike `prepareActor` it leaves `castShadow`, `receiveShadow` and `frustumCulled` as the garage set them
   * (a vehicle's glass casts no shadow, invisible panes stay hidden, the Star Destroyer's parts are culled), and it does
   * not mark a root flagged `userData.worldPass` (a trail, which sets its own layers).
   */
  async prepareVehicle(roots: THREE.Object3D[]): Promise<void> {
    for (const root of roots) {
      if (!root.userData.worldPass) markActor(root);
      this.adoptMaterials(root);
    }
    await this.uploadTextures(roots);
    await this.compileReady(roots);
  }

  /** How a vehicle is prepared before it is shown: `prepareVehicle`, which the game may widen (the motion blur's own variants). Read at call time. */
  vehiclePrepare: (roots: THREE.Object3D[]) => Promise<void> = (roots) => this.prepareVehicle(roots);

  /**
   * Wait for the next drawn frame. A tab in the background gets no animation frames, and its timers
   * are throttled to one a minute after a while; a message to itself is neither, so loading goes on
   * unlooked-at. Unlike `breath` (a yield between compile steps), this waits for a frame when one can come.
   */
  private nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!document.hidden) {
        requestAnimationFrame(() => resolve());
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

  /** A yield between compile steps: a message to itself when the tab is hidden (never throttled), else a zero timer. */
  /** Public because a baked place yields between models as it builds, the same as every other load. */
  breath(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof document === 'undefined' || !document.hidden) {
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

  /**
   * Show a mount's saddle once prepareActor has built it, and say how ready it was: how many of its
   * materials had programs beforehand, and the program count across the first frame drawn with it
   * (two nested animation frames, so at least one whole frame; a hidden tab draws none and logs nothing).
   */
  private revealSaddle(id: string, saddle: THREE.Object3D): void {
    const r = this.renderer;
    let ready = 0;
    let total = 0;
    saddle.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        total++;
        const programs = r && r.properties.has(m) ? (r.properties.get(m) as { programs?: Map<unknown, unknown> }).programs : undefined;
        if ((programs?.size ?? 0) > 0) ready++;
      }
    });
    const before = r?.info.programs?.length ?? 0;
    saddle.visible = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const now = this.renderer?.info.programs?.length ?? 0;
        console.info(`garage: ${id}: the saddle is shown, ${ready}/${total} of its materials built beforehand; programs ${before} -> ${now} over its first frame`);
      }),
    );
  }

  /**
   * A disposed material leaves the portal renderer's set and the cascades' map, both of which
   * are strong: the portal set is walked once per stencil change, about a dozen times a frame,
   * and the cascades' map is a leak that shows as a stutter when the shadow distance moves.
   */
  forgetMaterials(materials: Iterable<THREE.Material>): void {
    for (const m of materials) {
      this.portals?.forget(m);
      this.csm?.shaders.delete(m);
      this.csmMaterials.delete(m);
      this.compiledMaterials.delete(m);
      surfaces.forget(m);
    }
  }

  /**
   * The one queue every deferred compile goes through: what a tier of the world brought in and is
   * being held back until it can be drawn without a stall, and what the quarter-second material
   * scan found that nobody is waiting on. It is drained a job at a time against a budget per frame
   * (`ProgramQueue.pump`, called from `updateShadows`), so a machine with a slow compiler pays a
   * dropped frame rather than a freeze, and flushed outright behind a loading screen or inside a
   * jump's closed tunnel, where the player is waiting on purpose.
   */
  readonly programs = new ProgramQueue();

  /**
   * Whether the player is waiting on purpose just now: a loading screen is up, or a jump's closed
   * tunnel is drawn over the world. The game fills it in (`main.ts` knows about both and this does
   * not); with nothing filled in only a tab drawing no frames counts, which is safe but paces the
   * loading screen as though it were play.
   *
   * This used to be a depth counter raised by `compileAllAsync`, `readyAround` and `settleCarried`,
   * on the reasoning that those three only ever run behind a screen. Two of them do not:
   * `reconcileEffects` calls `compileAllAsync` on the Effects switch **so that the old picture goes
   * on being drawn** while the other variant compiles, and the ultra cruise calls `readyAround` at
   * its stop with frames running and no screen up. For the seconds either took, every rule in this
   * file believed the player was waiting and compiled outright on frames that were being drawn --
   * the one thing the pacing exists to stop. So the question is asked of the game, which knows,
   * rather than guessed from which method happens to be on the stack.
   */
  playerWaiting: () => boolean = () => false;

  /** Whether nothing that is drawn would notice a long frame just now: a screen, a tunnel, or a tab drawing nothing. */
  private get behindScreen(): boolean {
    return this.playerWaiting() || (typeof document !== 'undefined' && document.hidden);
  }

  /** Queue some objects' shaders for the background: a batch of new buildings must not all land in one frame. */
  private compileObjects(objects: THREE.Object3D[]): void {
    this.programs.add(objects, 'the quarter-second material scan');
  }

  /** The renderer walks a root; a stand-in root walks just these, so the rest of the scene is not re-examined. */
  private static rootOf(objects: THREE.Object3D[]): THREE.Object3D {
    const root = new THREE.Object3D();
    root.traverse = (cb: (o: THREE.Object3D) => void) => {
      for (const o of objects) cb(o);
    };
    root.traverseVisible = () => {};
    return root;
  }

  /**
   * Compile with the camera seeing one pass's layers, whatever pass it was last on: the lights a
   * pass sees are baked into the program, so the world pass (the sun and its cascades) and an
   * interior pass (a room's lights) each need their own, and an actor drawn in both needs both.
   */
  private withLayers<T>(camera: THREE.Camera, layer: number, fn: () => T): T {
    const mask = camera.layers.mask;
    camera.layers.set(layer);
    camera.layers.enable(ACTOR_LAYER);
    try {
      return fn();
    } finally {
      camera.layers.mask = mask;
    }
  }

  /** Which passes draw an object: the world's, an interior's, or both for an actor. */
  private static passesOf(o: THREE.Object3D): number[] {
    const interior = o.layers.isEnabled(INTERIOR_LAYER);
    // What first person hides of the player is drawn in every pass once it is shown again: warmed for both.
    const actor = o.layers.isEnabled(ACTOR_LAYER) || isShadowOnly(o.layers.mask);
    const world = o.layers.isEnabled(0);
    if (actor) return [0, INTERIOR_LAYER];
    if (interior && !world) return [INTERIOR_LAYER];
    return [0];
  }

  /**
   * The target frames are drawn into (the effects' scene target, or null for the canvas). A
   * program's key carries the tone mapping and the colour space, and both depend on whether a
   * target is bound, so a warm-up with the wrong one builds the variant that is never drawn and
   * every first draw compiles again on the frame it is needed. The game points this at the
   * effects' target.
   */
  compileTarget: () => THREE.WebGLRenderTarget | null = () => null;

  private withTarget<T>(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, fn: () => T): T {
    const prev = r.getRenderTarget();
    if (prev === target) return fn();
    const face = r.getActiveCubeFace();
    const mip = r.getActiveMipmapLevel();
    r.setRenderTarget(target);
    try {
      return fn();
    } finally {
      r.setRenderTarget(prev, face, mip);
    }
  }

  /**
   * Compile some objects for every pass that draws them, for the target they will be drawn into,
   * and then **finish** every program that made: three stops at `linkProgram`, and a driver that
   * links in the background does not finish until something asks the program a question, which
   * until now was the first frame that drew it. `resolveLinks` asks it here instead. Nothing waits
   * on `KHR_parallel_shader_compile`, which is advertised and broken on the machines this matters
   * for; `async` now means only "let the driver start on the rest of the batch first".
   */
  private compileFor(r: THREE.WebGLRenderer, camera: THREE.Camera, objects: THREE.Object3D[], target: THREE.WebGLRenderTarget | null = this.compileTarget()): void {
    const byPass = new Map<number, THREE.Object3D[]>();
    for (const o of objects) for (const p of World.passesOf(o)) (byPass.get(p) ?? byPass.set(p, []).get(p)!).push(o);
    for (const [layer, list] of byPass) {
      const root = World.rootOf(list);
      this.withLayers(camera, layer, () => this.withTarget(r, target, () => r.compile(root, camera, this.scene)));
    }
    // After every pass, so a material drawn in two has both of its programs finished. This is what
    // makes the call synchronous in the only sense a caller cares about: every program these
    // objects need exists and has been linked by the time this returns. Never `compileAsync`,
    // which waits on `KHR_parallel_shader_compile` -- advertised and broken on the drivers this
    // work exists for, where it answered "not ready" for six programs over four seconds.
    for (const o of objects) this.programs.countLinks(resolveLinks(r, o));
  }

  /**
   * Which pass of an object the queue has already built. An actor is drawn in the world's pass and
   * in a room's, which is two programs, and a frame allowed one must be able to stop between them:
   * so a turn at an object builds one pass, the cursor remembers where it got to, and the queue
   * offers the object again. The map is weak, so an object that goes takes its place in it along.
   */
  private readonly passCursor = new WeakMap<THREE.Object3D, number>();

  /**
   * One turn at making an object ready to be drawn: its programs built, a pass at a time, for the
   * target it will be drawn into, and their links finished. Answers how many programs that cost
   * (which is what the frame's budget is charged) and whether the object is finished. `allowance`
   * is how many more programs this frame may build; a turn stops as soon as it has spent it, and
   * the first pass of a turn always runs, or a frame with nothing left could never make progress.
   * This is the one place a program is built outside the loading screen's own batches.
   */
  private compileOne(o: THREE.Object3D, allowance = Number.POSITIVE_INFINITY): { made: number; done: boolean } {
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) return { made: 0, done: true };
    const passes = World.passesOf(o);
    let at = this.passCursor.get(o) ?? 0;
    if (at >= passes.length) {
      this.passCursor.delete(o);
      return { made: 0, done: true };
    }
    const before = r.info.programs?.length ?? 0;
    // The target is read per object, so a switch part way through a queue compiles the rest for the
    // path the game will really draw.
    const target = this.compileTarget();
    let made = 0;
    while (at < passes.length) {
      const layer = passes[at];
      const root = World.rootOf([o]);
      const was = r.info.programs?.length ?? 0;
      this.withLayers(camera, layer, () => this.withTarget(r, target, () => r.compile(root, camera, this.scene)));
      made += (r.info.programs?.length ?? 0) - was;
      at++;
      if (made >= allowance) break;
    }
    const done = at >= passes.length;
    if (done) this.passCursor.delete(o);
    else this.passCursor.set(o, at);
    // Asked after every pass this turn built, so a material drawn in two has both links finished
    // by the time the object is done with.
    this.programs.countLinks(resolveLinks(r, o));
    return { made: (r.info.programs?.length ?? 0) - before, done };
  }

  /** Every pass of one object, in one go: behind a loading screen, where nothing is being looked at. */
  private compileWhole(o: THREE.Object3D): number {
    let made = 0;
    for (;;) {
      const step = this.compileOne(o);
      made += step.made;
      if (step.done) return made;
    }
  }

  /**
   * Compile some objects' shaders for every pass that draws them, one drawable at a time with a
   * breath between, and resolve when they are ready to draw (a fighter dressed at run time, a
   * vehicle with its glows and trails). Making a program is work on the main thread even when its
   * linking is left to the driver: a whole outfit at once was a four-second frame, a mesh at a
   * time a few short ones. Every drawable with a material counts (meshes, sprites, points,
   * lines), as `compileAllAsync` walks them.
   */
  async compileReady(objects: THREE.Object3D[]): Promise<void> {
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) return;
    const meshes: THREE.Object3D[] = [];
    for (const o of objects) {
      o.traverse((m) => {
        if (((m as THREE.Mesh).isMesh || (m as THREE.Sprite).isSprite || (m as THREE.Points).isPoints || (m as THREE.Line).isLine) && (m as THREE.Mesh).material) meshes.push(m);
      });
    }
    if (!meshes.length) return;
    // Something being made ready to be shown is urgent: a peer walking up, a weapon taken up, a
    // ship spawned. It goes ahead of the scenery filling in, which is the one producer that pushes
    // without stopping.
    await this.queueOrBuild(meshes, 'something being made ready to be shown', true);
  }

  /**
   * What the placed-object streamer waits on before it shows a tier: the same rule as
   * `compileReady`, said in the streamer's own words so an overrunning frame names it. The objects
   * handed over are drawables already, so nothing is traversed.
   *
   * Their materials are adopted first, and that order is not a detail. `CSM.setupMaterial` writes
   * `USE_CSM`, `CSM_CASCADES` and `CSM_FADE` into a material's defines and hangs an
   * `onBeforeCompile` on it, and the wet wrap rewrites `customProgramCacheKey`; all of that is in
   * three's program key. Compiled first and adopted afterwards, every streamed material would cost
   * two programs -- the first one never drawn -- and would be drawn unshadowed by the sun and dry
   * in the rain until the second arrived. The quarter-second scan used to be the only thing that
   * adopted these, and the queue drains every frame, so the scan lost that race fourteen times in
   * fifteen.
   */
  private async prepareStreamed(objects: THREE.Object3D[]): Promise<void> {
    if (!objects.length) return;
    for (const o of objects) this.adoptMaterials(o);
    await this.queueOrBuild(objects, 'the placed-object streamer', false);
  }

  /**
   * Make some objects ready to be drawn and answer when they are, either through the paced queue
   * or outright.
   *
   * Outright when nothing that is drawn would notice: behind a loading screen, in a jump's closed
   * tunnel, in a tab drawing no frames, or with the pacing switched off. Outright too when no
   * frame has looked at the queue for a while, because only a frame empties it -- the promise from
   * `push` is answered by `pump`, `flush` or `clear` and by nothing else, so a caller that waits
   * on it while no frame loop is running waits for ever. That is not a hypothetical: a character
   * whose saved world is a space zone is put back in a ship inside `play()`, which is before the
   * frame loop's own gate is opened, and this is the call it hangs on.
   */
  private async queueOrBuild(objects: THREE.Object3D[], label: string, urgent: boolean): Promise<void> {
    if (!objects.length) return;
    if (!SHADER_PACING || this.behindScreen || this.programs.idle(performance.now())) {
      for (const o of objects) {
        this.compileWhole(o);
        await this.breath();
      }
      return;
    }
    // On the queue, a program a frame, answered when the last of it is built: a dressed fighter or
    // a spawned ship stays hidden for a few more frames rather than stopping one dead. `compileOne`
    // finishes each program's link, so the frame that first draws it pays nothing.
    const wait = this.programs.push(objects, label, urgent);
    let settled = false;
    void wait.then(() => {
      settled = true;
    });
    while (!settled) {
      // The frame loop stopping under a wait is the same case as there never having been one, and
      // it must be answered the same way rather than left hanging.
      if (this.programs.idle(performance.now())) {
        await this.flushQueue();
        break;
      }
      await new Promise<void>((r) => setTimeout(r, PACE_TUNE.pollMs));
    }
    await wait;
  }

  /** The flush in flight, if any: a second caller joins it rather than starting another. */
  private flushing: Promise<void> | null = null;

  /**
   * Everything on the queue, now, with a breath between objects. One flush at a time: two running
   * together would each take the head job while the other still held it, and a job would be
   * stepped over. A second caller joins the first, which takes work pushed while it runs anyway.
   */
  private flushQueue(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.programs
        .flush((o, allowance) => this.compileOne(o, allowance), () => this.breath())
        .finally(() => {
          this.flushing = null;
        });
    }
    return this.flushing;
  }

  /**
   * One frame's worth of the queue, called once a frame from `updateShadows`. In play the budget is
   * one program (`SHADER_TUNE.playBudget`, package C's number) and a few milliseconds; behind a
   * loading screen it is the screen's. A frame that goes over says so once, and names where the
   * work came from, because the count on its own has never been enough to find the cause.
   */
  private drainCompiles(): void {
    // Before anything else, and whether or not there is work: what "a frame is running" means to
    // anyone waiting on the queue is that this was called, and a queue that happens to be empty
    // must not read as a frame loop that has stopped.
    this.programs.tick(performance.now());
    if (!this.programs.pending) return;
    if (!this.renderer || !this.camera) {
      this.programs.clear();
      return;
    }
    // With the pacing off the queue is still where the quarter-second scan's finds go; they are
    // taken at the loading screen's allowance instead of one a frame, which is as near as this can
    // come to not pacing at all.
    const out = this.programs.pump(this.behindScreen || !SHADER_PACING, (o, allowance) => this.compileOne(o, allowance), () => performance.now());
    if (out.over) console.info(this.programs.line());
  }

  /**
   * What the program queue is doing: the console's one shader hook reads it.
   *
   * `budget` and `hard` are not this file's opinions: both come from the machine the game measured
   * once behind its first loading screen, so the pacing is decided in one place by one measurement
   * rather than by each part of this guessing at what a program costs.
   */
  shaderPace(): { pacing: boolean; pending: number; waiting: number; built: number; linked: number; worstFrame: number; overranFrames: number; blame: string; budget: number; hard: boolean; framesLeft: number; behindScreen: boolean; frames: number; idle: boolean } {
    const budget = shaderBudget(this.behindScreen);
    return {
      // False with `swg.shaderPace` = '0' in local storage: everything below still counts, but
      // nothing is held back and the budget is the loading screen's whatever the frame is.
      pacing: SHADER_PACING,
      pending: this.programs.pending,
      waiting: this.programs.waiting,
      built: this.programs.built,
      linked: this.programs.linked,
      worstFrame: this.programs.worstFrame,
      overranFrames: this.programs.overranFrames,
      blame: this.programs.blame,
      budget,
      // True where the machine measured slow enough that a careless frame is a visible freeze: the
      // one thing the probe decides besides the number above.
      hard: pacingHard(),
      framesLeft: framesFor(this.programs.pending, budget),
      behindScreen: this.behindScreen,
      // How many frames have looked at the queue, and whether one has lately: `idle` true in play
      // means the frame loop has stopped and every wait is being answered outright instead.
      frames: this.programs.ticks,
      idle: this.programs.idle(performance.now()),
    };
  }

  /**
   * Compile every material in the scene, seen or not, in batches with a frame between them so
   * a loading screen can show the count going up; the stall is spent behind the screen rather
   * than on the first shot or the first look at a building. Returns how many programs were made.
   */
  async compileAllAsync(
    onProgress: (done: number, total: number) => void = () => {},
    /**
     * There used to be a `waitReady` here, asking for the programs to be ready and not merely
     * created before this returns. It is gone because it is now always true and cannot be asked
     * for: `compileFor` finishes every program's link itself (`resolveLinks`), which is what the
     * one caller that passed it wanted and is stronger than the parallel-compile extension's word.
     * Anyone who changes `compileFor` to stop finishing links is changing that promise for
     * everybody, which is the right place for it to be noticed.
     */
    opts: { target?: THREE.WebGLRenderTarget | null; keepQueue?: boolean } = {},
  ): Promise<number> {
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) return 0;
    // Nothing is raised here. This sweep is not proof that the player is waiting: the Effects
    // switch calls it in play on purpose, so that the old picture goes on being drawn while the
    // other variant compiles. Whether the player is waiting is `playerWaiting`, which the game
    // fills in, and the sweep's own compiles do not go through the paced queue in any case.
    return this.compileEverything(r, camera, onProgress, opts);
  }

  private async compileEverything(
    r: THREE.WebGLRenderer,
    camera: THREE.Camera,
    onProgress: (done: number, total: number) => void,
    opts: { target?: THREE.WebGLRenderTarget | null; keepQueue?: boolean },
  ): Promise<number> {
    this.setupShadowMaterials();
    // Switching the effects compiles for the other path while the frames still draw the old one,
    // so the queue it would otherwise be feeding is left alone.
    const target = opts.target !== undefined ? opts.target : this.compileTarget();
    // Only the work nobody is waiting on is dropped: this sweep is about to compile every material
    // in the scene, so the scan's list is redundant, while a tier still waiting to be shown must
    // keep its promise -- it will cost nothing when it runs, its materials being built here.
    if (!opts.keepQueue) this.programs.clearLoose();
    const objects: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) && m.material) objects.push(o);
    });
    const before = r.info.programs?.length ?? 0;
    const BATCH = 8;
    for (let i = 0; i < objects.length; i += BATCH) {
      // `compileFor` builds each batch's programs and finishes their links before it returns, so
      // every program this sweep makes is ready to draw with by the time it ends, and no chained
      // poll is left running behind the loading screen.
      this.compileFor(r, camera, objects.slice(i, i + BATCH), target);
      onProgress(Math.min(objects.length, i + BATCH), objects.length);
      await this.nextFrame();
    }
    // The weather's falling effects draw in their own scene, with no lights and no fog: compiled
    // against that scene (never this one, whose lights and fog are in the program key), for the
    // same target, so the first rain compiles nothing. Its links are finished here too.
    this.withTarget(r, target, () => this.weather.compile(r, camera, false));
    this.programs.countLinks(resolveLinks(r, this.weather.scene));
    return (r.info.programs?.length ?? 0) - before;
  }

  /** Call once per frame after the camera has moved. */
  updateShadows(now: number): void {
    const csm = this.csm;
    if (csm) {
      csm.lightDirection.copy(this.day.lightDir).negate().normalize();
      csm.update();
    }
    if (now - this.csmScanAt > 250) {
      this.csmScanAt = now;
      this.setupShadowMaterials();
    }
    this.drainCompiles();
  }

  /** Generate every chunk in view immediately (used when arriving on a planet). */
  warmUp(center: THREE.Vector3): void {
    this.exclusions = [{ x: center.x, z: center.z, r: 14 }];
    // The environment filter's own programs, built here with everything else's rather than in the
    // loader callback that brings the first cube in, which lands after the screen has lifted.
    if (this.renderer) this.pmrem ??= this.makePmrem(this.renderer);
    // The sound of the place, as early as it can be had: on an arrival this runs before the pack is
    // in, so it usually only hands the weather its channel sink and the first frames of `update` do
    // the rest, still behind the loading screen.
    this.readySound();
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    // Nothing stands on its own any more. The planet's own wildlife used to be stood here -- through
    // the catalogue (its own model, clips and brain) when it had landed and had the species, else the
    // old creatures -- and it is now behind one switch, off unless this browser's storage says
    // otherwise (`localStorage['swg.wildlife'] = '1'`, WILDLIFE_KEY in src/world/spawnSeed.ts). What
    // is alive in a world is what somebody stood there, and what an admin stands belongs to the
    // world. The switch is read once, here, and short-circuits before the catalogue is even asked, so
    // an arrival with it off does exactly as much work as it did before and no more.
    if (wildlifeWanted() && !this.ambientFromCatalogue(center)) this.creatures.spawnAround(center);
    // The people the server stood here, before the screen lifts rather than after: every one within
    // range is stood in one forced pass, so their models are loaded and their programs compiled by
    // the warm-up that follows instead of a few at a time on live frames as the player walks in.
    // The cap is the same forty; what the force changes is only the three-a-pass trickle.
    standingPeople.step(0, this.simTime, new THREE.Vector3(center.x, this.terrain.heightAt(center.x, center.z), center.z), this.peopleDeps(), true);
    markActor(this.creatures.group);
    // Turrets are spawned from the NPC tab (B) now, not stood around the arrival point.
    markActor(this.turrets.group);
    // The developer's own two dozen crates and balls in rings round the arrival point, and the
    // placeholder bike beside them. Both were there to have something to shove about and something
    // to ride before this game had a garage or a world with anything in it, and both are now
    // furniture in a game that has its own -- so they are behind one switch, off unless this
    // browser's storage says otherwise (`localStorage['swg.scratch'] = '1'`, SCRATCH_KEY in
    // src/world/spawnSeed.ts), exactly as the wildlife is. Read once, here, so an arrival with it
    // off does no work at all for either.
    if (!scratchWanted()) return;
    // Here rather than in `loadPack`, because here the ground round the arrival has already been
    // generated (the `stream` above) and the loading screen's own compile still follows, so their
    // programs are built behind it. Neither is stood in space: there is no ground for them, and the
    // player arrives in a ship.
    loadLooseProps(this, center, (x, z) => this.terrain.heightAt(x, z), !!this.planet.space);
    if (this.planet.space) return;
    const sx = center.x + 5;
    const sz = center.z + 4;
    const speeder = createPlaceholderSpeeder(this.physics, this.scene, sx, this.terrain.heightAt(sx, sz) + 1.2, sz, Math.PI * 0.75);
    markActor(speeder.group);
    this.vehicles.push(speeder);
  }

  /**
   * The planet's species stood as the catalogue's mobiles, `count` of them about the arrival point,
   * with the planet's own health, blow and temper. Never waits: the catalogue is read only if it has
   * already landed (this runs at arrival, in a frame), and the spot is the terrain's own height,
   * which needs no stepped physics. False when anything is missing, leaving it to the old path.
   */
  private ambientFromCatalogue(center: THREE.Vector3): boolean {
    const def = this.planet.creatures;
    if (!def.count || this.planet.space || !this.mobiles) return false;
    const cat = MobileCatalogue.loaded(import.meta.env.BASE_URL);
    const entry = cat?.resolve(def.name);
    if (!cat || !entry || !cat.ready(entry).ok) return false;
    const n = this.mobiles.spawnAmbient(entry, def.count, center, ambientOverrides(def));
    if (n) console.info(`creatures: ${def.name} stood from the catalogue (${entry.id}), ${n} about`);
    return n > 0;
  }

  /** Each ship followed through a building's rooms: where it was last sampled, its room, and the wait until the next sample. */
  private readonly vehicleRooms = new WeakMap<Vehicle, { cell: CellState | null; from: THREE.Vector3; due: number }>();

  /**
   * Follow a ship through a building's portals, as a mobile is followed: four times a second, and sooner
   * once it has gone a couple of metres, from the hull's middle. While it is in a room its hull ignores the
   * terrain and the building's shells and its floor is the room's own (`Vehicle.setInRoom`); rooms are
   * bigger than the hull around them, so this is never read from the rooms' boxes. Nothing is allocated
   * per call once the ship has been seen once.
   */
  trackVehicleRoom(v: Vehicle, dt: number): void {
    if (!v.spec.ship || v.disposed) return;
    const stream = this.layoutStream;
    if (!stream || this.planet.space) {
      if (v.inRoom) v.setInRoom(false);
      return;
    }
    const b = v.spec.bounds;
    const mid = tmpV.set(0, (b.min[1] + b.max[1]) / 2, 0).applyQuaternion(v.quaternion(tmpQ)).add(v.pos);
    let held = this.vehicleRooms.get(v);
    if (!held) {
      held = { cell: stream.buildingAt(mid), from: mid.clone(), due: 0 };
      this.vehicleRooms.set(v, held);
      v.setInRoom(held.cell !== null);
      return;
    }
    held.due -= dt;
    if (held.due > 0 && held.from.distanceToSquared(mid) < SHIP_ROOM.step * SHIP_ROOM.step) return;
    held.due = SHIP_ROOM.every;
    // The step between samples is at most the distance that triggered it, plus what a frame at speed adds.
    held.cell = stream.trackVehicleCell(held.cell, held.from, mid, SHIP_ROOM.step * 3);
    held.from.copy(mid);
    v.setInRoom(held.cell !== null);
  }

  /** Stand a vehicle from the garage on the ground in front of a point, facing away from it. */
  async spawnVehicle(def: VehicleDef, at: THREE.Vector3, heading: number, kind?: VehicleKind, airborne = false, fit: ResolvedFit | null = null): Promise<Vehicle> {
    // The world it was asked for: `unload` moves the generation on (and `load` makes a new Terrain for every
    // planet or zone), so a travel during the model loads, the preparation or the paint is seen before the
    // vehicle is made, and nothing is left in the next world.
    const gen = this.loadGeneration;
    const terrain = this.terrain;
    this.garage ??= await Garage.load(import.meta.env.BASE_URL);
    // In space, or arriving in the air, the vehicle stands exactly where it is asked to.
    const space = !!this.planet.space;
    // Standing in a building's room: a ship flown from a cockpit is stood on that room's floor, turned
    // along it. A ship with rooms of its own is stood outside for now, since boarding one inside a
    // building would put two sets of rooms in play at once.
    const shipKind = kind === 'ship' || (!kind && def.source === 'ship');
    const ownRooms = !!def.interior || (def.cells ?? []).some((c) => c.index > 0);
    const room = !space && !airborne && shipKind && this.cellState ? this.cellState : null;
    if (room && ownRooms) console.info(`garage: ${def.id} has rooms of its own, so it is stood outside the building's rooms for now`);
    const inRoom = room && !ownRooms ? room : null;
    // The way a ship stood in a room faces is that room's own axis, but only once it is known that the
    // ship fits in it: its box is not known until the model is loaded, so the turn is taken then and
    // made after the spawn. A ship stood outside keeps the heading it was asked for.
    let placedInRoom = false;
    let roomTurn: number | null = null;
    const place = airborne || space
      ? (b: VehicleSpec['bounds']) => [at.x, at.y + b.min[1], at.z] as [number, number, number]
      : (b: VehicleSpec['bounds']) => {
          const turn = inRoom ? this.roomHeading(inRoom, heading) : heading;
          const spot = inRoom ? this.roomSpot(inRoom, b, at, turn) : null;
          if (spot) {
            placedInRoom = true;
            roomTurn = turn;
            return spot;
          }
          if (inRoom) console.info(`garage: ${def.id} does not fit in this room with room to spare: it is stood on the ground instead`);
          return this.clearGround(b, at, heading, def.source === 'creature');
        };
    let v: Vehicle;
    try {
      v = await this.garage.spawn(def, this.physics, this.scene, at.x, at.y, at.z, heading, kind, place, {
        fit,
        prepare: (r) => this.vehiclePrepare(r),
        forget: (m) => this.forgetMaterials(m),
        alive: () => gen === this.loadGeneration && this.terrain === terrain,
      });
    } catch (err) {
      if (err instanceof SpawnCancelled) throw new Error('the world changed while the vehicle was being prepared');
      throw err;
    }
    v.space = space;
    // Stood in a room: its filter and its floor are the room's from the start, and the tracker begins there.
    if (placedInRoom && inRoom) {
      if (roomTurn !== null) v.faceHeading(roomTurn);
      v.setInRoom(true);
      this.vehicleRooms.set(v, { cell: inRoom, from: v.pos.clone(), due: SHIP_ROOM.every });
      console.info(`garage: ${def.id} stood on the floor of room ${inRoom.cell} of ${inRoom.building.model.def.id}`);
    }
    markActor(v.group);
    // A mount's saddle is shown once its programs exist: prepareActor joins it to the portal scheme and
    // the cascades before any compile, uploads its textures and builds its programs a mesh at a time.
    // Nothing else is needed: a static, unskinned, unmorphed mesh's motion-blur variant is one of the
    // warm ones compiled at startup (velocityMath.ts WARM_VARIANTS), so npcDeps.compile is not called.
    if (v.saddle) {
      const saddle = v.saddle;
      const id = v.spec.id;
      saddle.visible = false;
      void this.prepareActor(saddle).catch((err) => console.warn(`garage: ${id}: its saddle's warm-up failed; shown anyway`, err)).finally(() => this.revealSaddle(id, saddle));
    }
    this.vehicles.push(v);
    // A player's ship fights too: its combat from its fit (neutral until someone flies it; sync marks the player's).
    if (v.spec.ship) this.ships.adopt(v, { faction: 'neutral' });
    // The ship's bolt and hit effects, every one its guns fire, played once far below the world.
    this.warmShipFx(v);
    const gravity = -this.physics.world.gravity.y;
    if (def.interior) {
      try {
        v.interior = await ShipInterior.load(v, `${import.meta.env.BASE_URL}${def.interior.file}`, def.interior.def, gravity, { prepare: (roots) => this.vehiclePrepare(roots) });
      } catch (err) {
        console.warn(`${def.id}: its interior did not load`, err);
      }
    }
    // A hull that is itself a portal building (the yacht) has its rooms inside the hull model.
    if (!v.interior) v.interior = ShipInterior.fromHull(v, gravity, { cells: def.cells, portals: def.portals });
    return v;
  }

  /**
   * An NPC ship's hull: built through the garage with its fit and prepared as a player's ship is (`vehiclePrepare`,
   * the motion blur's variants included), stood exactly at `at` facing `heading`, then at once, with nothing awaited
   * in between (so no frame sees it), marked, hidden, held, weightless and ghosted (`setGhost`: its colliders in no
   * group until the manager shows it). It is NOT put in `vehicles`: the NPC ship manager puts
   * it there once its contact, combat and brain exist. A world left while it was being prepared throws
   * (SpawnCancelled) before the vehicle is made, so nothing is left in the next world.
   */
  async spawnHull(def: VehicleDef, fit: ResolvedFit | null, at: THREE.Vector3, heading: number): Promise<Vehicle> {
    const gen = this.loadGeneration;
    const terrain = this.terrain;
    const g = (this.garage ??= await Garage.load(import.meta.env.BASE_URL));
    if (gen !== this.loadGeneration || this.terrain !== terrain) throw new SpawnCancelled(def.id);
    const v = await g.spawn(def, this.physics, this.scene, at.x, at.y, at.z, heading, 'ship', (b) => [at.x, at.y + b.min[1], at.z], {
      fit,
      prepare: (roots) => this.vehiclePrepare(roots),
      forget: (m) => this.forgetMaterials(m),
      alive: () => gen === this.loadGeneration && this.terrain === terrain,
    });
    v.space = !!this.planet.space;
    markActor(v.group);
    v.group.visible = false;
    for (const t of v.trails) t.mesh.visible = false;
    v.held = true;
    // Not in the list, nothing steps it: until it is shown its body must neither fall nor be met (its colliders
    // in no group, as a jump's hull), or it drops through the frames its extras take to compile.
    v.body.setGravityScale(0, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.setGhost(true);
    // Its bolt and hit effects, as a player's ship's: a session with no ship spawned yet has warmed none of them.
    this.warmShipFx(v);
    return v;
  }

  /**
   * What a vehicle makes after it exists (an NPC ship's clear glass stand-ins; its glows and trails were compiled
   * with the hull and cost a key lookup): the materials join the portal stencil and the cascades before any compile,
   * then the programs are built a drawable at a time. No shadow flag is changed (a trail must not cast), unlike
   * `prepareActor`.
   */
  async prepareExtras(objects: THREE.Object3D[]): Promise<void> {
    for (const o of objects) this.adoptMaterials(o);
    await this.compileReady(objects);
  }

  /** The portal renderer's material set and the shadow cascades' shader records, by size: a ship that leaks its materials shows as growth. Read-only. */
  materialCounts(): { portal: number; cascades: number } {
    return { portal: this.portals?.materials.size ?? 0, cascades: this.csm?.shaders.size ?? 0 };
  }

  /** Stand a ready-made model as a vehicle on clear ground ahead of a point (the garage's placement, for a model that is not in it). */
  addVehicle(spec: VehicleSpec, model: THREE.Object3D, at: THREE.Vector3, heading: number): Vehicle {
    const [x, y, z] = this.clearGround(spec.bounds, at, heading);
    const v = new Vehicle(spec, model, this.physics, this.scene, x, y - spec.bounds.min[1] + spec.hover, z, heading);
    markActor(v.group);
    this.vehicles.push(v);
    return v;
  }

  /**
   * Ground ahead of a point that a box of these bounds can stand on: ahead by the box's half
   * length plus a gap, and further on while anything else stands there, since a box spawned
   * inside an exhibit, a house or another vehicle is thrown out of it by the physics.
   */
  private clearGround(b: VehicleSpec['bounds'], at: THREE.Vector3, heading: number, animal = false): [number, number, number] {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const l = b.max[2] - b.min[2];
    // On the water rather than under it: a machine floats on the surface, an animal swims chest-deep.
    const floorAt = (x: number, z: number) => Math.max(this.terrain.heightAt(x, z), this.terrain.waterHeightAt(x, z) - (animal ? h * 0.55 : 0));
    const shape = new R.Cuboid(w / 2 + 0.3, h / 2, l / 2 + 0.3);
    const rot = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    const first = l / 2 + 3;
    // Not far: past 24 m the spot is out of sight, so the vehicle lands at the first spot anyway.
    for (let d = first; d <= first + 24; d += 2) {
      const x = at.x + Math.sin(heading) * d;
      const z = at.z + Math.cos(heading) * d;
      const y = floorAt(x, z);
      // A vehicle spawned this same frame is not in the physics queries yet, so those are checked by distance.
      let blocked = this.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < v.radius + Math.max(w, l) / 2 + 0.5);
      if (!blocked) {
        // With a group: a query that passes none is not group-tested at all, and would find the
        // things that are meant to be found only by what is aimed at them -- another player's body,
        // and the box round the hull they ride.
        this.physics.world.intersectionsWithShape({ x, y: y - b.min[1] + h / 2 + 0.5, z }, rot, shape, () => {
          blocked = true;
          return false;
        }, undefined, groups(Group.all, Group.all));
      }
      if (!blocked) return [x, y, z];
    }
    return [at.x + Math.sin(heading) * first, floorAt(at.x, at.z), at.z + Math.cos(heading) * first];
  }

  /** The cell of a room state, or null when the building no longer has it. */
  private cellOf(state: CellState): { index: number; bounds: { min: number[]; max: number[] } } | null {
    return (state.building.model.def.cells ?? []).find((c) => c.index === state.cell) ?? null;
  }

  /**
   * The way a ship stood in a room faces: along the room's longer floor axis, whichever way of the two
   * the player is looking. A hangar is a long room with its door at one end, so this points a ship out of it.
   */
  private roomHeading(state: CellState, heading: number): number {
    const cell = this.cellOf(state);
    if (!cell) return heading;
    const [x0, , z0] = cell.bounds.min;
    const [x1, , z1] = cell.bounds.max;
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    // The room's axis in the world (the building is turned, so the axis is turned with it).
    tmpV.set(alongX ? 1 : 0, 0, alongX ? 0 : 1).transformDirection(state.building.matrix);
    if (tmpV.lengthSq() < 1e-6) return heading;
    const forward = tmpV.x * Math.sin(heading) + tmpV.z * Math.cos(heading);
    if (forward < 0) tmpV.multiplyScalar(-1);
    return Math.atan2(tmpV.x, tmpV.z);
  }

  /**
   * A spot on a room's floor for a ship to stand: ahead of the player by the ship's own length, kept
   * inside the room's box with `SHIP_ROOM.spare` all round, on the floor they are standing on. Null
   * when the room does not hold the ship's box with that much to spare, so the caller stands it outside.
   */
  private roomSpot(state: CellState, b: VehicleSpec['bounds'], at: THREE.Vector3, heading: number): [number, number, number] | null {
    const cell = this.cellOf(state);
    if (!cell) return null;
    const x0 = Math.min(cell.bounds.min[0], cell.bounds.max[0]);
    const x1 = Math.max(cell.bounds.min[0], cell.bounds.max[0]);
    const y0 = Math.min(cell.bounds.min[1], cell.bounds.max[1]);
    const y1 = Math.max(cell.bounds.min[1], cell.bounds.max[1]);
    const z0 = Math.min(cell.bounds.min[2], cell.bounds.max[2]);
    const z1 = Math.max(cell.bounds.min[2], cell.bounds.max[2]);
    // The box's own extents, however the corners are stored (a pack converted before the BOX fix swaps them).
    const w = Math.abs(b.max[0] - b.min[0]);
    const h = Math.abs(b.max[1] - b.min[1]);
    const l = Math.abs(b.max[2] - b.min[2]);
    // The ship may be turned any way in the room, so its footprint is taken as its longer side both ways.
    const across = Math.max(w, l);
    if (x1 - x0 < across + SHIP_ROOM.spare * 2 || z1 - z0 < across + SHIP_ROOM.spare * 2 || y1 - y0 < h + SHIP_ROOM.spare) return null;
    // Ahead of the player by half the ship's length and a stride more (3 m, invented), so it is stood
    // clear of where they are standing however long it is.
    const ahead = l / 2 + 3;
    tmpV.set(at.x + Math.sin(heading) * ahead, at.y, at.z + Math.cos(heading) * ahead).applyMatrix4(state.building.inverse);
    tmpV.x = THREE.MathUtils.clamp(tmpV.x, x0 + across / 2 + SHIP_ROOM.spare, x1 - across / 2 - SHIP_ROOM.spare);
    tmpV.z = THREE.MathUtils.clamp(tmpV.z, z0 + across / 2 + SHIP_ROOM.spare, z1 - across / 2 - SHIP_ROOM.spare);
    // The player's own level, kept inside the room: the spot was taken from their feet, so this is
    // still their height, not the middle of a box that may run through several decks.
    tmpV.y = THREE.MathUtils.clamp(tmpV.y, y0, y1);
    tmpV.applyMatrix4(state.building.matrix);
    // The floor they are standing on, under that spot: the highest of the room's own surfaces at or
    // just over their feet (a step's worth, 0.5 m, invented), never the terrain under the building and
    // never a deck further down, which a room whose box runs through several of them would give.
    // `floorsAt` answers highest first, so the first of them is the one wanted.
    const floors = this.physics.floorsAt(tmpV.x, tmpV.z, tmpV.y + 0.5, tmpV.y - Math.abs(y1 - y0) - 0.5);
    const y = floors.length ? floors[0] : tmpV.y;
    return [tmpV.x, y, tmpV.z];
  }

  /**
   * Warm a ship's bolt and hit effects: every distinct projectile its guns fire (a fitted ship's guns may fire
   * several) and its own weapon's, each played once far below the world, so the first shot finds their shaders
   * compiled rather than stalling the frame. An effect already warmed is not played again.
   */
  warmShipFx(v: Vehicle): void {
    if (!this.garage) return;
    const projectiles = new Set<number>();
    for (const g of v.guns) if (g.weapon) projectiles.add(g.weapon.projectile);
    if (v.weapon) projectiles.add(v.weapon.projectile);
    for (const index of projectiles) {
      const p = this.garage.projectileFor(index);
      if (!p) continue;
      for (const file of [p.effect, p.hit]) {
        if (!file || this.warmedFx.has(file)) continue;
        this.warmedFx.add(file);
        const h = this.shipFx.place(file, tmpM.makeTranslation(v.pos.x, -900, v.pos.z), false, true);
        window.setTimeout(() => this.shipFx.remove(h), 4000);
      }
    }
  }

  /**
   * Take a vehicle out of the world: its body, its model, its trails and its paint's own copies (out of the material
   * sets, through the paint's `forget`), and the materials made for it alone (`ownedMaterials`: its glow sprite's,
   * each trail's, each clear pane's) forgotten by the portal renderer and the cascades, then disposed. Every way a
   * vehicle goes comes here. A hull still being prepared (an NPC ship, not yet in the list) is disposed all the same.
   */
  disposeVehicle(v: Vehicle): void {
    // Once: a second removal of its body would be a use after free (a destroyed NPC ship the manager also clears).
    if (!v.disposed) {
      v.dispose(this.physics, this.scene);
      this.forgetMaterials(v.ownedMaterials);
      // A trail's material is disposed twice (with its trail too): harmless.
      for (const m of v.ownedMaterials) m.dispose();
      v.ownedMaterials.length = 0;
    }
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  /** The refit of each vehicle under way, so the next waits for it (inTurn). */
  private readonly refits = new WeakMap<Vehicle, Promise<unknown>>();

  /**
   * Refit a spawned ship in place (Garage.refit, its new parts prepared as a vehicle is), then warm the bolts its
   * guns now fire. One vehicle's refits run one after another, each checked and started from the fit the last
   * one left (`Garage.refit` reads `v.fit` when its turn comes): two staged from the same fit would leave the
   * model showing one part while `v.fit` names another. A fit the ship already wears changes nothing.
   */
  refitVehicle(v: Vehicle, next: ResolvedFit): Promise<RefitReport> {
    return inTurn(this.refits, v, async () => {
      if (!this.garage) throw new Error('garage: not loaded');
      if (!this.vehicles.includes(v)) throw new Error(`garage: ${v.spec.id} is not in the world`);
      if (v.fit && fitKey(v.fit) === fitKey(next)) return { slots: [], parts: 0, waiting: [], repainted: false, weaponsChanged: false, ms: 0 };
      let report: RefitReport;
      try {
        report = await this.garage.refit(v, next, (r) => this.vehiclePrepare(r));
      } finally {
        // The ship went while its parts were staged: the spare trails' materials were put on its list after
        // disposeVehicle had emptied it, and were adopted by the preparation, so they leave the sets here.
        if (v.disposed && v.ownedMaterials.length) {
          this.forgetMaterials(v.ownedMaterials);
          for (const m of v.ownedMaterials) m.dispose();
          v.ownedMaterials.length = 0;
        }
      }
      if (report.weaponsChanged && this.vehicles.includes(v)) this.warmShipFx(v);
      // Its combat's stats from the new fit (the condition keeps its shares).
      if (this.vehicles.includes(v)) this.ships.refit(v);
      return report;
    });
  }

  /**
   * Keep the shadow cascades' records of some materials across a compile in another WebGL context (the ship
   * edit page's preview). CSM keeps one shader record per material, the last compiled in any context, and
   * moves the cascades' uniforms in that one only, so a second renderer compiling a material the world set
   * up would take them from the world's program. Returns the function that puts the records back.
   */
  keepShadowRecords(materials: THREE.Material[]): () => void {
    const csm = this.csm;
    if (!csm) return () => {};
    const kept: [THREE.Material, string][] = [];
    for (const m of materials) if (csm.shaders.has(m)) kept.push([m, csm.shaders.get(m) as string]);
    return () => {
      for (const [m, s] of kept) if (csm.shaders.has(m)) csm.shaders.set(m, s);
    };
  }

  /** Take every spawned vehicle away but the one ridden, and the NPC ships (the NPC tab's clear takes those). */
  removeVehicles(keep: Vehicle | null): number {
    let n = 0;
    for (const v of [...this.vehicles]) {
      if (v === keep || v.autopilot) continue;
      this.disposeVehicle(v);
      n++;
    }
    return n;
  }

  /** Interior-mesh accounting, for the console hook. */
  interiorStats(force = false): { buildings: number; built: number; meshes: number; eagerMeshes: number } | null {
    return this.layoutStream?.interiorStats(force) ?? null;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * A player put down somewhere without walking there (a teleport): stand them in whatever room
   * holds the point, since no portal was crossed to get in. Returns the cell, or 0 outside.
   */
  enterCellAt(pos: THREE.Vector3): number {
    if (!this.layoutStream) return 0;
    const state = this.layoutStream.buildingAt(pos);
    this.cellState = state;
    this.prevPlayerPos.copy(pos);
    return state?.cell ?? 0;
  }

  /** Elevator terminals near the player, nearest first (empty outside buildings). */
  elevatorsNear(pos: THREE.Vector3, range: number): { kind: 'up' | 'down' | 'both'; d: number }[] {
    return this.cellState && this.layoutStream ? this.layoutStream.elevatorsNear(pos, range) : [];
  }

  /**
   * Ride an elevator the way the original game does: the player is moved straight up or down
   * to the next floor surface on their vertical line, staying in the building. Returns the new
   * position, or null when there is no floor that way.
   */
  useElevator(pos: THREE.Vector3, up: boolean): THREE.Vector3 | null {
    const b = this.cellState?.building;
    if (!b || !this.layoutStream) return null;
    const floors = this.physics.floorsAt(pos.x, pos.z, pos.y + 80, pos.y - 80);
    let i = floors.findIndex((f) => Math.abs(f - pos.y) < 1);
    if (i < 0) i = floors.findIndex((f) => f < pos.y);
    const target = up ? floors[i - 1] : floors[i + 1];
    if (target === undefined) return null;
    const next = new THREE.Vector3(pos.x, target + 0.1, pos.z);
    const cell = this.layoutStream.cellAt(b, next);
    this.cellState = { building: b, cell: cell || this.cellState!.cell };
    this.prevPlayerPos.copy(next);
    return next;
  }

  /**
   * The lift shaft the player stands in: the stops it reaches (its doorways and those of the
   * shafts it opens into, lifts.ts), which one the player is at, and a title; null outside a shaft.
   */
  liftHere(pos: THREE.Vector3): { stops: LiftStop[]; current: number; title: string } | null {
    const b = this.cellState?.building;
    if (!b || !this.cellState || !isLiftCell(b.model.def, this.cellState.cell)) return null;
    const stops = liftStops(b.model.def, this.cellState.cell);
    if (stops.length < 2) return null;
    tmpV.copy(pos).applyMatrix4(b.inverse);
    const name = b.model.def.cells?.find((c) => c.index === this.cellState!.cell)?.name ?? 'lift';
    return { stops, current: stopAt(stops, tmpV.y), title: `${b.model.def.id} · ${name.replace(/_/g, ' ')}` };
  }

  /** Ride the lift the player stands in to one of its stops: the spot through that doorway, in the world, and the room beyond becomes the cell. */
  rideLift(stop: LiftStop): THREE.Vector3 | null {
    const b = this.cellState?.building;
    if (!b) return null;
    const next = stop.at.clone().applyMatrix4(b.matrix);
    this.cellState = { building: b, cell: stop.cell };
    this.prevPlayerPos.copy(next);
    return next;
  }

  /**
   * A building beside the player whose rooms cannot be walked into (a dungeon whose way in was
   * a server object, a station whose doors are up in the air): its name, so E can put the
   * player inside; null when there is none, or the player is already in one.
   */
  doorlessNear(pos: THREE.Vector3): { label: string } | null {
    if (this.cellState || !this.layoutStream) return null;
    const b = this.layoutStream.doorlessNear(pos);
    return b ? { label: b.model.def.id.replace(/_/g, ' ') } : null;
  }

  describeDoorless(pos: THREE.Vector3): ReturnType<LayoutStreamer['describeDoorless']> {
    return this.layoutStream?.describeDoorless(pos) ?? [];
  }

  /**
   * The building room standing at a point, or null outdoors. For the console only: it allocates a
   * `{ building, cell }` every call, which is why everything in a frame asks `indoorsAt` instead.
   */
  buildingAt(pos: THREE.Vector3): CellState | null {
    return this.layoutStream?.buildingAt(pos) ?? null;
  }

  /**
   * The facilities this world places where the dead come back, nearest the point given first, each
   * named by the pack's own list of places where one stands in a named place. Every object the pack
   * holds is here whether or not its region has streamed in, so this is a whole world's answer and
   * not what happens to be drawn.
   */
  cloningFacilities(from: { x: number; z: number }, places: readonly NamedPlace[] = [], limit?: number): FacilityChoice[] {
    return facilitiesNear(this.layoutStream?.objects ?? [], from, places, limit ?? CLONING_TUNE.shown);
  }

  /**
   * Put the player inside the facility standing at a point: the room the archives' own layout names
   * `spawn` where the building has one -- which is this game's reading of an ordinary room name and
   * not something the client says -- and its way in otherwise. Null when that building's region has
   * not streamed in yet, which is the caller's cue to leave them on the ground where it stands.
   */
  cloneRoomAt(x: number, z: number, template?: string): THREE.Vector3 | null {
    if (!this.layoutStream) return null;
    const b = this.layoutStream.buildingPlacedAt(x, z, template);
    if (!b) return null;
    const entry = this.layoutStream.namedEntryOf(b, SPAWN_CELL_NAME);
    if (!entry) return null;
    this.cellState = { building: b, cell: entry.cell };
    this.prevPlayerPos.copy(entry.at);
    return entry.at;
  }

  /**
   * Put the player inside the building beside them: a standing spot in its entry room, and the cell.
   *
   * `any` takes the doorless rule off, which the key never does: E offers this only for a building
   * with no passable doorway at all, since anything with a door is walked into. The console wants it
   * without that rule, to get inside a building whose real way in was a server object.
   */
  enterDoorless(pos: THREE.Vector3, any = false): { at: THREE.Vector3; cell: number } | null {
    if (!this.layoutStream) return null;
    const b = any ? this.layoutStream.nearestBuilding(pos) : this.layoutStream.doorlessNear(pos);
    if (!b) return null;
    const entry = this.layoutStream.entryOf(b);
    if (!entry) return null;
    this.cellState = { building: b, cell: entry.cell };
    this.prevPlayerPos.copy(entry.at);
    return { at: entry.at, cell: entry.cell };
  }

  /** Flora planted so far and the appearances the pack lacked (diagnostics). */
  get floraStatus(): { planted: number; models: number; missing: string[] } | null {
    return this.flora ? { planted: this.flora.planted, models: this.flora.modelCount, missing: [...this.flora.missing] } : null;
  }

  /** The snapshot's centre in SWG coordinates (the game's origin), when a converted pack is loaded. */
  /**
   * What the cover search can even be offered on this world, for `__debug.cover()`: how many placed
   * objects have collision this instant, and how many of those have a standing shape to hide behind.
   *
   * Nought blockers in a town is `NpcDeps.blockers` unwired or a streamer that has built nothing,
   * and neither the searcher's counters nor a body's own row can tell you that: both read exactly
   * like a world with no crates in it.
   */
  get coverGround(): { colliders: number; blockers: number } {
    return { colliders: this.layoutStream?.colliderCount ?? 0, blockers: this.layoutStream?.blockerCount ?? 0 };
  }

  /** Placed objects around a point with their streaming state, for the console. */
  objectsNear(x: number, z: number, r: number): ReturnType<LayoutStreamer['describeNear']> {
    return this.layoutStream?.describeNear(x, z, r) ?? [];
  }

  particlesNear(x: number, z: number, r: number): ReturnType<ParticleEffects['describeNear']> {
    return this.particles?.describeNear(x, z, r) ?? [];
  }

  emittersNear(x: number, z: number, r: number): ReturnType<ParticleEffects['describeEmitters']> {
    return this.particles?.describeEmitters(x, z, r) ?? [];
  }

  get particleStatus(): string {
    return this.particles?.status ?? 'no particle effects';
  }

  /**
   * What the wild world is allowed to ask of this one. Kept, not built per step: it is handed over
   * on every frame and nothing here may allocate in a frame.
   */
  private wildDepsKept: WildDeps | null = null;
  private wildDeps(): WildDeps {
    if (!this.wildDepsKept) {
      this.wildDepsKept = {
        catalogue: () => this.mobileCatalogue,
        // **`origin: 'spawned'`, and the other one is a trap.** `ambient` is the planet's own
        // recyclable wildlife, and the manager owns where those stand: past its range it moves each
        // one to a fresh spot near the player rather than leaving it be (`manager.ts:784`). A lair's
        // creatures belong at their lair, so they are `spawned`, which the manager only ever takes
        // away when it is dead or has fallen out of the world. The `worldId` is what keeps the hand
        // -spawn cap and the NPC tab's clear off them, since `spawn` reads that as origin `world`.
        spawn: (entry, at, seed) => this.mobiles?.spawn(entry, at, { origin: 'spawned', seed, worldId: `wild:${seed}` }) ?? 'no world',
        remove: (m) => this.mobiles?.remove(m),
        centre: () => this.layoutCenter,
        // A nest's own height is this world's to answer, unlike a creature's: the manager works one
        // out for a body it is standing, and a nest is not one of those.
        groundAt: (x, z) => this.terrain.heightAt(x, z),
        nest: {
          scene: this.scene,
          physics: this.physics,
          outdoorGroups: () => groups(Group.exterior, Group.all),
          forget: (mats) => this.forgetMaterials(mats),
          prepare: (root) => this.prepareActor(root),
          markActor,
          baseUrl: import.meta.env.BASE_URL,
        },
        // It holds when the streamer holds (an ultra cruise pins both), and never runs at all for
        // the creation and selection screens, which are a cut-out world with no streaming.
        held: () => this.streamHold || this.sceneOnly || !this.simulating,
      };
    }
    return this.wildDepsKept;
  }

  /** What the standing people are allowed to ask of this world. Kept, like the wild world's. */
  private peopleDepsKept: PeopleDeps | null = null;
  private peopleDeps(): PeopleDeps {
    if (!this.peopleDepsKept) {
      this.peopleDepsKept = {
        catalogue: () => this.mobileCatalogue,
        // Stood as `spawned` with a world name, for the same two reasons the wildlife is: the
        // manager leaves a spawned one where it was put, and the name keeps the hand-spawn cap and
        // the NPC tab's clear off it.
        spawn: (entry, at, inside, seed, essential) => this.mobiles?.spawn(entry, at, { origin: 'spawned', seed, inside, worldId: `stood:${seed}`, essential }) ?? 'no world',
        remove: (m) => this.mobiles?.remove(m),
        centre: () => this.layoutCenter,
        held: () => this.streamHold || this.sceneOnly || !this.simulating,
        // A person in a room needs that room's floor to exist first. The streamer builds a
        // building's cells by distance, so asking for the ground there answers null until it has.
        cellReady: (x, y, z) => this.groundAt(x, y + 2, z, true) !== null,
      };
    }
    return this.peopleDepsKept;
  }

  get layoutCenter(): { x: number; z: number } | null {
    return this.pack?.layout?.center ?? null;
  }

  /** Everything the pack places on this world, loaded or not, in the game's coordinates (a map's worth, not the scene's). */
  get placedObjects(): readonly PlacedObject[] {
    return this.layoutStream?.objects ?? [];
  }

  /**
   * How far along the world around a point is, 0 to 1: the pack's stages, the ground chunks
   * around the point, and the placed objects within working range, weighted by how long each
   * tends to take. What the loading screen fills its picture by.
   */
  progress(pos: THREE.Vector3): { total: number; stage: string } {
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    const R = Math.min(2, this.viewRadius);
    let need = 0;
    let have = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      need++;
      if (this.chunks.has(`${pcx + dx},${pcz + dz}`)) have++;
    }
    const ground = need && !this.planet.space ? have / need : 1;
    // In space every tier within its own range counts (a zone is a few hundred objects, and a landmark 2 km off must not stream in after the screen lifts).
    const objects = this.layoutStream ? this.layoutStream.progress(pos.x, pos.z, this.planet.space ? Infinity : undefined) : this.packProgress < 1 ? 0 : 1;
    const total = this.packProgress * 0.45 + ground * 0.2 + objects * 0.35;
    const stage = this.packProgress < 0.12 ? 'the planet\'s pack' : this.packProgress < 0.55 ? 'the terrain' : this.packProgress < 0.92 ? 'the flora, the ground and the sky' : ground < 1 ? 'the ground underfoot' : objects < 1 ? 'the buildings and the props' : 'the last of it';
    return { total, stage };
  }

  /** How far placed objects load, live: the streamer re-ranges, and the ground radii re-stream on the next move. */
  /** How far placed objects load: the setting, and in space (no ground, no buildings, only a few hundred rocks and a station) three times as far. */
  private streamReach(): number {
    return this.objectReach * (this.planet?.space ? SPACE_REACH : 1);
  }

  setReach(objects: number, terrain: number, far: number): void {
    this.objectReach = objects;
    if (this.layoutStream && this.planet?.id !== 'gallery') this.layoutStream.setReach(this.streamReach());
    this.viewRadius = Math.round(terrain);
    this.farRadius = Math.round(far);
    this.lastCx = Number.NaN;
    this.lastTx = Number.NaN;
  }

  /**
   * The normal maps' scale for every material in the scene, now and as they arrive. The green
   * channel is taken as it stands: it was flipped here for years on the reasoning that the game's
   * maps are Direct3D's, and looked at by eye on a screen it is the wrong way up. `__debug.normals`
   * flips it live for anyone who wants to see the difference again.
   */
  normalScale = new THREE.Vector2(1, 1);

  /** The strength and way up of every normal map in the scene, live, for checking the convention by eye. */
  setNormalScale(x: number, y: number): number {
    this.normalScale.set(x, y);
    let n = 0;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.normalMap && std.normalScale) {
          std.normalScale.set(x, y);
          n++;
        }
      }
    });
    // The ground has no `normalMap` of three's own for that scan to find -- its bumps are an array
    // sampled by this game's own injection -- so without this line the one slider meant to move
    // every normal in the world would move every one except the ground's.
    if (this.groundTextures?.setNormalScale(x)) n++;
    return n;
  }

  /**
   * How much of the client's own gloss mask the ground wears, live, and what it has to wear.
   *
   * Its own knob rather than part of the normals': the two come out of one texture but they are
   * different things, and the ground is the only surface in the game with a gloss map of ours to
   * move at all.
   */
  setGroundGloss(x?: number): { bumped: number; glossy: number; of: number; gloss: number } | null {
    const t = this.groundTextures;
    if (!t) return null;
    if (x !== undefined) t.setGloss(x);
    return { ...t.mapCounts, gloss: GROUND_NORMAL.gloss };
  }

  /**
   * Turn the sun's shadows on or off, live: every material takes the change on its next draw. Only
   * the renderer's switch flips: the cascade lights keep castShadow, because with no shadow-casting
   * directional light the cascade shader lights every surface with all three cascade lights
   * unshadowed (three suns). With castShadow kept and the map off it takes its one-light branch.
   */
  setShadowsEnabled(on: boolean): void {
    const r = this.renderer;
    if (!r || r.shadowMap.enabled === on) return;
    r.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  /**
   * Whether the world around a point is in: the pack loaded, the ground chunks around it made
   * (with the terrain's grids from the worker), and the placed objects within working range
   * loaded. A loading screen holds the player until this says so.
   */
  settled(pos: THREE.Vector3): boolean {
    if (this.packStatus === 'loading') return false;
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    if (!this.planet.space) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(`${pcx + dx},${pcz + dz}`)) return false;
    // In space, every tier within its own range (not 220 m round the point); anywhere, a huge object's collider pieces.
    if (this.layoutStream && !this.layoutStream.settled(pos.x, pos.z, this.planet.space ? Infinity : undefined)) return false;
    if (this.layoutStream && this.layoutStream.collidersPending > 0) {
      // Hidden, no frame runs `update`, which is what builds the pieces: the loading screen's poll builds them instead.
      if (document.hidden) this.layoutStream.buildHuge();
      return false;
    }
    return true;
  }

  /** Move the streamed world to a far-away point at once (teleporting), forgetting any building state. */
  jumpTo(center: THREE.Vector3): void {
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    this.layoutStream?.update(center);
    // The weather snaps to the new place: its area at once, and the roof grid from scratch.
    this.weather.reset();
    this.cellState = null;
    this.prevPlayerPos.x = Number.NaN;
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.groundHiddenFor = null;
  }

  /**
   * Resolve when the world around a point is ready to be seen: every region tier within its load range
   * loaded, the huge objects' collider pieces built, the materials that came with them adopted
   * (cascades before compile), and every queued or fresh object's programs made and linked
   * (compileReady, a mesh at a time). Polls once a drawn frame (a message to itself when the tab is
   * hidden). False after `timeoutMs`. Runs only inside the jump's closed tunnel or under a loading screen,
   * so what it allocates is no frame's cost.
   */
  async readyAround(pos: THREE.Vector3, timeoutMs: number): Promise<boolean> {
    // Nothing is raised here either. This is called inside a jump's closed tunnel, where the game
    // already answers `playerWaiting`, **and** at the ultra cruise's stop, where frames are being
    // drawn and no screen is up. It must not decide for itself that the player is waiting; the
    // flush below keeps to no allowance because nothing on the queue is a thing being looked at,
    // which is a different claim and is true in both places.
    return this.waitReadyAround(pos, timeoutMs);
  }

  private async waitReadyAround(pos: THREE.Vector3, timeoutMs: number): Promise<boolean> {
    const t0 = performance.now();
    for (;;) {
      const ls = this.layoutStream;
      if (this.packStatus !== 'loading' && (!ls || (ls.loadedAround(pos.x, pos.z) && ls.collidersPending === 0))) {
        // Cascades and the wet wrap first, then the programs: everything the queue is still holding
        // (a tier waiting to be shown, the scan's finds) and anything new, built outright rather
        // than a program a frame, since nothing is being looked at.
        const fresh = this.adoptMaterials(this.scene);
        const pending = this.programs.pending;
        if (!fresh.length && !pending) return true;
        await this.flushQueue();
        if (fresh.length) await this.compileReady(fresh);
        continue;
      }
      if (performance.now() - t0 > timeoutMs) return false;
      // Hidden, no frame comes and `update` (which streams) does not run: poll on a timer rather than spin on
      // messages to itself (throttled timers only make this slower, and it runs in the tunnel or under a loading screen).
      if (document.hidden) {
        // Nor are a huge object's collider pieces built by `update` there: build them here.
        ls?.buildHuge();
        await new Promise<void>((r) => setTimeout(r, 50));
      } else await this.nextFrame();
    }
  }

  /**
   * Load another world with one vehicle carried across it untouched (a hyperspace jump to another system): its body stays
   * in the one physics world the session has, its rooms in their own with whoever stands in them, its model, trails and
   * materials in the scene and the material sets, none of which the unload touches. The unload does two things to a
   * vehicle, dispose every one in `vehicles` and drop every ship's fight (`ships.clear`), so the vehicle is taken out of
   * the list first, its fight's shares read, and afterwards it is put back and adopted again with those shares. The
   * caller keeps the player aboard or seated (CLAUDE.md's unload rule is set aside on purpose here: the rooms are carried)
   * and moves the vehicle to where it arrives. Synchronous: no frame sees the world without it. If the load throws, the
   * vehicle is put back first (still ghosted and held, with the player aboard), so the jump's abort can release it.
   */
  loadCarrying(v: Vehicle, planet: PlanetDef, packId: string): void {
    const condition = v.combat ? v.combat.shares() : null;
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    try {
      this.load(planet, packId);
    } finally {
      if (!v.disposed && !this.vehicles.includes(v)) this.vehicles.push(v);
    }
    if (v.disposed) return;
    v.space = !!planet.space;
    if (v.spec.ship) {
      const combat = this.ships.adopt(v, { faction: 'neutral' });
      if (condition) combat.restore(condition);
      this.warmShipFx(v);
    }
  }

  /**
   * After a jump to another system is ready round `pos`, still under the closed tunnel: what a loading screen's settle did
   * for a crossing. The zone's reflections arrive after its first compiles (their cube loads on its own), and a reflective
   * material compiled before them is rebuilt when they land, which with the tunnel open would be on a frame in view; so
   * they are waited for (at most `envMs`), the ship effects made ready, every material in the scene compiled once more
   * (eight objects a frame, the tunnel drawing between), and anything streamed in meanwhile readied. False when that last
   * wait ran out.
   */
  async settleCarried(pos: THREE.Vector3, envMs: number, timeoutMs: number): Promise<boolean> {
    // The whole of it is behind the jump's closed tunnel, and that is the game's word (`playerWaiting`)
    // rather than this method's: the same sweep and the same wait are used in play as well.
    return this.settleInTunnel(pos, envMs, timeoutMs);
  }

  private async settleInTunnel(pos: THREE.Vector3, envMs: number, timeoutMs: number): Promise<boolean> {
    const t0 = performance.now();
    await this.environmentReady(envMs);
    if (this.renderer) await this.ships.prepareEffects(this.renderer);
    // Nothing here waits on the parallel-compile extension: `compileAllAsync` finishes every link it
    // makes before it returns, which is what the old `waitReady` asked for and what a hidden tab (whose
    // chained timers are held to one a minute) could never have got from a poll.
    await this.compileAllAsync(() => {}, { keepQueue: true });
    return this.readyAround(pos, Math.max(1000, timeoutMs - (performance.now() - t0)));
  }

  /** Resolve once the sky's reflections are in (or there is no sky to give any), or after `ms`. */
  private async environmentReady(ms: number): Promise<void> {
    const t0 = performance.now();
    while (this.swgSky && !this.envTexture && performance.now() - t0 < ms) {
      // Hidden, no frame runs `update` (which loads them): a timer, not messages to itself.
      if (document.hidden) await new Promise<void>((r) => setTimeout(r, 50));
      else await this.nextFrame();
    }
  }

  get inside(): boolean {
    return this.cellState !== null;
  }

  /** The ground is hidden under the building the player is below the terrain in (a basement or a dungeon). */
  get underground(): boolean {
    return this.groundHiddenFor !== null;
  }

  /**
   * The camera-following half of the weather, after the camera has moved and physics has stepped
   * (main calls it just before updateShadows): where the falling effect plays, the ridden ship's
   * box, the roof grid's rays, and the particles.
   */
  updateWeatherView(dt: number): void {
    if (!this.swgSky || !this.camera) return;
    const v = this.weatherView;
    v.inside = this.inside;
    v.aboard = this.aboard;
    v.underground = this.underground;
    v.fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
    v.hull = this.weatherHull;
    v.ridden = this.weatherRidden;
    // The weather keeps its own bare height test (`cam.y < waterAt(cam)`), and is the one asker that
    // is *not* given the shared answer. Its particles are scene geometry behind the `weather`
    // setting and have nothing to do with the Effects switch, so the shared margin -- 1.29 m over
    // the open sea, where the swell is -- would have stopped the rain while the player stood
    // waist-deep in the shallows with the whole sky falling round them, and it would have done it
    // with Effects off, which nothing in this pass may change.
    this.weather.updateView(dt, this.camera, v);
  }
  /** What the weather's first half is told, kept and refilled. */
  private readonly weatherWorld: WeatherWorldContext = { daylight: 1, groundAt: this.groundAtCached };
  /** What the weather's second half is told, kept and refilled so a frame makes nothing. */
  private readonly weatherView: WeatherViewContext = { inside: false, aboard: false, underground: false, fog: null, groundAt: this.groundAtCached, waterAt: this.waterAtFn, vehicles: this.vehicles, hull: null, ridden: null };

  /**
   * Follow the player through building portals, as the original client does. Inside a cell the
   * character ignores the shell and the ground; the ground is also hidden under the building
   * whenever the player is below it (basements), so no sand fills the lower floors.
   */
  private updateInterior(playerPos: THREE.Vector3): void {
    if (!this.layoutStream) return;
    if (Number.isNaN(this.prevPlayerPos.x)) this.prevPlayerPos.copy(playerPos);
    this.cellState = this.layoutStream.trackCell(this.cellState, this.prevPlayerPos, playerPos);
    this.prevPlayerPos.copy(playerPos);
    this.updateInteriorLights();
    const b = this.cellState?.building ?? null;
    const underground = b !== null && this.terrain.heightAt(playerPos.x, playerPos.z) > playerPos.y + 1.2;
    const want = underground ? b : null;
    if (want === this.groundHiddenFor) return;
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.groundHiddenFor = want;
    if (want) this.hideGroundUnder(want);
  }

  /**
   * Light the cell the player stands in the way the client does: each cell of a portal building
   * carries its own lights, placed by the building's artists. The current cell's lights and
   * those of the cells its portals open onto are live, up to a cap; the rest wait.
   */
  private updateInteriorLights(): void {
    const state = this.cellState;
    const want = state && state.cell > 0 ? { building: state.building, cell: state.cell } : null;
    const have = this.interiorLightsFor;
    if ((want?.building ?? null) === (have?.building ?? null) && (want?.cell ?? -1) === (have?.cell ?? -1)) return;
    this.interiorLightsFor = want;
    for (const l of this.interiorPoints) l.intensity = 0;
    this.fxLampCells.fill(-1);
    this.interiorParallel.intensity = 0;
    this.interiorAmbient.intensity = 0;
    if (!want) return;
    const cells = want.building.model.def.cells ?? [];
    const current = cells.find((c) => c.index === want.cell);
    if (!current) return;
    const order = [want.cell, ...(current.portals ?? []).map((p) => p.target).filter((t) => t > 0 && t !== want.cell)];
    const matrix = want.building.matrix;
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    // Rooms are never pitch black: a floor under the cell's own ambient light.
    const ambient = new THREE.Color(INTERIOR_AMBIENT_FLOOR, INTERIOR_AMBIENT_FLOOR, INTERIOR_AMBIENT_FLOOR);
    let points = 0;
    let parallel = false;
    for (const index of order) {
      const cell = cells.find((c) => c.index === index);
      for (const l of cell?.lights ?? []) {
        const color = new THREE.Color(l.color[0], l.color[1], l.color[2]);
        if (l.type === 0) {
          ambient.add(color);
          continue;
        }
        pos.set(l.position[0], l.position[1], l.position[2]).applyMatrix4(matrix);
        if (l.type === 1) {
          if (parallel) continue;
          parallel = true;
          dir.set(l.direction[0], l.direction[1], l.direction[2]).transformDirection(matrix);
          this.interiorParallel.color.copy(color);
          this.interiorParallel.intensity = 1.2;
          this.interiorParallel.position.copy(pos).addScaledVector(dir, -20);
          this.interiorParallel.target.position.copy(pos);
          continue;
        }
        if (points >= INTERIOR_LIGHT_CAP) continue;
        // Direct3D falloff 1 / (c + l d + q d^2) matched at 3 m to three's I / d^2, cut where it fades below 5%.
        const [c, li, q] = l.attenuation;
        const at3 = 1 / Math.max(0.05, c + 3 * li + 9 * q);
        let range = 40;
        for (let d = 1; d <= 40; d++) {
          if (1 / (c + li * d + q * d * d) < at3 * 0.05) {
            range = d;
            break;
          }
        }
        this.fxLampCells[points] = index;
        const light = this.interiorPoints[points++];
        light.color.copy(color);
        light.intensity = 9 * at3 * INTERIOR_LIGHT_SCALE;
        light.distance = range;
        light.position.copy(pos);
      }
    }
    this.interiorAmbient.color.copy(ambient);
    this.interiorAmbient.intensity = INTERIOR_AMBIENT_SCALE;
  }

  private hideGroundUnder(b: Building): void {
    const r = b.radius + 2;
    const overlaps = (ox: number, oz: number, size: number) => b.x + r > ox && b.x - r < ox + size && b.z + r > oz && b.z - r < oz + size;
    for (const c of this.chunks.values()) {
      if (overlaps(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE)) {
        c.group.visible = false;
        this.hiddenGround.push(c.group);
      }
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (overlaps(tx * FAR_TILE, tz * FAR_TILE, FAR_TILE)) {
        t.visible = false;
        this.hiddenGround.push(t);
      }
    }
  }

  collidersNear(x: number, z: number, radius: number): Collider[] {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const out: Collider[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx},${cz + dz}`);
        if (!c) continue;
        for (const col of c.colliders) {
          if (Math.abs(col.x - x) < radius + col.r && Math.abs(col.z - z) < radius + col.r) out.push(col);
        }
      }
    }
    return out;
  }

  /**
   * The other players' bodies (src/net/remoteBodies.ts), bound to this world's physics the first
   * time anything asks. With no relay it holds nothing and costs one map lookup that misses; the
   * peers themselves make and move the bodies, and everything in the game finds them here.
   */
  private peerLink: RemoteBodies | null = null;

  private peers(): RemoteBodies {
    return (this.peerLink ??= peerBodies().bind(this.physics));
  }

  /**
   * The rooms of a hull another player flies (src/net/remoteInterior.ts), bound to this world the
   * first time anything asks: its physics for the stand-in hull, its scene, its gravity, its garage,
   * and the one preparation a vehicle gets before it is shown (`vehiclePrepare`, which adopts the
   * materials and builds their programs a drawable at a time) so that a room shown in play compiles
   * nothing. Until somebody asks for a hull to be made a place, nothing is built and this holds
   * nothing at all, which is the game with no server.
   */
  private roomLink: RemoteInteriors | null = null;

  remoteRooms(): RemoteInteriors {
    return (this.roomLink ??= remoteInteriors().bind({
      physics: this.physics,
      scene: this.scene,
      gravity: () => -this.physics.world.gravity.y,
      garage: async () => (this.garage ??= await Garage.load(import.meta.env.BASE_URL)),
      prepare: (roots) => this.vehiclePrepare(roots),
      forget: (m) => this.forgetMaterials(m),
      watch: watchPeers,
    }));
  }

  /**
   * The mobile, creature, fighter, turret, other player, loose prop or vehicle a physics collider
   * belongs to (every collider of a long body is its own). A loose prop is here and deliberately
   * not in `targets()`: a bolt stops on a crate and shoves it, and nothing ever picks a fight with one.
   */
  hittableAt(handle: number): Hittable | undefined {
    const found =
      this.mobiles?.byCollider.get(handle) ??
      this.creatures.byCollider.get(handle) ??
      this.npcs.byCollider.get(handle) ??
      this.turrets.byCollider.get(handle) ??
      this.peers().byCollider.get(handle) ??
      loosePropAt(handle) ??
      // A lair's own nest, which is how a bolt or a blade reaches the thing in the middle.
      wildLife.nestAt(handle);
    if (found) return found;
    // A plain loop rather than `find`, because this is asked once per collider a swept capsule
    // touches and a blade is now cast up to four times a frame: the predicate handed to `find` is
    // a closure made on every call, which is exactly what the rule against allocating in a step is
    // about. Nothing else about the answer changes.
    for (let i = 0; i < this.vehicles.length; i++) if (this.vehicles[i].colliderHandles.includes(handle)) return this.vehicles[i];
    return undefined;
  }

  /** `target` is whom the turrets shoot at, or null while nothing should be shot (noclip, riding). */
  update(dt: number, playerPos: THREE.Vector3, camPos: THREE.Vector3, fastTime: boolean, onAttack: (damage: number, from?: THREE.Vector3) => void, target: TurretTarget | null = null): void {
    this.stream(playerPos, STREAM_BUDGET);
    this.streamFar(playerPos, 1);
    if (this.layoutStream) {
      // The building the player is in keeps its interior however far its wings reach.
      // Held: nothing is loaded and nothing is dropped. An ultra-fast cruise crosses a region every
      // few dozen milliseconds, and a tier built at that speed would be a collider and a program on
      // a live frame for something already kilometres behind. Whatever holds it frees it again, and
      // waits for what stands round where it stopped before the ship is handed back.
      if (!this.streamHold) this.layoutStream.update(playerPos, this.cellState?.building ?? null);
      this.packStatus = `${this.packBase}; ${this.layoutStream.status}${this.particles ? `; ${this.particles.status}` : ''}`;
    }
    if (this.particles && this.camera) this.particles.update(dt, this.camera, this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null);
    if (this.camera) {
      const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
      this.shipFx.update(dt, this.camera, fog);
      this.weaponFx.update(dt, this.camera, fog);
    }
    this.updateInterior(playerPos);
    this.day.update(dt, fastTime);
    if (this.swgSky) {
      // What the sky needs from the weather (the area, the level, the blend, the wind) comes first.
      this.weatherWorld.daylight = this.day.daylight;
      this.weather.update(dt, playerPos, this.weatherWorld);
      this.applySwgLighting(this.swgSky.update(this.day, camPos, dt), playerPos);
      this.refreshEnvironment(dt);
    } else this.applyLighting();
    this.waterBodies.envLight = this.waterEnvLight();
    this.sky.position.copy(camPos);
    this.spaceBodies?.position.copy(camPos);
    if (this.spaceWorldBodies.length) this.placeStandingBodies(camPos);
    // The nebulae: where the camera is inside them, the haze, the sheets' order and the strikes.
    if (this.nebulae && this.camera) this.nebulae.update(dt, this.camera);
    // The Force's beams: the flicker, the flip-book and the fade of any one nothing is holding.
    stepForceLightning(dt);
    // The loose props: the pose of any that is awake onto its mesh, the sleep rule, and any thrown
    // off the world put back on its stand. One asleep is not read at all.
    stepLooseProps(dt, playerPos);
    this.waterTime += dt;
    for (const m of this.waterMaterials) m.userData.uniforms.uTime.value = this.waterTime;
    // Modulo the shader's own loop, whose flow × loopTime is whole: the noise wraps without a seam.
    for (const m of this.lavaMaterials) m.uniforms.uFlowTime.value = this.waterTime % m.userData.loopTime;
    this.emitRipples(dt, playerPos);
    // The field is stepped after its bodies have moved and before anything is drawn, so the water
    // shader reads the surface those bodies just made.
    if (this.renderer && this.camera && this.waterMaterials.length) {
      stepWaterSim(this.renderer, this.camera.position.x, this.camera.position.z, this.terrain.waterHeightAt(this.camera.position.x, this.camera.position.z), dt);
    }
    this.emitDust(dt);
    if (this.waterMaterials.length) updateWaterDepth(playerPos.x, playerPos.z, (x, z) => this.terrain.heightIfCached(x, z, FAR_TILE, FAR_RES));
    if (this.water) {
      const cell = WATER_NEAR / WATER_SEGMENTS;
      this.water.position.x = Math.round(playerPos.x / cell) * cell;
      this.water.position.z = Math.round(playerPos.z / cell) * cell;
    }
    if (this.waterFar) {
      this.waterFar.position.x = playerPos.x;
      this.waterFar.position.z = playerPos.z;
    }
    this.sun.target.position.copy(playerPos);
    this.sun.position.copy(playerPos).addScaledVector(this.day.lightDir, 220);
    // The loop has already said where the player stands and what a blow does; `onAttack` is kept
    // as the fallback for a caller that has not (a test, an old call site), and the flag is asked
    // every frame rather than once: a fallback that looked at `hurt` alone would fill the target
    // in on the first frame and then leave the player standing wherever they were on it.
    if (!this.playerTargetSet) this.setPlayerTarget(playerPos, true, onAttack);
    this.playerTargetSet = false;
    this.stepLiving(dt, playerPos, this.camera);
    if (target) this.turrets.update(dt, target, this.bolts);
    this.gallery?.update(dt, playerPos);
    this.updateAmbience(dt);
  }

  /**
   * The sound of the place: the sky's own rows played at the sky's own weights, the room's bed while
   * the player is in one, and the placed emitters' own bounded pass.
   *
   * It runs last, after the sky's mix has been set for this frame, so the beds never lag the clouds
   * by a frame. The mixer itself steps after the camera has moved (the game's loop does that), so
   * the grid's pass is read here as "has the count moved since the last frame", which is what keeps
   * the emitters' room lookups on the grid's own beat rather than on every frame.
   */
  private updateAmbience(dt: number): void {
    const a = this.ambience;
    if (!a) return;
    this.readySound();
    const sky = this.swgSky;
    let n = 0;
    if (sky) {
      for (let i = 0; i < sky.mixLength && n < this.bedRows.length; i++) {
        const block = sky.mixBlock(i);
        if (!block) continue;
        const row = this.bedRows[n++];
        row.sounds = block.sounds ?? null;
        row.weight = sky.mixWeight(i);
      }
    }
    this.bedRowCount = n;
    const passes = this.audio?.grid.counts.passes ?? 0;
    const pass = passes !== this.soundPass;
    this.soundPass = passes;
    // The one context object, refilled: `rows` and `space` are the kept ones it was built with.
    const ctx = this.bedContext;
    ctx.rowCount = this.bedRowCount;
    ctx.daylight = this.day.daylight;
    ctx.room = this.roomRowNow();
    // The ear's own room decides the echo: the interior table's room type, 7 in the six rooms it
    // marks apart and 22 in every other room it names. -1 is the open world.
    this.audio?.setRoom?.(ctx.room?.room ?? -1);
    ctx.pass = pass;
    a.update(dt, ctx);
  }

  /**
   * Everything alive, stepped once over one shared list of targets: the creatures, the fighters,
   * and whatever else comes to live on it. The loop and `__debug.advance` both call this, and it
   * is the only place the simulated clock moves -- not `performance.now()`, because `advance`
   * runs ten simulated seconds in a fraction of one real one and every timer keys off `now`.
   */
  stepLiving(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera | null): void {
    this.simTime += dt;
    surfaces.update(this.simTime, this.renderer);
    const targets = this.targets(true);
    this.creatures.update(dt, playerPos, this.hurtPlayer);
    this.mobiles?.update(dt, { now: this.simTime, dt, camera, playerPos, targets });
    // The world's own lairs and herds, stood and put away as the player moves. On this clock and
    // not the frame's, so `__debug.advance` drives every respawn it has.
    wildLife.step(dt, this.simTime, playerPos, this.wildDeps());
    standingPeople.step(dt, this.simTime, playerPos, this.peopleDeps());
    // `playerPos` is only read by a fighter under a long walk (`src/world/errand.ts`), which measures
    // how far the body was from the player to know whether anything along the route was solid. It is
    // handed in rather than picked out of `targets`, because the player leaves that list while
    // noclipping, aboard or dead and the walk's account must not go blind on any of those.
    this.npcs.update(dt, targets, this.bolts, camera, this.simTime, playerPos);
    // The ships that fight: the contacts in step with the vehicles (the player's ship marked), the NPC ships'
    // brains (held, thinking nothing, while play is paused), then every combat's shields, boost and damage bands.
    this.ships.sync(this.vehicles, this.playerShip, this.playerTarget, this.simTime);
    // The hold covers the patrols too, and held they are exactly as a panel holds them. They stream
    // themselves in: a group asleep within a few kilometres of the player wakes, spawns its hulls and
    // compiles their programs on a live frame. At kilometres a second that distance is a fraction of
    // a second, so a held run would otherwise sweep every anchor in the zone and wake all of them.
    this.npcShips?.update(dt, this.simTime, this.simulating && !this.streamHold);
    this.ships.update(dt, this.simTime, this.simulating);
    // A fire the player is carrying is **not** put out from here, and the reason is worth keeping.
    // The obvious line -- while play is simulated, a burning player who has become untargetable has
    // the fire put out -- was here, and it could not do the one job it was written for. The record's
    // `dead` is five quite different things at once (not simulated, noclipping, aboard a hull's
    // rooms, dying, down), and death is the one of them it can never catch: the whole death card is
    // unsimulated, so a guard on `simulating` means the line cannot run between the blow that kills
    // and the respawn, and by the respawn the player is alive again. So it did nothing on a death
    // and everything on a boarding ramp, which is the opposite of both packages' intent.
    //
    // A fire now ends where the body it is on ends: `Player.startRagdoll` puts it out in silence at
    // the death, `Player.reset` again when the body is stood up whole, and `unload` when the world
    // goes. Noclipping and stepping aboard leave the burn alone deliberately -- it goes on being
    // spent, every blow of it refused by the game's own rule about what may hurt the player, and the
    // burning manager draws nothing on a body that may not be attacked, so nothing is left standing.
    // What the ground itself does to whoever stands on it. Last, after everything alive has moved
    // and after the hulls, so a body is burnt where this step left it and not where it was.
    this.stepHazards(dt, playerPos);
  }

  /**
   * The lava tick: once every `LAVA_HARM.interval` simulated seconds, whoever is standing in a flow
   * loses a share of their whole life. It runs on the world's own clock and only while play runs, so
   * `__debug.advance` exercises it and a panel held open over a flow pauses it, exactly as the ships'
   * fight pauses.
   *
   * **It reaches the player and what they ride, and nothing else** (the design's D12), which is why
   * this is not a loop over `targets()`. That list carries another player's body, which hands every
   * blow it takes to the wire and would have this browser billing them for a flow they can see for
   * themselves; and a body from the catalogue that somebody else is driving, whose own keeper is
   * standing it in the same flow and will take it off there. The world's own creatures come with the
   * wave that owns them.
   *
   * A rider is burnt through their ride and never directly: they are sitting inside the thing that
   * is in the flow, and the client's own immunity list is a list of *vehicles* for exactly that
   * reason. The ride's own damage already jolts whoever is on it.
   *
   * Allocates nothing: four numbers of state and no closure.
   */
  private stepHazards(dt: number, playerPos: THREE.Vector3): void {
    // Paused: nothing is measured, nothing is said, and the clock is left exactly where it stands --
    // so a panel opened nine tenths of the way to a blow does not throw that progress away, and
    // closing it does not announce that you are out of a flow you are still standing in.
    if (!this.simulating) return;
    // Switched off: everything forgotten, in silence, so turning it back on says the line afresh
    // rather than saying "out" first.
    if (!LAVA_HARM.on) {
      this.lavaClock = 0;
      resetLavaHold(this.lavaHold);
      this.lavaBurning = 'no';
      return;
    }
    const ride = this.playerRides;
    // Where to look. For a body, its own feet: `playerPos` is the world's, aboard a ship's rooms as
    // well, so nothing here reads a hull frame. For a ride, its **belly** -- the lower corner of its
    // box in its own frame, which the garage puts at the origin for everything it builds and which a
    // creature keeps from its pack, where the two corners may be the other way round (a pack
    // converted before the bounds fix), so the lower of the two is taken and neither is trusted to be
    // the one called `min`. Measured from the origin instead, whether a ride burned would depend on
    // how tall it is, and a tall hull would hover over a flow untouched.
    let depth: number;
    if (ride) {
      const b = ride.spec.bounds;
      depth = this.lavaAt(ride.pos.x, ride.pos.y + Math.min(b.min[1], b.max[1]), ride.pos.z);
    } else {
      depth = this.lavaAt(playerPos.x, playerPos.y, playerPos.z);
    }
    // A hover machine never gets under a surface at all, so what it rides over is measured with a
    // reach; a body on its own feet has to be in the flow. Both lines move for something already in,
    // or a body resting at the line flips every step; and a gap in the verdict too short to believe
    // is bridged, because over the edge of a flow polygon the depth does not wobble, it vanishes,
    // and no distance can span that. All three of those are `stepLavaHold`, which the player's sink
    // steps too, so the burn and the drop on the figure can never draw different lines.
    const hold = stepLavaHold(this.lavaHold, dt, depth, !!ride);
    const raw = hold.raw;
    const burning = hold.in;
    // Who could take it if it landed. A ride the client's own table says takes none of it answers for
    // itself: which hulls are on that list is the immunity join's business (`lavaImmune`, written
    // once at spawn) and this asks only for its answer.
    const immune = ride ? ride.lavaImmune : false;
    // Whether a blow can land at all: a destroyed hull, and a player who is dead, noclipping or
    // aboard a hull's rooms (all of which the game marks by `playerTarget.dead`).
    const alive = ride ? !ride.dead : !this.playerTarget.dead;
    // And whether a blow would come to anything. On every planet converted before the water command
    // read the client's tables the share is nothing, and a line reading "the lava is burning you"
    // over a body losing nothing is the same untruth as a blow with no line. It also keeps a blow of
    // nothing off a hull's own damage path, which for a ship would place its armour's hit effect
    // once a second for a burn that is not happening.
    const bites = LAVA_HARM.share > 0;
    const hurts = burning && bites && !immune && alive;
    // A body that can no longer be hurt drops the line in silence: saying "you are out of the lava"
    // over a corpse still lying in it would be the one line the message line ought never to say.
    if (!alive) this.lavaBurning = 'no';
    else this.sayBurning(!hurts ? 'no' : ride ? 'ride' : 'you');
    if (!hurts) {
      this.lavaClock = 0;
      return;
    }
    // The line and the clock are held through a flicker; a **blow** is only ever charged for a step
    // whose own verdict was true, so nobody is burnt for ground they have really left.
    if (!raw) return;
    this.lavaClock += dt;
    if (this.lavaClock < LAVA_HARM.interval) return;
    // Put down rather than wound back: a frame longer than the interval (a stall, a hidden tab) pays
    // for one blow and not for as many as it covered.
    this.lavaClock = 0;
    if (ride) {
      // No direction: the hull's own damage takes one for the arc on the pilot's screen, and a flow
      // is under the whole hull rather than off to one side of it.
      ride.damage(lavaTickDamage(LAVA_HARM.share, ride.maxHp));
      return;
    }
    // The player's own path, which is what applies the regeneration lockout: the record's `damage`
    // and not its `hurt`, so the game's own wrapper round it runs. Nothing is passed for where the
    // blow came from, so the screen flashes red and draws no arc -- a vector straight down would
    // draw a real arc at the bottom of the screen and read as something shooting from below.
    this.playerTarget.damage(lavaTickDamage(LAVA_HARM.share, this.playerMaxHp));
  }

  /**
   * One line when a burn starts and one when it stops, and nothing at all in between: the message
   * line merges a repeat within two seconds into a count, so a line a second would show a rising
   * number and bury everything else the game says.
   */
  private sayBurning(now: 'no' | 'you' | 'ride'): void {
    if (now === this.lavaBurning) return;
    const was = this.lavaBurning;
    this.lavaBurning = now;
    const say = this.onNote;
    if (!say) return;
    if (now === 'you') say('the lava is burning you');
    else if (now === 'ride') say('the lava is burning what you are riding');
    else if (was === 'you') say('you are out of the lava');
    else say('your ride is out of the lava');
  }

  /** The spawner's cap and the mobiles' animation range (the settings), kept for the managers later planets make. */
  setMobileDetail(cap: number, animRange: number): void {
    this.mobileDetail.cap = cap;
    this.mobileDetail.animRange = animRange;
    if (this.mobiles) {
      this.mobiles.cap = cap;
      this.mobiles.animRange = animRange;
    }
  }

  /** Start the creature and NPC catalogue's one fetch (at boot, beside the species index); it resolves to the catalogue, or null. */
  loadMobileCatalogue(): Promise<MobileCatalogue | null> {
    return MobileCatalogue.load(import.meta.env.BASE_URL);
  }

  /** The catalogue if it has landed, else null: nothing in a frame may wait on it. */
  get mobileCatalogue(): MobileCatalogue | null {
    return MobileCatalogue.loaded(import.meta.env.BASE_URL);
  }

  /** One kept callback rather than a fresh closure a frame; what it does is set by the loop. */
  private readonly hurtPlayer = (damage: number, from?: THREE.Vector3): void => {
    this.playerTarget.hurt(damage, from);
  };

  /**
   * Everything alive right now: the player when it may be attacked, the creatures, the mobiles, the
   * fighters, and the other players on this world. One kept array, rebuilt only when a manager has
   * gained or lost a body (or when `stepLiving` asks for a fresh one), so a disposed body can never
   * be handed out.
   */
  targets(fresh = false): readonly Living[] {
    const at = this.livingAt;
    const cv = this.creatures?.version ?? -1;
    const nv = this.npcs?.version ?? -1;
    const mv = this.mobiles?.version ?? -1;
    const peers = this.peers();
    const pv = peers.version;
    const alive = !this.playerTarget.dead;
    if (!fresh && cv === at.creatures && nv === at.npcs && mv === this.mobilesAt && pv === at.peers && alive === at.player) return this.livingList;
    // Whether anything has come or gone since the last build, which is the only time a new body can
    // need watching. `stepLiving` asks for a fresh list every frame, so this must not be the rebuild
    // itself: it is the version change, and in a steady frame it is false and nothing is scanned.
    const gained = cv !== at.creatures || nv !== at.npcs || mv !== this.mobilesAt || pv !== at.peers || alive !== at.player;
    at.creatures = cv;
    at.npcs = nv;
    this.mobilesAt = mv;
    at.peers = pv;
    at.player = alive;
    this.livingList.length = 0;
    if (!this.playerTarget.dead) this.livingList.push(this.playerTarget);
    if (this.creatures) for (const c of this.creatures.creatures) this.livingList.push(c);
    // A mobile whose model is still loading neither thinks nor is fought over (the manager bumps its version when one is up).
    if (this.mobiles) for (const m of this.mobiles.live) if (m.ready) this.livingList.push(m);
    if (this.npcs) for (const n of this.npcs.npcs) this.livingList.push(n);
    // The other players: on this world, with a body made, whatever they are standing in or riding.
    for (const p of peers.living) this.livingList.push(p);
    if (this.hitWatch && gained) this.watchHits();
    return this.livingList;
  }

  /**
   * Who to tell when the player lands a blow. It is the one hook the interface's damage feedback
   * needs, and it is here rather than at the call sites because there are a dozen of those, in four
   * files, and every one of them already says who struck: a power, a saber sweep, a bolt and a
   * flame all pass `world.playerTarget` as the blow's `source`.
   *
   * What it does is wrap each living thing's own `damage` once, as it joins the list, so the watch
   * hears every blow whatever hurt it and whichever file called it. The wrapper calls through first
   * and reads `dead` either side of the call, which is how it knows a blow finished something. It is
   * put on once per body, never in a frame, and only while somebody is watching.
   *
   * What it does **not** hear: anything hurt that is not one of the living — a ship (whose own bars
   * flash, which is the flight display's), a turret, a door. Pass null to stop watching; bodies
   * already wrapped keep their wrapper, which then costs one comparison a blow and does nothing.
   *
   * The amount reported is the damage the blow **offered**. A body already dead is filtered here,
   * since a corpse stays on the list a while and refuses every blow on its own first line; a body
   * that refuses a blow for any other reason (one of your own side that would not fight you) cannot
   * be told from one that took it without reaching inside it, and is reported as a blow that landed.
   */
  watchPlayerHits(watch: PlayerHitWatch | null): void {
    this.hitWatch = watch;
    if (watch) this.watchHits();
  }

  /** Every living thing in the list that has not been wrapped yet. Called when one has come or gone. */
  private watchHits(): void {
    const list = this.livingList;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (this.hitWatched.has(t)) continue;
      const inner = t.damage.bind(t);
      try {
        t.damage = (amount: number, from?: THREE.Vector3, push?: number, source?: Living | null): void => {
          const before = t.dead;
          inner(amount, from, push, source);
          const watch = this.hitWatch;
          // The player's own blows only, and never the player hurting itself: everything else on the
          // list is hurt by creatures and fighters all the time and none of it is yours to be told of.
          // A body that was already dead when the blow was offered is not reported either: a corpse
          // stays on the list for a while and refuses damage on its own first line, and emptying a
          // clip into one used to tick the crosshair and say a line for every shot.
          if (!watch || before || source !== this.playerTarget || t === this.playerTarget) return;
          watch(t, amount, !before && t.dead);
        };
        // Marked only once it has really taken the wrapper, so a body that would not is tried again
        // the next time something comes or goes rather than being written off for good.
        this.hitWatched.add(t);
      } catch {
        // A body that will not take one is simply not watched. This runs inside the frame loop's own
        // target list, and nothing on the screen is worth throwing there.
      }
    }
  }

  /** Where the player stands, whether it may be attacked at all, and what a blow does to it. */
  setPlayerTarget(pos: THREE.Vector3, targetable: boolean, hurt: (damage: number, from?: THREE.Vector3) => void): void {
    this.playerTarget.pos.copy(pos);
    this.playerTarget.dead = !targetable;
    this.playerTarget.hurt = hurt;
    this.playerTargetSet = true;
  }

  /**
   * The ground under a point: through the physics when the body is inside a building (the floor,
   * not the terrain under the building), and the terrain's own height outside. Null when nothing
   * is under an indoor point.
   */
  groundAt(x: number, y: number, z: number, inside: boolean): number | null {
    if (!inside) return this.terrain.heightAt(x, z);
    const filter = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
    // What stands still only: a ray from inside a body (the player's capsule, a fighter's, a
    // creature's) would otherwise find that body and call its middle the floor.
    return this.physics.topSurface(x, z, y + 0.2, 40, filter, World.staticOnly);
  }

  /** A collider that is part of the world rather than of something that moves. */
  private static readonly staticOnly = (c: R.Collider): boolean => {
    const body = c.parent();
    return !body || body.isFixed();
  };

  /**
   * A clear spot `distance` metres ahead of a point, or null. The ray starts three metres up and
   * reaches thirty down, keeping only fixed or bodiless colliders, with the interior filter when
   * inside; outside it falls back to the terrain's own height, which is arithmetic and needs no
   * stepped physics (rapier's scene queries see nothing until the world has stepped once, and
   * the arrival spawn runs before the loop's first step).
   */
  spawnSpot(from: THREE.Vector3, forward: THREE.Vector3, distance: number, inside: boolean): THREE.Vector3 | null {
    const x = from.x + forward.x * distance;
    const z = from.z + forward.z * distance;
    const top = from.y + 3;
    const filter = groups(Group.all, inside ? Group.all & ~(Group.terrain | Group.exterior) : Group.all);
    const ray = new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, 30, true, undefined, filter, undefined, undefined, (c) => {
      const body = c.parent();
      return !body || body.isFixed();
    });
    if (hit) return new THREE.Vector3(x, top - hit.timeOfImpact, z);
    if (inside) return null;
    return new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
  }

  /**
   * Irradiance luminance at a point from the world's lights: the sun or moon, the sky half of the
   * hemisphere, the fill, and a building's room set while it is live (its points taken no nearer
   * than `reach` short of the point). The blade glow's ceiling for a lit surface; an estimate that
   * errs high. With the cascaded shadows on the sun is hidden, but its cascades carry its colour and
   * intensity, so reading the sun is right either way.
   */
  litIrradianceNear(p: THREE.Vector3, reach: number): number {
    let e = lumOf(this.sun.color) * this.sun.intensity + lumOf(this.hemi.color) * this.hemi.intensity + lumOf(this.fill.color) * this.fill.intensity;
    if (this.interiorLightsFor) {
      e += lumOf(this.interiorAmbient.color) * this.interiorAmbient.intensity + lumOf(this.interiorParallel.color) * this.interiorParallel.intensity;
      for (const l of this.interiorPoints) if (l.intensity > 0) e += pointIrradiance(lumOf(l.color), l.intensity, l.position.distanceTo(p), reach, l.decay);
    }
    return e;
  }

  /**
   * The sun as the effects want it: which way it lies, its colour, and how much daylight there is
   * (0 at night; a full 1 in space, where the zone's star never sets). Filled into a record the
   * caller keeps, so a frame allocates nothing.
   */
  sunInfo(out: SunInfo): SunInfo | null {
    if (!this.planet) return null;
    tmpV.copy(this.sun.position).sub(this.sun.target.position);
    if (tmpV.lengthSq() < 1e-6) return null;
    // In space the zone's star lights the ship from wherever it hangs, above or below the ship's
    // horizontal alike: there is no ground for it to go behind, so its height says nothing. The
    // test belongs to a planet's day, where a sun under the horizon is a sun that has set, and
    // where it also decides how much daylight there is.
    const space = this.planet.space;
    if (!space && this.day.sunDir.y <= 0.02) return null;
    out.dir.copy(tmpV).normalize();
    out.color.copy(this.sun.color);
    // Deep inside a nebula the star is behind a wall of gas: the god rays read this, and the sky
    // lights below carry the same dimming to the lens flare, so the two never disagree.
    out.intensity = space ? (this.nebulae?.rayDim ?? 1) : this.day.daylight;
    return out;
  }

  /** What the lens flare follows this frame, one fixed slot per body: the sky's glowing suns (a space zone's brightest stars). Allocates nothing. */
  skyLights(out: readonly import('../core/fx/lensFlare').FxSkyLight[], nightSuns = true): number {
    if (!this.planet) return 0;
    if (this.swgSky) {
      const count = this.swgSky.flareLights(out, nightSuns);
      // Inside a nebula the gas stands between the camera and the star: the flare fades with how
      // deep in the camera is, by the same reading the god rays take in `sunInfo`.
      const dim = this.nebulae?.flareDim ?? 1;
      if (dim < 1) for (let i = 0; i < count; i++) out[i].alpha *= dim;
      return count;
    }
    if (this.planet.space) return 0;
    // The procedural dome's sun (and Tatooine's second); dark at night, the slots kept.
    return SwgSky.proceduralFlareLights(out, this.day.sunDir, this.sun.color, this.planet.sky.suns);
  }

  /** The converted sky's cloud sheets for the flare's occlusion; none on a procedural sky. */
  cloudLayers(out: readonly import('../core/fx/lensFlare').FxCloudLayer[]): number {
    return this.swgSky ? this.swgSky.cloudLayers(out) : 0;
  }

  /**
   * Whether a point is under a water surface, how deep under it is, and the look of the water over
   * it. The one answer the reflections, the lens flare and the effects chain read, so nothing on the
   * screen can disagree about which side of the surface the eye is on. **The weather asks its own
   * question still**, and deliberately: its particles are scene geometry behind the `weather`
   * setting, so a margin here would change the game with Effects off, which it may not.
   *
   * It is named for the camera because two of its three exclusions are the *player's* state and not
   * the point's: a building's rooms are the room the player is in (`inside`), and whether the planet
   * has a sea at all is read off the mesh that follows the camera. Ask it about a creature, a bolt
   * or a mobile and you get the player's room; that is the rename to do first if anything ever does.
   *
   * Three things it is not. A space zone and a building's rooms have no water at all. And lava is
   * water to the terrain and is water to nothing else: the lava planet's tables are all lava, and
   * without the guard a flow reads as a lake to sink into (the same guard `footSurfaces.waterTop`
   * and the ripples already take, and by the same reading -- the highest table covering the point --
   * with the global table's own shader tested too, which those two do not do).
   *
   * Two answers come back, and which one a caller wants matters. `under` carries the water's own
   * reach, so a crest passing over the eye counts, and 20 cm of hysteresis so the verdict does not
   * chatter as one does: it is the safe answer for anything that must not reflect a sky it cannot
   * see. `submerged` is the strict one, true only below the real surface, and is what anything that
   * paints the picture must read -- the band between them is open air.
   *
   * `out` is the caller's record and is read before it is written (`out.under` is the previous
   * answer, which is where the hysteresis lives), so each asker is steady on its own and asking
   * twice at one point answers the same twice. Allocates nothing: the look is one kept object per
   * water shader on the planet.
   */
  cameraUnderwaterAt(p: THREE.Vector3, out: UnderwaterInfo): UnderwaterInfo {
    const swg = this.terrain.swg;
    const dry = !this.planet || !!this.planet.space || this.inside;
    const surface = dry ? -Infinity : this.terrain.waterHeightAt(p.x, p.z);
    const table = dry || !swg ? null : swg.waterTableAt(p.x, p.z);
    const seaDrawn = !dry && !!this.water?.visible;
    const onSea = onSeaSurface(surface, this.terrain.waterLevel, seaDrawn);
    // Is what stands over the point lava? Whichever table the surface belongs to is the one asked:
    // the highest local table covering it, or -- where none wins and the global sea is the surface --
    // the global table itself, which on the lava planet is a flow like all the rest of them.
    const lava = onSea ? this.globalWaterIsLava : !!table && this.lavaTables.size > 0 && this.lavaTables.has(table);
    const ask = waterLineQuery;
    ask.y = p.y;
    ask.surface = surface;
    // The swell only lifts the sea the player is standing over; a lake's own reach is the rule's.
    ask.reach = surfaceReach(onSea, this.waterBodies.swell);
    ask.wasUnder = out.under;
    ask.lava = lava;
    ask.dry = dry;
    underwaterVerdict(ask, out);
    // The reach the verdict was reached with, carried rather than thrown away: the chain draws
    // things that must not appear in the air over a trough, and this is the only measure of how far
    // the drawn surface can stand from the flat one.
    out.reach = out.under ? ask.reach : 0;
    if (out.under) {
      const look = this.waterLookAt(coveringWaterShader(table, lava, surface, this.globalWaterShader));
      if (out.look !== look) {
        out.look = look;
        out.color.set(look.color);
        out.opacity = look.opacity;
      }
    }
    return out;
  }

  /** The camera's own answer this frame, refreshed by `beginWaterFrame` before the scene is drawn. */
  readonly cameraWater: UnderwaterInfo = createUnderwaterInfo();
  /**
   * The point `cameraWater` was last worked out for. Every asker in a frame asks about the same
   * camera, and the answer walks two lists of water tables, so the second and third ask read the
   * record instead of walking them again. It is cleared wherever the water itself changes (a world
   * unloaded, a pack landing), and `beginWaterFrame` works it out afresh every drawn frame in any
   * case, so nothing can be answered from a frame that has been.
   */
  private readonly cameraWaterPoint = new THREE.Vector3(NaN, NaN, NaN);

  /** Forget this frame's camera answer: the next ask works it out again. */
  private forgetCameraWater(): void {
    this.cameraWaterPoint.set(NaN, NaN, NaN);
  }

  /**
   * The camera's record for this point, worked out once however many times it is asked for. Callers
   * read `under` (conservative: reflections, the flare), `submerged` (strict: anything drawn) and
   * `depth`.
   */
  cameraWaterAt(p: THREE.Vector3): UnderwaterInfo {
    if (!this.cameraWaterPoint.equals(p)) {
      this.cameraWaterPoint.copy(p);
      this.cameraUnderwaterAt(p, this.cameraWater);
    }
    return this.cameraWater;
  }

  /**
   * The camera is under a water surface (lakes included): the sky is not seen through it. The
   * conservative answer, which is what the lens flare has always read.
   */
  cameraUnderwater(p: THREE.Vector3): boolean {
    return this.cameraWaterAt(p).under;
  }

  /**
   * How far under the lava over a point it stands: metres below the flow's surface, negative above
   * it, and **-Infinity where the water over the point is not lava at all** -- which is every point
   * on every planet but the one with flows, and is the answer a caller that only wants to know
   * "is this column lava" reads as `Number.isFinite`.
   *
   * This is the one place the question is asked. It used to be written out twice, in the water
   * reader (`waterColumnAt` now, which `footSurfaces.waterTop` and the player's swim both read
   * through) and in the ripple emitter, each as the same pair of terms; a third copy for the harm is
   * how three of them would drift apart. `lavaHarmMath.ts` turns the depth into a
   * verdict (`inLava` for a body, `rideOverLava` for something hovering) and the margins are there
   * rather than here.
   *
   * Which table is asked is `cameraUnderwaterAt`'s reading and not the looser one the two callers
   * had: the highest local table covering the point when that table is what the surface here really
   * is, and the global sea itself where none of them wins. On every planet converted today that is
   * exactly what the old pair answered -- the only planet with flows has no global table and no
   * table standing under one -- so nothing the feet or the rings do moves.
   *
   * Allocates nothing, and on a planet with no lava at all it is two loads and a compare.
   */
  lavaAt(x: number, y: number, z: number): number {
    const terrain = this.terrain;
    if (!terrain) return -Infinity;
    const swg = terrain.swg;
    // Nothing here is a flow: the cheapest possible answer, and the one every other planet takes.
    if (!swg || (!this.lavaTables.size && !this.globalWaterIsLava)) return -Infinity;
    const level = terrain.waterLevel;
    const table = swg.waterTableAt(x, z);
    if (table && table.height > level) return this.lavaTables.has(table) ? table.height - y : -Infinity;
    return this.globalWaterIsLava && Number.isFinite(level) ? level - y : -Infinity;
  }

  /** The global water table's shader on this planet, or null; set by applySwgWater, cleared by unload. */
  private globalWaterShader: string | null = null;
  /**
   * The global table itself is lava. `applySwgWater` reads the local tables one by one and skips the
   * lava ones, but nothing read the global table the same way: on the lava planet the whole sea is a
   * flow, and without this the eye below it would be taken for swimming. The same reading every
   * other lava table gets (`isLavaWater`), with no terrain water type of its own to offer.
   */
  private globalWaterIsLava = false;
  /** One look per water shader on this planet, so asking what the water over a point looks like allocates nothing. */
  private readonly waterLooks = new Map<string, WaterLook>();

  private waterLookAt(shader: string | null): WaterLook {
    const key = shader ?? '';
    let look = this.waterLooks.get(key);
    if (!look) {
      look = this.waterBodies.lookFor(shader, this.planet);
      this.waterLooks.set(key, look);
    }
    return look;
  }

  /**
   * The lights the frame was drawn with, as the effects read them: the world pass's (the sky's set)
   * and the interior pass's (the rooms'), each room lamp with the cell it came from. Call it after
   * the scene is drawn, so the shadow matrices are this frame's. The caller adds the flash pool and
   * the torch. Allocates nothing.
   */
  fillFxLights(out: FxLights): void {
    resetFxLights(out);
    const sky = out.sky;
    sky.hemiSky.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
    sky.hemiGround.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity);
    sky.hemiSkyLuminance = luminanceOf(this.hemi.color, this.hemi.intensity);
    sky.hemiGroundLuminance = luminanceOf(this.hemi.groundColor, this.hemi.intensity);
    setDirectional(sky.fill, this.fill);
    const csm = this.csm;
    if (csm && csm.lights.length) {
      // The plain sun is hidden once the cascades exist; they carry its colour and intensity.
      const l = csm.lights[0];
      const on = l.visible && l.intensity > 0;
      sky.sun.direction.copy(csm.lightDirection).negate().normalize();
      sky.sun.color.copy(l.color).multiplyScalar(on ? l.intensity : 0);
      sky.sun.luminance = on ? luminanceOf(l.color, l.intensity) : 0;
      const cam = this.camera;
      if (this.renderer && cam) fillCascades(sky.cascades, this.renderer, csm.lights, csm.breaks, Math.min(cam.far, csm.maxFar) - cam.near, csm.fade);
    } else {
      setDirectional(sky.sun, this.sun);
    }
    const lit = this.interiorLightsFor;
    if (!lit || !(this.interiorAmbient.intensity > 0)) return;
    const rooms = out.rooms;
    rooms.lit = true;
    rooms.building = lit.building;
    rooms.cell = lit.cell;
    rooms.ambient.copy(this.interiorAmbient.color).multiplyScalar(this.interiorAmbient.intensity);
    rooms.ambientLuminance = luminanceOf(this.interiorAmbient.color, this.interiorAmbient.intensity);
    setDirectional(rooms.parallel, this.interiorParallel);
    for (let i = 0; i < this.interiorPoints.length; i++) rooms.pointCount = addPointLight(rooms.points, rooms.pointCount, this.interiorPoints[i], this.fxLampCells[i]);
  }

  /** The cell each pooled room lamp was lit from (-1 unlit), written by updateInteriorLights as it hands the lamps out; read by fillFxLights. */
  private readonly fxLampCells: number[] = new Array(INTERIOR_LIGHT_CAP).fill(-1);

  /**
   * Before the frame is drawn: which water is worth drawing, whether the camera is inside the
   * swell, and whether the effects' reflections take the water's environment term over this frame.
   * The lit water and the reflections pass must agree, so the one decision is taken here.
   */
  beginWaterFrame(camera: THREE.PerspectiveCamera, reflectionsWanted: boolean): void {
    // Worked out here, once, for the whole frame: `drawFrame` asks the same record again for the
    // flare and for the chain and finds it already filled.
    this.forgetCameraWater();
    const under = this.cameraWaterAt(camera.position).under;
    const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0;
    this.waterBodies.beginFrame(camera, under, fog, reflectionsWanted);
  }

  /**
   * How bright a static per-shader reflection cube may be at this hour: the sky's clear colour
   * against the brightest it ever gets. Only matters while the water reflects its own cubes.
   */
  private waterEnvLight(): number {
    if (this.planet?.space) return 1;
    const sky = this.swgSky;
    if (sky) {
      const c = sky.lighting.clear;
      return envLightFrom(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, sky.clearPeakLuminance());
    }
    return 0.15 + 0.85 * this.day.daylight;
  }

  private applyLighting(): void {
    const d = this.day.daylight;
    const u = this.sky.material.uniforms;
    u.uSun1.value.copy(this.day.sunDir);
    u.uSun2.value.copy(this.day.sunDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12).setY(this.day.sunDir.y * 0.8).normalize();
    u.uMoon.value.copy(this.day.moonDir);
    u.uDay.value = d;
    u.uSunset.value = this.day.sunset;

    const night = this.day.sunDir.y <= 0.02;
    this.sun.color.copy(night ? this.moonColor : this.sunColor);
    if (!night) this.sun.color.lerp(new THREE.Color(0xff9a4a), Math.min(1, this.day.sunset * 0.8));
    this.sun.intensity = night ? 0.4 : this.planet.light.sunIntensity * (0.1 + 0.9 * d);
    if (this.csm) {
      for (const l of this.csm.lights) {
        l.color.copy(this.sun.color);
        l.intensity = this.sun.intensity;
      }
    }
    this.hemi.intensity = this.planet.light.ambientIntensity * (0.2 + 0.8 * d);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.nightFog).lerp(this.dayFog, d);
    fog.color.lerp(new THREE.Color(0xd08a5a), this.day.sunset * 0.35 * d);
  }

  private stream(center: THREE.Vector3, budget: number): void {
    // Space has no ground: none is built, and none fills the lower half of the view from three kilometres down.
    if (this.planet.space) return;
    const pcx = Math.floor(center.x / CHUNK_SIZE);
    const pcz = Math.floor(center.z / CHUNK_SIZE);
    if (pcx === this.lastCx && pcz === this.lastCz && budget !== Infinity) return;

    const wanted: { cx: number; cz: number; d: number }[] = [];
    const R = this.viewRadius;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const key = `${pcx + dx},${pcz + dz}`;
        if (!this.chunks.has(key)) wanted.push({ cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    const sync = budget === Infinity;
    for (const w of wanted) {
      if (made >= budget) break;
      // With SWG terrain the pole grids come from a worker; skip until they arrive.
      if (!this.terrain.prepareChunk(w.cx, w.cz, sync)) continue;
      this.createChunk(w.cx, w.cz);
      made++;
    }
    if (wanted.length <= made) {
      this.lastCx = pcx;
      this.lastCz = pcz;
    }
    this.terrain.evict(center, this.viewRadius + 2);
    let changed = made > 0;

    for (const [key, c] of this.chunks) {
      const far = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (far > this.viewRadius + 1) {
        this.disposeChunk(c);
        this.chunks.delete(key);
        changed = true;
      } else if (far <= PHYSICS_RADIUS) {
        this.addChunkPhysics(c);
      } else {
        this.removeChunkPhysics(c);
      }
    }
    if (changed) for (const t of this.farTiles.values()) this.refreshFarTile(t);
  }

  /**
   * Coarse far tiles overlap the detailed chunks and, on cliffs, poke through them. Drop the
   * quads of a far tile that lie under loaded chunks so only one ground ever shows.
   */
  private refreshFarTile(tile: THREE.Mesh): void {
    const u = tile.geometry.userData as { fullIndex?: ArrayLike<number>; n: number; ox: number; oz: number; step: number };
    if (!u.fullIndex) return;
    const { fullIndex, n, ox, oz, step } = u;
    const out: number[] = [];
    for (let j = 0; j < n; j++) {
      const cz = Math.floor((oz + (j + 0.5) * step) / CHUNK_SIZE);
      for (let i = 0; i < n; i++) {
        const cx = Math.floor((ox + (i + 0.5) * step) / CHUNK_SIZE);
        if (this.chunks.has(`${cx},${cz}`)) continue;
        const q = (j * n + i) * 6;
        for (let k = 0; k < 6; k++) out.push(fullIndex[q + k]);
      }
    }
    tile.geometry.setIndex(out);
  }

  private streamFar(center: THREE.Vector3, budget: number): void {
    if (this.planet.space) return;
    const ptx = Math.floor(center.x / FAR_TILE);
    const ptz = Math.floor(center.z / FAR_TILE);
    if (ptx === this.lastTx && ptz === this.lastTz && budget !== Infinity) return;
    const wanted: { tx: number; tz: number; d: number }[] = [];
    const R = this.farRadius;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (!this.farTiles.has(`${ptx + dx},${ptz + dz}`)) wanted.push({ tx: ptx + dx, tz: ptz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    for (const w of wanted) {
      if (made >= budget) break;
      const geometry = this.terrain.buildFarTile(w.tx, w.tz, FAR_TILE, FAR_RES, budget === Infinity);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.groundMaterial);
      mesh.receiveShadow = true;
      this.chunkRoot.add(mesh);
      this.farTiles.set(`${w.tx},${w.tz}`, mesh);
      this.refreshFarTile(mesh);
      made++;
    }
    if (wanted.length <= made) {
      this.lastTx = ptx;
      this.lastTz = ptz;
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (Math.max(Math.abs(tx - ptx), Math.abs(tz - ptz)) > this.farRadius + 1) {
        this.chunkRoot.remove(t);
        t.geometry.dispose();
        this.farTiles.delete(key);
        this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
      }
    }
  }

  private createChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const { geometry, heights } = this.terrain.buildChunk(cx, cz);
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    const exclude = this.layoutStream ? [...this.exclusions, ...this.layoutStream.exclusionsFor(cx, cz)] : this.exclusions;
    // The planet's own flora replaces the procedural props once its models are loaded.
    const { group: propGroup, colliders } = this.flora ? this.flora.buildForChunk(cx, cz, (x, z) => this.terrain.heightAt(x, z), exclude) : this.props.buildForChunk(cx, cz, this.terrain, exclude);
    propGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.computeBoundingSphere();
    });
    group.add(propGroup);
    this.chunkRoot.add(group);
    this.chunks.set(key, { key, cx, cz, group, colliders, heights, physics: null });
    const b = this.groundHiddenFor;
    if (b) {
      const r = b.radius + 2;
      if (b.x + r > cx * CHUNK_SIZE && b.x - r < (cx + 1) * CHUNK_SIZE && b.z + r > cz * CHUNK_SIZE && b.z - r < (cz + 1) * CHUNK_SIZE) {
        group.visible = false;
        this.hiddenGround.push(group);
      }
    }
  }
}

/** Yaw of a w,x,y,z quaternion: the heading of its forward vector, as the client uses for terrain layers. */
function yawOf(q: number[]): number {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}
