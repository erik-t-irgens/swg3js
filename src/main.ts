import * as THREE from 'three';
const torchDir = new THREE.Vector3();
import { BountyHunterKit } from './combat/bountyHunter';
import { Effects } from './combat/effects';
import { JediKit } from './combat/jedi';
import type { ClassId, Kit, KitContext } from './combat/kit';
import { ThirdPersonCamera } from './core/camera';
import { PortalRenderer } from './world/portalRender';
import { Input, type Action } from './core/input';
import { Physics } from './core/physics';
import { PLANETS, packIdOf, planetBelow, planetById, spaceZoneOf, type PlanetDef } from './data/planets';
import { DEFAULT_SABER_COLOR, Player } from './player/player';
import { SaberMarks } from './combat/saberMarks';
import { collectBlades, lightAt, litCeiling, type LitSources } from './combat/bladeLights';
import { createBladeList } from './core/fx/bladeList';
import { BLADE_GLOW_TUNE, segmentDistanceSq, type BladeGlowTune } from './core/fx/bladeGlowMath.ts';
import { BLADE_GLOW_VIEWS, type BladeGlowPass } from './core/fx/bladeGlow';
import { SSAO_TUNE_DEFAULTS, type SsaoPass } from './core/fx/ssao';
import { SSAO_BASE_POWER } from './core/fx/ssaoMath.ts';
import type { FighterGlow } from './world/npcs';
import { loadPlayerRig } from './player/rig';
import { Character, loadSpeciesIndex, type SpeciesEntry } from './player/character';
import { GalaxyMap, type Poi } from './ui/galaxyMap';
import { MapUi } from './ui/mapUi';
import { WardrobeUi } from './ui/wardrobeUi';
import { WeaponsUi } from './ui/weaponsUi';
import { BackpackUi, type BackpackCell } from './ui/backpackUi';
import { Equipment } from './player/equipment';
import { itemInfo, WEAPON_ORDER, type ItemContext } from './player/items';
import { OFF_HAND_CLASSES, normalizeOwned, slotRank, slotWords, speciesWords } from './core/inventory';
import { ForceUi } from './ui/forceUi';
import { DEFAULT_LOADOUT, POWERS } from './combat/forcePowers';
import { DEFAULT_GADGETS, GADGETS } from './combat/gadgets';
import { RAGDOLL } from './combat/ragdoll';
import { WeaponCatalogue, type WeaponDef } from './player/weapons';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Hud } from './ui/hud';
import { specFor, type DriveInput } from './vehicles/vehicle';
import { interceptTime, leadPoint } from './combat/intercept';
import { PostFX, type FxFrameInput, type SunInfo } from './core/postfx';
import { fxPassDef, isFxSettingKey, type FxPassId } from './core/fxRegistry.ts';
import { installEffects } from './core/fx/install';
import { addPointLight, createFxLights, setSpotLight } from './core/fx/lights';
import { createCloudLayers, createSkyLights, flareLook, tuneFlareLook } from './core/fx/lensFlare';
import { MAX_CLOUD_LAYERS, MAX_FLARE_SOURCES } from './core/fx/flareMath';
import { SPACE_SKY_TUNE, tuneSpaceSky, type SunRule } from './space/suns';
import { heatTuning, type HeatProduct } from './core/fx/heat';
import { FIGURE_SPHERE, followDepth, measureLocalSphere, type FxMoverList, type LocalSphere, type VelocityProduct } from './core/fx/velocity';
import { MOTION_TUNING, MOVER_LIMITS } from './core/fx/velocityMath.ts';
import type { MotionBlurPass } from './core/fx/motionBlur';
import { HeatSources, plumeNoiseFrequency } from './world/heatSources';
import { MobileAssets } from './world/mobiles/assets';
import { vehiclePlumes } from './vehicles/enginePlumes';
import { Notice } from './ui/notice';
import { VehiclesUi } from './ui/vehiclesUi';
import { ShipEditUi } from './ui/shipEditUi';
import { DROID_SHOWN, DROID_SHOWN_BY_HULL, droidShown, droidSink, fitKey, packFit, partsOf, slotLabel, stockFit, type ResolvedFit, type ShipFit } from './vehicles/shipFit';
import { NpcUi } from './ui/npcUi';
import { CATALOGUE_COMMAND } from './world/mobiles/catalogue';
import { ambientOverrides, lookBounds, spawnDistance } from './world/mobiles/spawning';
import { AppearanceUi } from './ui/appearanceUi';
import { CharacterSelect } from './ui/characterSelect';
import { CreatorBar } from './ui/creatorBar';
import { Menu, keyName } from './ui/menu';
import { ShipMenu, type ShipCruise, type ShipStatus } from './ui/shipMenu';
import { Docking } from './space/docking';
import { CLAMP_TUNE, DOCK_TUNE } from './space/dockingMath';
import { HyperspaceUi } from './ui/hyperspaceUi';
import { Hyperspace } from './space/hyperspace';
import { CRUISE_KEY, CRUISE_TUNE, Cruise, tuneCruise } from './space/cruise';
import { HyperspaceTunnel } from './space/hyperspaceTunnel';
import { ShipHud } from './ui/shipHud';
import { TargetFx } from './space/targetFx';
import { FACTION_COLOR, FACTION_LABEL, shipStanding, type ShipFaction } from './space/factions';
import { NpcBrain } from './space/npcBrain';
import { MOUSE_FLIGHT, aimCursor, circleRadius, coneClamp, flightTune, gunAim, hullRay, insideCircle, moveCursor, ringRadius, stickFromCursor, type Cursor, type FlightStick, type FlightTuneInput } from './space/mouseFlight';
import { ZONE_TIER } from './space/roster';
import { fillTaunt, pickLine } from './space/taunts';
import { componentLine } from './space/shipStats';
import { targetable } from './space/shipCombat';
import type { ShipSpawner } from './ui/npcUi';
import { HyperspaceCatalogue, arrivalAt, landmarksOf, loadSpacePack, type Destination } from './space/spaceData';
import { TUNNEL_TIMES, arrivalPose, jumpChaseBack, lookRotation, sceneOf, toGame, tunnelCameraFar, tunnelSize } from './space/hyperspaceMath';
import { LiftMenu } from './ui/liftMenu';
import { stopLabel, type LiftStop } from './world/lifts';
import { draggable } from './ui/drag';
import { LoadingScreen } from './ui/loading';
import { EmoteWheel } from './ui/emoteWheel';
import { Net, type Hello, type PeerVehicle } from './net/net';
import { applyAppearance, dress, packLook } from './player/look';
import { RemotePlayers } from './net/remotePlayers';
import { danceOf, defaultEmotes, emoteChoices, FLOURISHES, isDanceClip, isFlourishClip, loadEmotes, loopsEmote, saveEmotes } from './core/emotes';
import { loadSettings, type Settings } from './core/settings';
import { deleteCharacter, loadCharacters, newCharacterId, upsertCharacter, type Appearance, type SavedCharacter } from './core/characters';
import { FRAME_NUDGE, Garage, type VehicleDef } from './vehicles/garage';
import { WINGS_KEY, WING_RULE, dropPilotChoices } from './vehicles/wings';
import { CUT_ENGINES_KEY, LANDING, SHIP_GROUND, SHIP_ROOM, SPACE_LANDING } from './vehicles/landing';
import { SURFACE_ROOM, SurfaceRoom, isSurfaceRoom, probeSurface, roomFrame, roomTurn } from './vehicles/surfaceRoom';
import type { Vehicle, VehicleKind } from './vehicles/vehicle';
import { HEAD_TO_EYE, SEATED_EYE_FALLBACK, SEAT_RULE, cockpitYawStep, frameFileName, mirroredOffset, seatDropUsed } from './vehicles/cockpitSeat';
import { World } from './world/world';
import { AudioSystem, type ListenerPose } from './audio/audio.ts';
import { OUTSIDE, type SoundSpace } from './audio/distance.ts';
import type { AmbienceTune } from './audio/ambience.ts';
import type { WorldSourceTune } from './audio/emitters.ts';
import { BodySounds, type BodyLists, type FootTune, type PlayerBody } from './audio/footsteps.ts';
import { sabers } from './audio/saberSounds.ts';
import { CLIP_EVENT_TUNE, type ClipEventTune } from './audio/clipEvents.ts';
import { FAMILY_TUNE } from './world/terrain';
import { RoomAir, type RoomAirDebugOptions, type RoomAirInput } from './world/roomAir';
import { RANGE } from './world/gallery';
import { castsShadow, surfaces } from './world/surfaces';

/** The keys for the vehicle ridden, by its kind. */
function mountPrompt(v: import('./vehicles/vehicle').Vehicle, wingsKey: string = WINGS_KEY): string {
  const k = v.spec.kind;
  const bar = (f: number) => '▮'.repeat(Math.round(f * 8)) + '▯'.repeat(8 - Math.round(f * 8));
  const boost = v.spec.boost === 'heat' ? ` · <b>Shift</b> boost · heat ${bar(v.meter)}${v.overheated > 0 ? ' BURNT OUT' : ''}` : v.spec.boost === 'burst' ? ` · <b>Shift</b> boost ${bar(v.meter)}` : '';
  const hop = v.spec.hop ? ' · <b>Space</b> hop' : '';
  const fly = v.spec.fly ? ' · look up/down or <b>Space</b>/<b>X</b> to climb and sink' : '';
  if (k === 'ship') {
    // Down on the ground: what gets it up again, and why a put-down was refused.
    if (v.landed) return `${v.space ? 'set down · <b>W</b> lifts off along the surface' : 'landed · <b>W</b> or <b>Space</b> lifts off'} · <b>E</b> leave${v.space ? ' (the boots take hold of what it stands on)' : ''}${v.landNote ? ` · ${v.landNote}` : ''}`;
    if (v.holding) return 'setting down…';
    // Hovering, the ship is a VTOL: it holds still until the throttle opens, rises and sinks on the keys, slides sideways. In flight the mouse flies it.
    const down = SHIP_GROUND.rule === 'landing' ? ` · <b>Ctrl</b> brings it down, held at the bottom to set it down · <b>${keyName(CUT_ENGINES_KEY)}</b> cuts the engines` : '';
    // Out in space there is no ground: the same key sets the hull down on whatever it has come to a stop over.
    const setDown = v.space && SHIP_GROUND.rule === 'landing' ? (v.setDownNear ? ` · <b>${keyName(CUT_ENGINES_KEY)}</b> sets it down on what is under you` : Math.abs(v.speed) <= SPACE_LANDING.speed ? ' · nothing under it to set down on' : '') : '';
    const hover = `<b>W</b> throttle up into flight · mouse turns · <b>Space</b>/<b>Ctrl</b> rise and sink · <b>A/D</b> slide${v.space ? setDown : down}`;
    // Stopped in the air the ship holds its height, so the way down belongs on the flight line too.
    const flight = `<b>W</b>/<b>S</b> throttle up and down · mouse: in the circle aims the guns, out of it keeps turning the ship · <b>A/D</b> roll · <b>Space</b>/<b>X</b> pitch${v.powered ? '' : ' · <b>ENGINES CUT</b>'}${v.space ? setDown : Math.abs(v.speed) < 2 ? down : ''}`;
    // A ship whose wings open: the wings key and which way a press would take the pilot's choice; an open chosen while a
    // low wing waits for room says so.
    const wings = v.wings.length ? ` · <b>${keyName(wingsKey)}</b> ${v.wings.chosen ? 'close' : 'open'} the wings${v.wings.pilot && !v.wings.target ? ' (they open with room under them)' : ''}` : '';
    return `<b>E</b> leave · ${v.airborne ? flight : hover} · <b>wheel</b> zoom, all the way in for the cockpit · <b>Alt</b> look around${v.guns.length ? ' · <b>click</b> fires · <b>Tab</b> next target' : ''}${wings} · <b>Shift</b> burn · ${v.airborne ? 'flying' : 'hovering'} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h${v.hp < v.maxHp ? ` · hull ${Math.round((v.hp / v.maxHp) * 100)}%` : ''}${v.landNote ? ` · ${v.landNote}` : ''}`;
  }
  const turn = k === 'ground' ? 'mouse or <b>A/D</b> turn' : 'mouse or <b>A/D</b> steer';
  const hull = v.hp < v.maxHp ? ` · hull ${Math.round((v.hp / v.maxHp) * 100)}%${v.hp / v.maxHp < 0.34 ? ' LIMPING' : v.hp / v.maxHp < 0.67 ? ' smoking' : ''}` : '';
  return `<b>E</b> dismount · <b>W/S</b> throttle · ${turn} · <b>Alt</b> look around${boost}${hop}${fly} · ${k} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h${hull}`;
}

const MOUNT_RANGE = 3.6;
type InventoryTab = 'backpack' | 'wardrobe' | 'appearance' | 'weapons' | 'force';
/** The camera pitch a flyer holds its height at: the default view, a little above level. */
const CAMERA_REST_PITCH = 0.32;

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0, triangles: 0, pack: '', terrain: '', chunks: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const roomLightSpots: import('./vehicles/interior').RoomLight[] = [];
/** Handed to the feet where a manager has no list yet, so no frame makes an empty array of its own. */
const EMPTY_BODIES: readonly never[] = [];
/** The fighters' glows the pool is asked for when the effects do not light the blades: the nearest two, within 25 m of the camera. */
const FIGHTER_GLOW_RANGE = 25;
const npcGlow: FighterGlow[] = [0, 1].map(() => ({ pos: new THREE.Vector3(), color: 0, d2: 0 }));
/** How near the controls in a ship's bridge E takes them, metres in the hull's frame. */
const CONTROLS_RANGE = 2.5;
/**
 * A ship's guns: seconds between shots of one gun, their damage, the bolt's speed (m/s) and range
 * (m) for a ship whose manifest names no weapon (the weapon table's light blaster), how far off
 * the nose a target may sit for the guns to lead it (rad), and how far off to be picked at all.
 */
const SHIP_GUN_INTERVAL = 0.55;
const SHIP_GUN_DAMAGE = 45;
const SHIP_BOLT_SPEED = 600;
const SHIP_BOLT_RANGE = 512;
const SHIP_GUN_CONE = THREE.MathUtils.degToRad(12);
const SHIP_TARGET_CONE = THREE.MathUtils.degToRad(70);
const SHIP_TARGET_RANGE = 2500;
/** How high over the ground a ship must climb to be offered space (the sky's ceiling is 1500 m), and how high it arrives back over the planet. */
const SPACE_GATE_HEIGHT = 1100;
const SPACE_ARRIVAL_HEIGHT = 700;
/** Where someone stood in a ship's rooms as it crossed between a planet and space: in the hull's frame, facing this way, at the controls or not. */
interface ShipCrew {
  local: THREE.Vector3;
  heading: number;
  piloting: boolean;
}
/** A ship carried across: spawned again over the arrival point at `height`, launched at `speed`, its crew put back. */
interface ShipCrossing {
  def: VehicleDef;
  speed: number;
  height: number;
  crew?: ShipCrew | null;
  /** Where the ship comes out and which way it faces (game frame), instead of over the spawn at heading π. */
  arrival?: { pos: THREE.Vector3; quaternion: THREE.Quaternion } | null;
  /** The ship's fight as it left (shields, armour, chassis, parts down, boost, as shares), put on the new hull once it is adopted; null or absent: whole. */
  condition?: import('./space/shipCombat').CarriedCondition | null;
}
const tmp2 = new THREE.Vector3();
/** Scratch for the gravity boots' look round for something to stand on: the ways looked and the best of them. */
const bootScratch = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => new THREE.Vector3());
const bootDir: THREE.Vector3[] = [];
const bootAt = new THREE.Vector3();
const bootPoint = new THREE.Vector3();
const bootUp = new THREE.Vector3();
let bootBody: import('@dimforge/rapier3d-compat').RigidBody | null = null;
const boltFrom = new THREE.Vector3();
/** A ship's shot: where it leaves and which way (bolts.fire and effects.flash copy what they are given). */
const shotFrom = new THREE.Vector3();
const shotDir = new THREE.Vector3();
/** A target's share as a whole percentage, or a dash where it has none (the target box's label). */
function targetPct(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '–';
}

/** A kept ship fit copied, so a change is made on the copy and handed to saveFit whole. */
function copyShipFit(f: ShipFit): ShipFit {
  return { components: { ...f.components }, paint: { ...f.paint }, ...(f.droid ? { droid: f.droid } : {}) };
}

class App {
  private torch!: THREE.SpotLight;
  private torchOn = false;
  private lastPrograms = 0;
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly ui = document.getElementById('ui') as HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam: ThirdPersonCamera;
  private readonly input: Input;
  private readonly world: World;
  private readonly player: Player;
  private readonly effects: Effects;
  /** The burns lit lightsabers leave on what they touch. */
  private readonly marks = new SaberMarks();
  private readonly bladeSegments = [0, 1, 2].map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }));
  private readonly markPoint = new THREE.Vector3();
  private readonly markNormal = new THREE.Vector3();
  /** Console: give the blades their pooled flash lights back while the glow pass is on, to compare. */
  private bladeGlowFlashes = false;
  /** __debug.fpHead(true/false) holds the head hidden or shown whatever the camera; null follows it. */
  private fpHeadForce: boolean | null = null;
  private kit!: Kit;
  private readonly hud: Hud;
  private readonly map: MapUi;
  private readonly wardrobe: WardrobeUi;
  private readonly weaponsUi: WeaponsUi;
  private readonly forceUi: ForceUi;
  private readonly vehiclesUi: VehiclesUi;
  /** A ship's edit page, opened from the garage's edit button (components, droid and paint). */
  private readonly shipEdit: ShipEditUi;
  /** The garage as it loads, so the panel, the edit page and the console share one load. */
  private garageLoading: Promise<Garage> | null = null;
  /** The ship whose fit the last hello carried ('' none): a change of ship sends the hello again. */
  private helloShipId = '';
  /** Garage ids being prepared for a spawn: a second press waits for the first. */
  private readonly spawning = new Set<string>();
  /** The debounced write of the ships' fits (the edit page saves on every change). */
  private fitSaveTimer = 0;
  /** Each spawned ship's refit in flight: the next waits for it, so two never stage from the same fit. */
  private readonly refitting = new Map<Vehicle, Promise<unknown>>();
  private garage: Garage | null = null;
  private npcUi: NpcUi;
  private appearanceUi: AppearanceUi;
  private characterId = 'human_male';
  private speciesList: SpeciesEntry[] = [];
  private breakFrames = false;
  private inventoryTab: InventoryTab = 'backpack';
  /** What the character owns, wears and holds, and the one way anything goes on or in hand (the backpack, the give tabs, the console). */
  private readonly equipment: Equipment;
  /** The backpack panel, the inventory's first tab. */
  private readonly backpack: BackpackUi;
  /** The weapons rack as it loads (null when none is converted); the equipment waits on it. */
  private weaponsLoaded!: Promise<WeaponCatalogue | null>;
  /** The hello resend after a change of clothes or weapon, debounced so several pieces send one. */
  private helloTimer = 0;
  private spawnerTab: 'garage' | 'npcs' = 'garage';
  private weapons: WeaponCatalogue | null = null;
  private readonly fade: HTMLElement;
  private readonly death: HTMLElement;
  private readonly select: CharacterSelect;
  private readonly creatorBar: CreatorBar;
  private readonly menu: Menu;
  private readonly shipMenu: ShipMenu;
  /**
   * Docking at a station: the lane asked for from the ship menu, flown by its own autopilot. Made in
   * the constructor beside the menu it belongs to, since the world it reads is made there first.
   */
  private readonly docking: Docking;
  /**
   * The ultra cruise, for the ship menu's own row. Whatever owns the cruise sets it; until something
   * does, the row says the cruise is not built.
   */
  cruiseControl: ShipCruise | null = null;
  /** The ultra cruise itself: a straight run at kilometres a second, only where a system is big enough for one. */
  private readonly ultraCruise: Cruise;
  /** The System Map (the destinations of a jump) and the countdown line. */
  private readonly hyperspaceUi: HyperspaceUi;
  /** The jump: its countdown, its phases, and the hull it flies. */
  private readonly hyperspace: Hyperspace;
  /** The tunnel the jump flies through (one mesh for the session, in the scene hidden). */
  private readonly jumpTunnel: HyperspaceTunnel;
  /** The hull whose rooms the player stood in as the jump began: kept aboard it until the jump ends. */
  private jumpCrew: Vehicle | null = null;
  /** The zoom the pilot had before the jump's view took it (put back after), and the camera's far plane while the tunnel hides the world. */
  private jumpZoomKept: number | null = null;
  private jumpFarKept: number | null = null;
  private jumpTunnelFar = 0;
  /** Every space zone's pack and destinations, fetched on the first opening of the System Map (or the first `__debug.jumps`). */
  private hyperspaceCatalogue: Promise<HyperspaceCatalogue> | null = null;
  /** The same catalogue once it has arrived, for the jump's own reads (null until then). */
  private loadedCatalogue: HyperspaceCatalogue | null = null;
  private readonly liftMenu: LiftMenu;
  private readonly loadingScreen: LoadingScreen;
  private readonly emoteWheel: EmoteWheel;
  /** Playing together: the relay's client and the other players it tells of. */
  private readonly net = new Net();
  private readonly remotes: RemotePlayers;
  private netStatus = 'off';
  private lastStateSent = 0;
  /** The wheel's eight slots, clip names; filled from the rig's own emotes the first time. */
  private emotes: (string | null)[] = loadEmotes();
  /** An emote is playing on the player: any movement ends it. */
  private emoting = false;
  /** The dance loop playing, kept so a flourish (the number keys) goes back to it when it ends. */
  private dance: string | null = null;
  /** The ship the pilot's guns lead (Tab cycles the ships ahead), and this frame's lead point and the way to aim for it. */
  private shipTarget: Vehicle | null = null;
  private readonly shipLead = new THREE.Vector3();
  private readonly shipAim = new THREE.Vector3();
  private shipLeadValid = false;
  /**
   * Mouse flight (space/mouseFlight.ts): the cursor the mouse moves under pointer lock, in half-heights from the hull's
   * boresight, which stays where it is left; the stick it asks for; the flown hull it was started for (another hull, the
   * ground or a loose pointer puts it back in the middle).
   */
  private readonly flightCursor: Cursor = { x: 0, y: 0 };
  private readonly flightStick: FlightStick = { x: 0, y: 0, turn: 0 };
  private flightCursorOf: Vehicle | null = null;
  /** The guns aim through the cursor this frame (a ship in flight, the pointer locked, Alt not held). */
  private flightAiming = false;
  /**
   * This frame's aim: the cursor kept to the circle, the pilot's eye it is measured from (world), the ray through it about
   * the hull's nose (world), the nose, how far out the guns cross, and whether it sits on the target's lead.
   */
  private readonly flightAimCursor: Cursor = { x: 0, y: 0 };
  private readonly flightEye = new THREE.Vector3();
  private readonly flightRay = new THREE.Vector3();
  private readonly flightNose = new THREE.Vector3();
  private flightRange = 0;
  private flightOnLead = false;
  /** What the HUD's flight display is handed, kept and refilled; and its scratch for projecting the boresight and the cursor. */
  private readonly flightView = { ox: 0, oy: 0, cx: 0, cy: 0, circle: 0, ring: 0, turn: 0, onLead: false, inside: true };
  private readonly flightShow = new THREE.Vector3();
  private readonly flightShowEye = new THREE.Vector3();
  /** Whether the ship targeted is one that attacks the pilot, as the target effects were last told (they change on a change). */
  private shipTargetHostile = false;
  /** The game's targeting effects on the ship targeted. Made right after the world, whose ship effects it places. */
  private readonly targetFx: TargetFx;
  /** The NPC pilots' comms and the flown ship's condition. Made right after the HUD. */
  private readonly shipHud: ShipHud;
  /** The picture's effects chain, while the Effects setting is on. */
  private postfx: PostFX | null = null;
  /**
   * What gives off heat for the heat haze: the planet's lava tables (World hands them over) and the
   * plume providers. A field initialiser, so it exists before the constructor builds the effects chain.
   */
  private readonly heat = new HeatSources();
  /** The lit blades handed to the effects each frame (declared before fxInput, whose initialiser reads it). */
  private readonly fxBlades = createBladeList();
  /** The frame's lights handed to the effects, refilled in drawFrame (declared before fxInput, whose initialiser reads it). */
  private readonly fxLights = createFxLights();
  /** What the blades' light ceiling reads, kept and refilled each frame; the world and the pool are set in the constructor. */
  private readonly litSources: LitSources = { world: null!, effects: null!, torch: null, eye: new THREE.Vector3() };
  /** What the effects are told about each frame, refilled in drawFrame rather than made again. */
  private readonly fxInput: FxFrameInput = { camera: null as unknown as THREE.PerspectiveCamera, dt: 1 / 60, sun: null, portalView: false, cameraInHull: false, inside: false, aboard: false, space: false, fog: null, daylight: 1, dayIndex: 0, lighting: null, planetId: '', aiming: false, aimAmount: 0, firstPerson: false, orbitDistance: 0, skyLights: createSkyLights(MAX_FLARE_SOURCES), skyLightCount: 0, clouds: createCloudLayers(MAX_CLOUD_LAYERS), cloudCount: 0, cameraUnderwater: false, waterInView: false, blades: this.fxBlades, lights: this.fxLights, room: null, followFar: 0, weather: null };
  private readonly fxSun: SunInfo = { dir: new THREE.Vector3(), color: new THREE.Color(), intensity: 0 };
  /** What the debug mask draws: the player and whatever they ride or are aboard. */
  private readonly fxMaskObjects: THREE.Object3D[] = [];
  /** Work going on in the background: the Effects switch compiling every shader for the other path. */
  private readonly notice = new Notice(this.ui);
  private fxQueued = false;
  private fxBusy = false;
  private fxAgain = false;
  /** The ship last flown, spawned again on arriving in space (or back from it). */
  private lastShipDef: VehicleDef | null = null;
  /** The way between a planet and its space, offered on E: up near the top of the sky, down anywhere in space. */
  private spaceGate: 'up' | 'down' | null = null;
  private readonly settings: Settings = loadSettings();
  /**
   * The mixer. Declared after `settings`, whose value its constructor reads, and assigned at the
   * top of the constructor so anything made later can ask it to play. Its context is made
   * suspended and unlocked on the first press, as browsers require.
   */
  private readonly audio: AudioSystem;
  /**
   * Feet and voices: what every body's own animation marks, what it is standing on, and the sounds
   * its client data gives it. Made with the mixer and handed the world's surfaces once there is a
   * world; it reads the lists below and nothing in the world knows it exists.
   */
  private readonly feet: BodySounds;
  /** The player as the feet see it, refilled each frame rather than made. */
  private readonly footPlayer: PlayerBody = {
    x: 0,
    y: 0,
    z: 0,
    inside: false,
    deck: null,
    space: null,
    dead: false,
    species: '',
    activeClips: (out) => this.player.rig?.activeClips(out) ?? 0,
  };
  /** The three lists handed over each frame; the arrays are the managers' own. */
  private readonly footBodies: BodyLists = { player: null, mobiles: [], fighters: [] };
  /** The planet the feet were last told about, so a travel hands them the new one. */
  private feetPack = '';
  /** The bank's own tables the feet were last given, so the surface table is handed over once. */
  private feetTables: object | null = null;
  /** The listener handed to the mixer each frame, refilled rather than made. */
  private readonly listenerPose: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, space: { building: OUTSIDE.building, cell: OUTSIDE.cell } };
  private readonly listenerDir = new THREE.Vector3();
  private readonly listenerUp = new THREE.Vector3();
  /** The character being played, as kept in this browser; null on the select screen and in the creator. */
  private current: SavedCharacter | null = null;
  /** The creator is up: the appearance and wardrobe panels at full size over no world at all. */
  private creating = false;
  /** A planet is loaded and the loop runs the world; false on the select screen and in the creator, where nothing streams. */
  private inWorld = false;
  private lastPlaceSave = 0;
  private readonly timer = new THREE.Timer();
  private started = false;
  private traveling = false;
  private dying = false;
  /** The last frame's length, for the effects that smear by how far the camera moved in it. */
  private lastDt = 1 / 60;
  private spawn = new THREE.Vector3();
  /** Animation mixers of models shown through the debug hook. */
  private readonly shown: THREE.AnimationMixer[] = [];
  private readonly portals: PortalRenderer;
  /** The air of the room the camera is in (daylight through its doorways, its lamps' glow, dust motes), and what it is told each frame. */
  private readonly roomAir: RoomAir;
  private readonly roomAirInput: RoomAirInput;
  private readonly roomAirBuffer = new THREE.Vector2();
  /** The eye in the world, for the camera's building choice each frame (nothing cloned per frame). */
  private readonly cameraEye = new THREE.Vector3();

  constructor(private readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: true });
    // ?lowfx=1 is the cheap preset for this session; otherwise the settings kept in this browser.
    const lowfx = new URLSearchParams(location.search).get('lowfx') === '1';
    if (lowfx) Object.assign(this.settings, { renderScale: 0.5, shadows: false, effects: false });
    const S = this.settings;
    // The mixer first, so everything built after it can ask for a sound. Its context is made
    // suspended: the browser lets nothing sound until the first press, which the unlock below
    // catches. Until then the beds keep their own clocks and come in where they have reached.
    this.audio = new AudioSystem(import.meta.env.BASE_URL, S);
    this.audio.install();
    // The clip events and every body's client data, fetched once and never awaited: until they
    // land nothing has feet, which is what a game with no sound pack does anyway.
    this.feet = new BodySounds(this.audio, import.meta.env.BASE_URL);
    this.feet.load();
    this.renderer.setPixelRatio(S.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = S.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    World.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.toneMappingExposure = S.exposure;

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.cam.sensitivity = S.sensitivity;
    this.cam.invertY = S.invertY;
    this.cam.baseFov = S.fov;
    this.cam.camera.fov = S.fov;
    this.cam.camera.updateProjectionMatrix();
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, physics);
    // The target effects place the world's ship effects (made in the World constructor).
    this.targetFx = new TargetFx(this.world.shipFx);
    this.world.renderer = this.renderer;
    // The sound of the place: the area's beds, the game's placed sound objects and the loops its
    // particle effects name. The numbering of buildings and boarded hulls is this class's, so that a
    // sound and the ear agree on what counts as the same room.
    this.world.attachAudio(this.audio, (of) => this.spaceIdOf(of));
    // Where the feet ask what they have landed on: the water, the room, the thing stood on and the
    // ground, all of which only the world can say.
    this.feet.attachWorld(this.world.footSurfaces);
    // The blades: the mixer they play through, the clip events that say which frames of a move
    // whoosh (the feet already read them, so the same index is shared rather than fetched twice),
    // and the world, which is asked only what room the ear is in and whether it is raining on the
    // blade or the blade is under water.
    sabers.attach(this.audio, { clips: this.feet.index, world: this.world, baseUrl: import.meta.env.BASE_URL });
    // The lava tables World loads go to the heat haze from here on.
    this.world.heat = this.heat;
    // Plumes the heat haze draws, asked for once a frame from inside the effects chain (after the
    // world is assigned, which the first provider reads): every running engine, and a flame thrower
    // held this frame.
    this.heat.addProvider((sink) => vehiclePlumes(this.world.vehicles, sink));
    this.heat.addProvider((sink) => {
      if (this.kit?.id === 'bounty_hunter') this.hunterKit().heatPlumes(sink, performance.now());
    });
    // Before any planet loads: every water body needs an environment of one size from the moment
    // it exists, or the first real sky map to arrive recompiles its shader mid-play.
    this.world.waterBodies.attach(this.renderer);
    // The effects chain is built only now: the water reflections pass is handed the world's water
    // bodies, so a chain made before the world exists throws on boot.
    if (S.effects) this.postfx = this.makePostFX();
    // The wardrobe and creator dolls take their lens from the same settings (a static, so no panel need exist yet).
    this.syncPreviewEffects();
    // Shaders are warmed for the target the frames are actually drawn into: with the effects on,
    // a program compiled with nothing bound is the wrong variant and is thrown away on first use.
    this.world.compileTarget = () => this.postfx?.compileTarget ?? null;
    // A vehicle (a spawn, a refit's parts, a ship's paint copies, a peer's ride) is prepared by the world
    // and then for the motion blur's variants (the skinned droid needs its own); postfx is read at call time.
    this.world.vehiclePrepare = async (roots) => {
      await this.world.prepareVehicle(roots);
      await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots(roots);
    };
    this.world.userFog = S.fog;
    this.world.normalScale.set(S.normalStrength, -S.normalStrength);
    Character.normalScale.set(S.normalStrength, -S.normalStrength);
    this.world.setShadowLook(S.shadowSoftness, undefined, S.shadowMapSize);
    this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);
    this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
    // The spawner's cap and the creatures' animation range, kept by the world for every planet's manager.
    this.world.setMobileDetail(S.mobileCap, S.mobileAnimRange);
    // The weather's settings (the world made it; the HUD, made below, shows its note from the loop).
    this.world.weather.configure(S);
    // A hand torch: a spot light carried at the camera, pointing where it looks. F toggles it.
    // Always in the scene and visible, turned up and down: a light that comes and goes changes the
    // light count, and that recompiles every shader in the world.
    this.torch = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.45, 1.6);
    this.scene.add(this.torch, this.torch.target);
    this.portals = new PortalRenderer(this.renderer);
    // The cascades exist even with shadows off, so turning them on later in the menu needs no rebuild.
    this.world.attachCamera(this.cam.camera, true, this.portals);
    if (!S.shadows) this.world.setShadowsEnabled(false);
    this.player = new Player(this.scene, physics);
    this.effects = new Effects(this.scene);
    // The ships' muzzle and hit flashes borrow the pool from here on, without waiting for the weapons rack (which sets it again).
    this.world.npcDeps.effects = this.effects;
    // The room's air reads the world, the portal renderer and the player, all assigned above; its
    // motes join the scene now, hidden, so the loading screen's warm-up compiles them.
    this.roomAir = new RoomAir(this.scene, this.world, this.portals, this.settings);
    this.roomAirInput = { dt: 0, camera: this.cam.camera, view: null, cell: null, aboard: null, cameraInHull: false, playerPos: this.player.pos, sun: null, overcast: 0, dust: 0, bufferHeight: 1 };
    this.litSources.world = this.world;
    this.litSources.effects = this.effects;
    this.scene.add(this.marks.mesh);
    this.hud = new Hud(this.ui);
    // The comms and the ship's status line; the world (assigned above) hands the taunts over.
    this.shipHud = new ShipHud(this.ui);
    this.world.ships.onTaunt = (who, text, faction) => this.shipHud.say(who, text, FACTION_COLOR[faction]);
    this.wardrobe = new WardrobeUi(this.ui, () => this.hud.setPrompt(''));
    this.wardrobe.setBaseUrl(import.meta.env.BASE_URL);
    this.weaponsUi = new WeaponsUi(this.ui, (def, hand) => void this.equip(def, hand));
    // The equipment: its deps are closures read only when an operation runs (after the constructor); the
    // one value it holds is the player, assigned above.
    this.equipment = new Equipment({
      character: () => this.player.rig?.character ?? null,
      player: this.player,
      weaponsLoaded: () => this.weaponsLoaded ?? Promise.resolve(null),
      prepare: (root) => this.prepareRoot(root),
      record: () => (this.creating ? null : this.current),
      persist: (c) => {
        upsertCharacter(c);
      },
      changed: (what) => this.onEquipmentChanged(what),
      baseUrl: import.meta.env.BASE_URL,
    });
    // The Skills tab: the Force powers or the gadgets in the number slots, given to the class's kit and kept with the character.
    this.forceUi = new ForceUi(this.ui);
    // The backpack: a double-click uses an item, Destroy (twice) destroys it; its tabs swap the inventory's panels.
    this.backpack = new BackpackUi(this.ui);
    this.backpack.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.backpack.onUse = (key, hand) => void this.useItem(key, hand);
    this.backpack.onDestroy = (key) => void this.destroyItem(key);
    this.forceUi.loadout = [...DEFAULT_LOADOUT];
    this.forceUi.onChange = (loadout) => this.setSkills(this.kit.id, loadout);
    // A blade colour picked on the rack goes on the blades now and into the character's record.
    this.weaponsUi.onSaberColor = (hex) => {
      this.player.setSaberColor(hex);
      if (this.current && !this.creating) {
        this.current.saber = { color: hex };
        upsertCharacter(this.current);
      }
    };
    this.vehiclesUi = new VehiclesUi(this.ui, (def, kind) => void this.spawnVehicle(def, kind), () => this.world.removeVehicles(this.player.mounted ?? this.player.aboard?.vehicle ?? null));
    // The ship's edit page: DOM only here (its preview's WebGL context is made the first time it opens);
    // every dependency is an arrow read at click time, after the constructor.
    this.shipEdit = new ShipEditUi(this.ui, {
      garage: () => this.loadGarage(),
      saved: (id) => this.savedFit(id),
      save: (id, fit) => this.saveFit(id, fit),
      spawn: (def) => void this.spawnVehicle(def),
      closed: (def) => void this.refitSpawned(def),
      // The preview's compile of a garage material the world set up for its shadow cascades must not take the cascades' record from the world's program.
      keepShadows: (mats) => this.world.keepShadowRecords(mats),
    });
    // Each component's stats on the edit page (invented numbers, shipStats.ts); pure, read when the page draws.
    this.shipEdit.statsFor = (slot, c) => componentLine(slot, c);
    this.vehiclesUi.onEdit = (def) => this.openShipEdit(def);
    this.shipEdit.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    // A fit changed in the last 300 ms is written before the page goes.
    window.addEventListener('beforeunload', () => this.flushFits());
    // Docking reads the world only (its pack, what it places and what its dock effects play), and is
    // made before the menu that asks it for its row.
    this.docking = new Docking(this.world);
    this.shipMenu = new ShipMenu(
      this.ui,
      {
        status: () => this.shipStatus(),
        goToSpace: () => void this.goToSpace(),
        land: () => void this.landShip(),
        eject: () => void this.eject(),
        hyperspace: () => this.hyperspaceButton(),
        dock: () => this.dockButton(),
        cruise: () => this.cruiseControl?.toggle(),
      },
      () => keyName(this.input.bindings.ship[0] ?? ''),
    );
    this.shipMenu.onClose = () => this.toggleShipMenu();
    // The System Map and the jump. What these read is assigned above: this.ui (a field initialiser),
    // this.input, this.world, this.cam, this.player, this.scene (a field initialiser, where the tunnel
    // goes); this.postfx may be null and is read with ?. at call time. Neither constructor calls anything
    // on the host, and the catalogue is fetched on the panel's first opening. Assigned here, anyPanelOpen
    // and closePanels (which read hyperspaceUi.open) are safe from now on.
    this.hyperspaceUi = new HyperspaceUi(this.ui, () => keyName(this.input.bindings.ship[0] ?? ''));
    this.hyperspaceUi.onClose = () => this.toggleShipMenu();
    this.hyperspaceUi.onJump = (d) => this.startJump(d);
    // The jump's tunnel, in the scene for the whole session and hidden: every loading screen's compile
    // (settle's compileAllAsync walks hidden objects too) builds its program, so no jump ever does.
    this.jumpTunnel = new HyperspaceTunnel();
    this.scene.add(this.jumpTunnel.mesh);
    this.hyperspace = new Hyperspace({
      zone: () => this.world.planet.id,
      ship: () => this.pilotedShip(),
      alive: (h) => this.world.vehicles.includes(h as Vehicle),
      catalogue: () => this.loadedCatalogue,
      packHere: () => this.world.spaceData,
      placeEffect: (file, local, frame) => this.world.placeZoneEffect(file, local, frame),
      removeEffect: (h) => this.world.removeZoneEffect(h),
      effects: () => this.world.hyperspaceEffects(),
      moveWorld: (to) => this.world.jumpTo(to),
      readyAround: (to, ms) => this.world.readyAround(to, ms),
      settleCarried: (to, envMs, ms) => this.world.settleCarried(to, envMs, ms),
      afterTeleport: (at) => {
        this.cam.release();
        this.postfx?.reset();
        this.spawn.copy(at);
      },
      crossZone: (zone, hull, pose) => this.carryAcross(zone, hull as Vehicle, pose),
      holdCrew: (hull) => {
        // Whoever stands in this hull's rooms as the jump begins is kept aboard until it ends.
        const v = hull as Vehicle | null;
        this.jumpCrew = v && this.player.aboard?.vehicle === v ? v : null;
      },
      keepCrew: () => this.keepJumpCrew(),
      prepareTunnel: () => {
        void this.world.prepareExtras([this.jumpTunnel.mesh]).catch((err) => console.warn('hyperspace: the tunnel could not be prepared', err));
      },
      programs: () => this.renderer.info.programs?.length ?? 0,
      tunnel: {
        attach: (hull) => {
          const back = jumpChaseBack(hull.radius);
          const size = tunnelSize(hull.radius, back, this.jumpTunnel.look);
          this.jumpTunnel.attach(hull.group, size);
          this.jumpTunnelFar = tunnelCameraFar(size, back, hull.radius);
        },
        set: (cover, opening, dt) => {
          this.jumpTunnel.set(cover, opening);
          this.jumpTunnel.step(dt);
        },
        detach: () => {
          this.jumpTunnel.detach();
          this.restoreJumpFar();
        },
      },
      closePanels: () => {
        const was = this.anyPanelOpen() || this.map.open;
        this.closePanels();
        this.map.hide();
        if (was && !this.menu.open) this.freeMouse(false);
      },
      ui: this.hyperspaceUi,
    });
    // The ultra cruise: a straight run at kilometres a second, in a system big enough to need one.
    // It reads the same things the jump does and writes nothing the jump writes, so the two can
    // never both have the hull: each asks whether the other is flying it before it starts.
    this.ultraCruise = new Cruise({
      zone: () => this.world.planet.id,
      packHere: () => this.world.spaceData,
      ship: () => this.pilotedShip(),
      alive: (h) => this.world.vehicles.includes(h as Vehicle),
      jumping: () => this.hyperspace.phase !== 'idle',
      // A jump only counting down has not touched the hull yet, and would not release it if it were
      // called off; from the enter phase on it holds and ghosts the hull itself.
      jumpHasHull: () => this.hyperspace.phase !== 'idle' && this.hyperspace.phase !== 'countdown',
      holdStream: (on) => {
        this.world.streamHold = on;
      },
      note: (text) => this.hud.setPrompt(text),
      readyAround: (at, ms) => this.world.readyAround(at, ms),
      effects: () => this.world.hyperspaceEffects(),
      placeEffect: (file, local, frame) => this.world.placeZoneEffect(file, local, frame),
      removeEffect: (h) => this.world.removeZoneEffect(h),
      programs: () => this.renderer.info.programs?.length ?? 0,
    });
    // The ship menu's own row, which the menu asks for by this shape.
    this.cruiseControl = this.ultraCruise;
    // The lift menu: E in a shaft lists its levels; a pick, or a number key, rides there.
    this.liftMenu = new LiftMenu(this.ui);
    this.liftMenu.onClose = () => {
      this.liftMenu.hide();
      this.freeMouse(false);
    };
    this.liftMenu.onPick = (i) => this.rideLift(i);
    this.npcUi = new NpcUi(this.ui);
    this.appearanceUi = new AppearanceUi(this.ui, () => this.saveAppearance());
    this.appearanceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    // The tabs: a click on the other tab of a panel swaps to it, the key toggles whichever was last open.
    this.wardrobe.onTab = (id) => this.toggleInventory(id as InventoryTab);
    // The Clothes (give) tab dresses through the equipment: the game's slots, the compile before the
    // piece shows, and in the world the piece given. In the creator nothing is given (no record).
    this.wardrobe.onWear = (id) => this.equipment.wear(id, { give: true, force: true }).then((note) => !/cannot|not in|no wardrobe|single model|dropped|could not/.test(note));
    this.wardrobe.onRemove = (parts) => this.equipment.takeOffParts(parts);
    this.weaponsUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.forceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.vehiclesUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    this.npcUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    // Kept as a promise: the equipment waits on it (a weapon restored at play() before the rack is in).
    this.weaponsLoaded = WeaponCatalogue.load(import.meta.env.BASE_URL);
    void this.weaponsLoaded.then((c) => {
      this.weapons = c;
      this.weaponsUi.attach(c);
      this.world.npcDeps.weapons = c;
      this.world.npcDeps.effects = this.effects;
      // Before a fighter is shown: its own shaders, then the motion blur's for its outfit's morph counts.
      this.world.npcDeps.compile = async (objects) => {
        await this.world.compileReady(objects);
        await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots(objects);
      };
      this.world.npcs?.attach(this.world.npcDeps);
      if (c) console.info(`weapons: ${c.weapons.length} on the rack, ${c.skipped.length} left out`);
      // The peers' weapons waiting for the rack go in their hands now (remotes is assigned later in the constructor).
      this.remotes?.refreshHeld();
    });
    const galaxy = new GalaxyMap(
      this.ui,
      (p, zone) => void this.travel(p, zone),
      (p, poi, zone) => void this.teleport(p, poi, zone),
      {
        baseUrl: import.meta.env.BASE_URL,
        piloting: () => !!this.world.planet.space && !!this.pilotedShip(),
        catalogue: () => this.catalogue(),
        why: (d) => this.hyperspace.why(d),
        onHyperspace: (d) => this.jumpFromGalaxy(d),
      },
    );
    // The map window: the world here (the planet's own map, or the space zone in three axes) and the galaxy to travel.
    this.map = new MapUi(this.ui, galaxy, {
      here: () => {
        const planet = this.world.planet;
        const zone = this.zone ? planet.zones?.find((z) => z.id === this.zone) : undefined;
        return { packId: packIdOf(planet, this.zone), name: zone ? `${planet.name}: ${zone.name}` : planet.name, space: !!planet.space };
      },
      player: () => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const at = v ? v.pos : p.worldPos;
        const flying = !!v?.spec.ship && v.airborne && !this.world.planet.space;
        return { x: at.x, y: at.y, z: at.z, heading: v ? v.heading : p.heading, altitude: flying ? at.y - this.world.terrain.heightAt(at.x, at.z) : null };
      },
      center: () => this.world.layoutCenter,
      pois: (id) => galaxy.loadPois(id),
      // The zone's placed things, read once per zone into the list the map owns: its stations and the
      // rest of what it shows are marks from the pack, so only the rocks are wanted here.
      objects: (out) => {
        for (const o of this.world.placedObjects) out.add(o.x, o.y, o.z, o.radius, o.template.includes('spacestation'));
      },
      // The ships, written into the entries the map owns: this runs every frame the map draws, so it
      // makes no array, no quaternion and no label of its own.
      ships: (() => {
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const labels = new Map<string, string>();
        return (out: import('./ui/spaceMapLayers.ts').ShipList) => {
          const p = this.player;
          const mine = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
          // On foot (adrift), the player is the mark the view follows.
          if (!mine) {
            const at = p.worldPos;
            if (p.eva) q.copy(p.evaFrame);
            else q.setFromAxisAngle(up, p.heading);
            out.add(at.x, at.y, at.z, q.x, q.y, q.z, q.w, true, 'you');
          }
          for (const v of this.world.vehicles) {
            if (!v.spec.ship) continue;
            v.quaternion(q);
            const isMine = v === mine;
            let label = labels.get(v.spec.label);
            if (!label) {
              label = `a ship (${v.spec.label})`;
              labels.set(v.spec.label, label);
            }
            out.add(v.pos.x, v.pos.y, v.pos.z, q.x, q.y, q.z, q.w, isMine, isMine ? 'your ship' : label);
          }
        };
      })(),
      pack: () => this.world.spaceData,
      piloting: () => !!this.world.planet.space && !!this.pilotedShip(),
      // The map's Hyperspace button: the map closes and the System Map opens on this system, where
      // the place picked on the map is in the list. The System Map has no "pick this one" of its
      // own yet, so it opens with the first place in that list picked and the map's pick is not
      // carried. Closing the map asks for the mouse back and the System Map frees it again in the
      // same click: that is deliberate, because the Hyperspace row refuses the jump in several
      // cases (a countdown, no ship's controls) and the mouse must be right either way.
      onHyperspace: () => {
        if (this.map.open) this.toggleMap();
        this.hyperspaceButton();
      },
      onTeleport: (poi) => void this.teleport(this.world.planet, poi, this.zone),
    });
    this.map.onClose = () => this.toggleMap();
    // Every panel moves by its header and stays put; the overlay round it is clear, so the world shows behind.
    draggable(this.map.root, '.map-panel', '.map-header', 'map');
    draggable(this.shipMenu.root, '.ship-panel', '.ship-header', 'ship');
    draggable(this.hyperspaceUi.root, '.ship-panel', '.ship-header', 'hyperspace');
    for (const [id, ui] of [['wardrobe', this.wardrobe], ['weapons', this.weaponsUi], ['garage', this.vehiclesUi], ['npcs', this.npcUi], ['appearance', this.appearanceUi], ['backpack', this.backpack], ['shipedit', this.shipEdit]] as const) draggable(ui.root, '.wardrobe-panel', '.wardrobe-header', id);
    // Console hooks for driving the game from tests: window.__debug.teleport(x, z, yaw), .look(yaw, pitch), .cell().
    (window as unknown as { __debug: unknown }).__debug = {
      /** Put the player at x, z on the ground (or at `y`); a point inside a building's room, once that building's interior is built, counts as being in it. Returns the cell. */
      teleport: (x: number, z: number, yaw?: number, y?: number) => {
        const at = new THREE.Vector3(x, y ?? this.world.terrain.heightAt(x, z) + 0.3, z);
        this.player.reset(at);
        if (yaw !== undefined) this.cam.yaw = yaw;
        return { cell: this.world.enterCellAt(at) };
      },
      /** Teleport to a point in the original game's coordinates (the inverse of `swg()`); null when no layout is loaded. */
      teleportSwg: (x: number, z: number, yaw?: number) => {
        const c = this.world.layoutCenter;
        if (!c) return null;
        // Through `teleport` itself (the entry above, on this same object), so a change to it reaches this too.
        const dbg = (window as unknown as { __debug: { teleport(x: number, z: number, yaw?: number): { cell: unknown } } }).__debug;
        return dbg.teleport(c.x - x, z - c.z, yaw);
      },
      /** The animated surfaces (flip-book screens, scrolling falls): counts and the records whose material name holds the string; `{ speed, freeze }` retunes the clock first. */
      animTex: (arg?: string | { speed?: number; freeze?: boolean }) => {
        if (arg && typeof arg === 'object') {
          if (typeof arg.speed === 'number' && Number.isFinite(arg.speed)) surfaces.speed = arg.speed;
          if (typeof arg.freeze === 'boolean') surfaces.frozen = arg.freeze;
        }
        return { ...surfaces.describe(typeof arg === 'string' ? arg : undefined), programs: this.renderer.info.programs?.length ?? 0 };
      },
      /** Feed mouse movement to the real loop as if the pointer were locked (headless tests cannot lock it), and report the camera. */
      mouse: (dx = 0, dy = 0, wheel = 0) => {
        this.input.locked = true;
        this.input.mouseDX += dx;
        this.input.mouseDY += dy;
        this.input.wheel += wheel;
        const look = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return { yaw: Number(this.cam.yaw.toFixed(3)), pitch: Number(this.cam.pitch.toFixed(3)), distance: Number(this.cam.distance.toFixed(2)), firstPerson: this.cam.firstPerson, at: this.cam.camera.position.toArray().map((v) => Number(v.toFixed(2))), look: look.toArray().map((v) => Number(v.toFixed(3))) };
      },
      /** Make every frame throw after the camera has moved (for testing that a failing frame cannot make the view drift). */
      breakFrames: (on: boolean) => {
        this.breakFrames = on;
        return this.breakFrames;
      },
      look: (yaw: number, pitch: number) => {
        this.cam.yaw = yaw;
        this.cam.pitch = pitch;
      },
      zoom: (distance: number) => {
        this.cam.distance = distance;
      },
      cell: () => (this.world.cellState ? { model: this.world.cellState.building.model.def.id, cell: this.world.cellState.cell } : null),
      /** The room's air (see the README): the room, its doorway beams, its lamps and motes. With options, retunes or switches the debug views first. */
      roomAir: (opts?: RoomAirDebugOptions) => {
        const d = opts ? this.roomAir.debug(opts) : this.roomAir.describe();
        const pass = this.postfx?.describe().passes.find((p) => p.id === 'lightShafts') ?? null;
        return { ...d, effects: !!this.postfx, pass };
      },
      passes: () => this.portals.passes,
      /** The effects chain: every pass with its setting, whether it drew, why not, and what it cost. `postfx({ godRays: false })` forces one off, `{ godRays: null }` gives it back to the settings. */
      postfx: (changes?: Partial<Record<FxPassId, boolean | null>>) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        if (changes) for (const [id, value] of Object.entries(changes)) {
          if (value === null) delete fx.override[id as FxPassId];
          else fx.override[id as FxPassId] = value as boolean;
        }
        return fx.describe();
      },
      /** Start (true) or stop (false) timing every step of the chain on the GPU; with no argument, the report so far. */
      fxTiming: (on?: boolean) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        if (on === true) {
          fx.timer.reset();
          fx.timer.enabled = true;
          return `timing started (GPU timing ${fx.timer.hasGpu ? 'on' : 'not available here'})`;
        }
        if (on === false) fx.timer.enabled = false;
        return fx.timing();
      },
      /** Show one of the shared products instead of the picture: 'linearDepthHalf', 'normalsHalf', 'debugMask', 'waterMask' (the water's normals over the picture), 'waterMaskEnv' (the environment term the water hands the reflections), 'depth', 'scene', or a pass's own texture as 'ssao.ao'. No argument puts the picture back. */
      fxView: (name?: string | null) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        // Putting the picture back answers null, which is not a failure: say so in words.
        return fx.fxView(name ?? null) ?? 'the picture';
      },
      /** Draw one frame asking the driver for an error after every step: this is the test that no pass reads the depth of the target it is writing. */
      fxCheck: () => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        fx.checkErrors = true;
        this.drawFrame();
        const errors = fx.lastCheck ?? [];
        return { clean: errors.length === 0, errors };
      },
      /**
       * Ambient occlusion: tune it live and report the lights it read and the values under the crosshair. `{ split: 0.5 }` left
       * half with it, right half without; `{ view: 'ao' | 'fraction' | 'ceiling' | 'multiplier' | 'region' }` shows its working
       * texture (null the picture); `radius`, `power`, `fade: [start, end]`, `falloff`, `thin`, `openBias`, `directShare` and
       * `region: false` (the sky's lights everywhere) compare. Null puts an option back.
       */
      ssao: (opts?: { split?: number | null; view?: 'ao' | 'fraction' | 'ceiling' | 'multiplier' | 'region' | null; radius?: number | null; power?: number | null; fade?: [number, number] | null; falloff?: number | null; thin?: number | null; openBias?: number | null; directShare?: number | null; region?: boolean | null }) => {
        const fx = this.postfx;
        if (!fx) return 'the effects are off; turn Effects on in the menu';
        const pass = fx.pass<SsaoPass>('ssao');
        if (!pass) return 'the ambient occlusion pass is not installed on this chain';
        const t = pass.tune;
        const D = SSAO_TUNE_DEFAULTS;
        if (opts) {
          if ('split' in opts) t.split = opts.split ?? 0;
          if ('radius' in opts) t.radius = opts.radius ?? null;
          if ('power' in opts) t.power = opts.power ?? null;
          if ('fade' in opts) [t.fadeStart, t.fadeEnd] = opts.fade ?? [D.fadeStart, D.fadeEnd];
          if ('falloff' in opts) t.falloff = opts.falloff ?? D.falloff;
          if ('thin' in opts) t.thin = opts.thin ?? D.thin;
          if ('openBias' in opts) t.openBias = opts.openBias ?? D.openBias;
          if ('directShare' in opts) t.directShare = opts.directShare ?? D.directShare;
          if ('region' in opts) t.region = opts.region ?? D.region;
          if ('view' in opts) {
            const v = opts.view ?? null;
            pass.setMultiplierView(v === 'multiplier');
            fx.fxView(v ? `ssao.${v}` : null);
          }
        }
        const ctx = fx.ctx;
        const row = fx.describe().passes.find((p) => p.id === 'ssao');
        return {
          on: row?.setting ?? false,
          drewLastFrame: pass.drewLastFrame(ctx),
          why: row?.why ?? null,
          resolution: pass.aoSize,
          radius: t.radius ?? ctx.settings.ssaoRadius,
          strength: ctx.settings.ssaoStrength,
          power: t.power ?? SSAO_BASE_POWER * Math.max(ctx.settings.ssaoStrength, 1),
          fade: [t.fadeStart, t.fadeEnd],
          openBias: t.openBias,
          directShare: t.directShare,
          lightSets: pass.last.lightSets,
          lights: pass.lightsReport(ctx),
          water: { inView: ctx.waterInView, mask: pass.last.waterMask },
          centre: pass.probe(ctx),
          gpuMs: fx.timer.enabled ? (fx.timing().rows['pass:ssao']?.gpuMs ?? null) : null,
        };
      },
      /**
       * Depth of field when aiming: live tuning of the lens (`aperture`, `apertureStop`, `maxCoc`, `keepShooterSharp`, `taps`, ...),
       * `force: true` to draw as if aimed, `view: 'coc' | 'blur' | 'tiles' | 'focus' | 'glow' | null`, and the glow mask's `glowLevel`.
       * Draws one frame, then reports the focus (one GPU read), the radii, the grid and the glow depth.
       */
      dof: (opts?: Partial<import('./core/fx/dofMath').DofTuning> & { force?: boolean; view?: import('./core/fx/dof').DofView; glowLevel?: number }) => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/dof').DepthOfFieldPass>('depthOfField');
        if (!fx || !pass) return 'effects are off';
        if (opts) pass.tune(opts);
        this.drawFrame();
        return pass.report(fx.ctx, fx.describe().passes.find((p) => p.id === 'depthOfField'));
      },
      /** The wardrobe and creator dolls' lens: `on`, `strength` for this session (a settings change resyncs), `view: 1` forces the lens and shows its CoC. */
      previewDof: (opts?: { on?: boolean; strength?: number; view?: 0 | 1 }) => {
        const fx = WardrobeUi.dollEffects;
        if (typeof opts?.on === 'boolean') fx.on = opts.on;
        if (typeof opts?.strength === 'number' && Number.isFinite(opts.strength)) fx.strength = Math.max(0, opts.strength);
        if (opts?.view === 0 || opts?.view === 1) fx.view = opts.view;
        return { effects: { ...fx }, wardrobe: this.wardrobe.doll.dofReport(), appearance: this.appearanceUi.doll.dofReport() };
      },
      /** Compile every pass and product material again and say how many programs that made; a second call should say 0. */
      fxWarm: async () => (this.postfx ? await this.postfx.warmUp() : 'the effects are off; turn Effects on in the menu'),
      /** What the card is holding: how the dispose is checked, since turning the effects off and on three times must leave the texture count where it was. */
      renderInfo: () => ({ memory: { ...this.renderer.info.memory }, programs: this.renderer.info.programs?.length ?? 0, effects: !!this.postfx }),
      /** What the motion blur tracks this frame: every mover listed, what it drew and why not, the variants and the static cut. Null with the effects off. */
      movers: (list = true) => this.postfx?.product<VelocityProduct>('velocity')?.stats(list) ?? null,
      /** Draw a frame and read the blur's radius field at a pixel (from the top left; the crosshair by default): what a passing thing does, without a screenshot. */
      motionProbe: (x?: number, y?: number) => {
        const fx = this.postfx;
        if (!fx) return { off: 'the effects are off; turn Effects on in the menu' };
        const pass = fx.pass<MotionBlurPass>('motionBlur');
        if (!pass || typeof pass.readField !== 'function') return { off: 'this chain has no motion blur with a radius field' };
        this.drawFrame();
        const row = fx.describe().passes.find((p) => p.id === 'motionBlur');
        if (!row?.drewLastFrame) return { off: row?.why ?? 'the motion blur did not draw' };
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        const read = pass.readField(this.renderer, x ?? size.x / 2, y ?? size.y / 2);
        if (!read) return { off: 'the read failed' };
        return { ...read, cut: [pass.lastCut.x, pass.lastCut.y] };
      },
      /** Retune the motion blur for this session: `{ nearCut: [8, 25], radiusOfHeight, samples, limits: { maxDraws } }`. Returns the values in force; nothing is saved. */
      motionTune: (changes?: { nearCut?: [number, number]; radiusOfHeight?: number; samples?: number; limits?: Partial<typeof MOVER_LIMITS> }) => {
        if (changes?.nearCut) {
          const [a, b] = changes.nearCut;
          if (!(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && a < b)) return `nearCut must be two distances in metres, the first below the second (got ${JSON.stringify(changes.nearCut)})`;
          MOTION_TUNING.nearCut = [a, b];
        }
        if (changes?.radiusOfHeight !== undefined && Number.isFinite(changes.radiusOfHeight) && changes.radiusOfHeight > 0) {
          MOTION_TUNING.radiusOfHeight = changes.radiusOfHeight;
          this.postfx?.pass<MotionBlurPass>('motionBlur')?.resizeTiles?.();
        }
        if (changes?.samples !== undefined && Number.isFinite(changes.samples)) MOTION_TUNING.samples = Math.min(32, Math.max(4, Math.round(changes.samples)));
        if (changes?.limits) {
          const L = MOVER_LIMITS as Record<string, number>;
          for (const [k, v] of Object.entries(changes.limits)) if (k in L && typeof v === 'number' && Number.isFinite(v)) L[k] = v;
        }
        return { nearCut: [...MOTION_TUNING.nearCut], radiusOfHeight: MOTION_TUNING.radiusOfHeight, samples: MOTION_TUNING.samples, shutter: MOTION_TUNING.shutter, tileSize: this.postfx?.pass<MotionBlurPass>('motionBlur')?.tileSize ?? null, limits: { ...MOVER_LIMITS } };
      },
      /** Every pass of the last frame: what it was and what it drew. */
      passLog: () => {
        const log = this.portals.passLog;
        const byLabel = new Map<string, { passes: number; calls: number; triangles: number }>();
        for (const p of log) {
          const e = byLabel.get(p.label) ?? byLabel.set(p.label, { passes: 0, calls: 0, triangles: 0 }).get(p.label)!;
          e.passes++;
          e.calls += p.calls;
          e.triangles += p.triangles;
        }
        return { total: { passes: log.length, calls: log.reduce((a, p) => a + p.calls, 0) }, byLabel: Object.fromEntries(byLabel) };
      },
      flora: () => this.world.floraStatus,
      /**
       * Load a character assembled from parts and stand it beside the player: one skeleton, a
       * body, a head and whatever is worn, each its own file. Then `.wear(name)`, `.remove(name)`,
       * `.setMorph(name, v)` and `.status()` on what comes back.
       */
      /** The character's appearance: every live variable (key, kind, palette size or choices, which mesh owns it), the shape sliders, and the values in force. */
      appearance: () => {
        const c = this.player.rig?.character;
        if (!c) return 'no parts character';
        return { live: !!c.customizer, variables: (c.customizer?.variables() ?? []).map((v) => `${v.key}: ${v.kind}${v.colors ? ` ${v.colors.length} colours` : v.count ? ` ${v.count} choices` : ''}${v.private ? ` (private to ${v.mesh})` : ''} default ${v.default}`), manifest: (c.manifest.variables ?? []).map((v) => `${v.private ? 'private ' : ''}${v.name}: ${v.kind} ${v.colors?.length ?? v.count ?? '?'} from ${v.sources.join(', ')}${v.meshes?.length ? ` on ${v.meshes.join(', ')}` : ''}`), morphs: c.morphValues(), values: c.variableValues(), height: c.height };
      },
      /** What a mesh's live textures are made of (`recipe('head')`): shader stages, texture choices, palettes, blueprint operations and the values in force. */
      recipe: (mesh = 'head') => {
        const c = this.player.rig?.character;
        if (!c?.customizer) return 'no live recipes on this character';
        return c.customizer.describe(mesh);
      },
      /** Every normal map's strength and way up, live, the world's and the character's: `normals(1, -1)` is the default (the game's maps are Direct3D's, green down), `normals(1, 1)` the other way up, `normals(0, 0)` none. */
      normals: (x = 1, y = -1) => {
        const world = this.world.setNormalScale(x, y);
        const c = this.player.rig?.character;
        const own = c?.customizer?.setNormalScale(x, y) ?? 0;
        return `${world} materials in the world and ${own} of the character's set to (${x}, ${y})`;
      },
      /** Play as another species or gender (`species()` lists what the pack has): `species('twilek_female')`. */
      species: async (id?: string) => {
        if (!id) return this.speciesList.length ? this.speciesList.map((s) => `${s.id}: ${s.morphs.length} sliders, ${s.variables.length} variables, ${s.jkaClips} JKA clips`) : `no species index (run the converter's species command); playing ${this.characterId}`;
        return this.switchCharacter(id);
      },
      character: async (id = 'human_male') => {
        const c = await Character.load(import.meta.env.BASE_URL, id);
        const p = this.player.pos;
        c.group.position.set(p.x + 1.5, this.world.terrain.heightAt(p.x + 1.5, p.z), p.z);
        c.group.traverse((o) => o.layers.enable(31));
        this.scene.add(c.group);
        (window as unknown as { __character: Character }).__character = c;
        return { parts: c.status(), morphs: Object.keys(c.morphValues()).length, clips: c.clips.length, at: c.group.position.toArray() };
      },
      /**
       * The character's shape sliders, from the mesh's blend targets. With no arguments, every
       * slider and where it sits; with a name and a value in 0..1, move one.
       * Two-sided sliders come as pairs (blend_jaw_0 and blend_jaw_1 are one slider's two ends).
       */
      morph: (name?: string, value?: number) => {
        const rig = this.player.rig;
        if (!rig) return 'the character rig has not loaded';
        if (name === undefined) return rig.morphValues();
        if (value === undefined) return rig.morphValues()[name] ?? `no such shape: ${name}`;
        if (!rig.setMorph(name, value)) return `no such shape: ${name}`;
        return { [name]: value };
      },
      /** What the player is wearing, and what the pack offers. `wear`/`remove` change it. */
      wardrobe: () => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        return { worn: c.status(), available: c.manifest.parts.filter((p) => p.occlusionLayer > 0).map((p) => p.name) };
      },
      wear: async (name: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        if (await c.wear(name)) return c.status();
        // Not one of the character's own parts: try the converted catalogue.
        return (await c.wearItem(name, import.meta.env.BASE_URL)) ? c.status() : `no such part or wardrobe item: ${name}`;
      },
      /** The wardrobe doll: what the last clone produced and how big its canvas is. */
      preview: () => this.wardrobe.previewState(),
      /** First person's head: what each worn part does (whole, split, none) and why; `fpHead(true)` hides it from any camera to look at, `fpHead(null)` follows the camera again. */
      fpHead: (force?: boolean | null) => {
        if (force !== undefined) this.fpHeadForce = force;
        return { firstPerson: this.cam.firstPerson, forced: this.fpHeadForce, parts: this.player.rig?.headStatus() ?? [] };
      },
      /** The converted wardrobe: every wearable and hairstyle. `find` narrows by id or category. */
      closet: async (find?: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        const w = await c.catalogue(import.meta.env.BASE_URL);
        const re = find ? new RegExp(find, 'i') : null;
        const hits = w.items.filter((i) => !re || re.test(i.id) || re.test(i.template));
        return { total: w.items.length, matched: hits.length, items: hits.slice(0, 40).map((i) => `${i.id} (${i.kind}, layer ${i.parts[0]?.occlusionLayer})`) };
      },
      remove: (name: string) => {
        const c = this.player.rig?.character;
        if (!c) return 'the player is not assembled from parts';
        return c.remove(name) ? c.status() : `cannot remove ${name}`;
      },
      /** Which sky-ramp row feeds ambient light, and its strength. Row 0 is black on every planet; try 8 and 9. */
      ambient: (row?: number, scale?: number) => this.world.setAmbient(row, scale),
      /** Shadow look: radius is the blur in shadow-map texels (1 crisp, 3 soft), intensity how dark a shadow goes. Reports the cascade splits. */
      shadowLook: (radius?: number, intensity?: number, mapSize?: number) => this.world.setShadowLook(radius, intensity, mapSize),
      /** Retune shadows: distance is how far the cascades reach, minRadius which objects cast. Shorter reach is cheaper and sharper. */
      shadows: (distance?: number, minRadius?: number) => this.world.setShadows(distance, minRadius),
      /** The ragdolls' numbers (springs, limits, sleep), changed live: `ragdoll({ stiffness: 80, springFade: 2 })`; no argument reads them, with every fallen body's state. */
      ragdoll: (tune?: Partial<typeof RAGDOLL>) => {
        if (tune) Object.assign(RAGDOLL, tune);
        return { ...RAGDOLL, hooks: { ...this.physics.hookStats }, bodies: [...this.world.creatures.creatures.map((c) => c.ragdoll?.status ?? null), ...this.world.npcs.npcs.map((n) => n.ragdoll?.status ?? null), this.player.ragdoll?.status ?? null].filter(Boolean) };
      },
      /** Kill the player (the death card and the ragdoll), every creature, or every fighter, to see them fall. */
      kill: (what: 'player' | 'creatures' | 'fighters' | 'mobiles' | 'all' = 'player', filter?: string) => {
        // `filter` is a substring of a mobile's entry id or name, a creature's name, or a fighter's species.
        const f = filter?.toLowerCase();
        const picks = (...names: string[]) => !f || names.some((n) => n.toLowerCase().includes(f));
        if (what === 'player') this.player.takeDamage(1e9);
        if (what === 'creatures' || what === 'all') for (const c of this.world.creatures.creatures) if (picks(c.label)) c.damage(1e9);
        if (what === 'fighters' || what === 'all') for (const n of this.world.npcs.npcs) if (picks(n.species, n.name)) n.damage(1e9);
        if (what === 'mobiles' || what === 'all') for (const m of [...(this.world.mobiles?.live ?? [])]) if (picks(m.entry.id, m.entry.name)) m.damage(1e9);
        return { player: this.player.hp, creatures: this.world.creatures.creatures.filter((c) => c.dead).length, fighters: this.world.npcs.npcs.filter((n) => n.dead).length, mobiles: (this.world.mobiles?.live ?? []).filter((m) => m.dead).length };
      },
      /** The buildings around the player and whether each can be walked into (E offers a way into the ones that cannot). */
      doorless: () => this.world.describeDoorless(this.player.pos),
      /** Building interiors: how many are built against how many every loaded building would hold. `force` builds them all to compare. */
      interiors: (force = false) => this.world.interiorStats(force),
      /** Draw calls of the whole frame, summed over the portal renderer's passes. */
      drawCalls: () => ({ calls: stats.calls, passes: this.portals.passes, triangles: stats.triangles }),
      // The player's position in the original game's coordinates (for terrain-check --at and /way).
      swg: () => {
        const c = this.world.layoutCenter;
        const p = this.player.pos;
        return c ? { x: Number((c.x - p.x).toFixed(1)), z: Number((c.z + p.z).toFixed(1)), y: Number(p.y.toFixed(2)), ground: Number(this.world.terrain.heightAt(p.x, p.z).toFixed(2)) } : null;
      },
      // Show a converted model (path under assets-private/) in front of the player, playing a clip.
      show: async (file: string, clip?: string) => {
        let gltf;
        try {
          gltf = await surfaces.withPlugin(new GLTFLoader()).loadAsync(`${import.meta.env.BASE_URL}assets-private/${file}`);
        } catch (err) {
          console.error('show: failed to load', file, err);
          throw err;
        }
        const p = this.player.pos;
        gltf.scene.position.set(p.x + 3, this.world.terrain.heightAt(p.x + 3, p.z), p.z);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        gltf.scene.traverse((o) => {
          o.layers.enable(31);
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = castsShadow(m.material);
            m.frustumCulled = false;
          }
        });
        this.scene.add(gltf.scene);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const names = gltf.animations.map((a) => a.name);
        const wanted = clip ? gltf.animations.find((a) => a.name === clip) ?? gltf.animations.find((a) => a.name.includes(clip)) : gltf.animations[0];
        if (wanted) mixer.clipAction(wanted).play();
        this.shown.push(mixer);
        const bones: string[] = [];
        gltf.scene.traverse((o) => {
          if ((o as THREE.Bone).isBone) bones.push(o.name);
        });
        const result = { clips: names, playing: wanted?.name ?? null, joints: bones.length ? 'skinned' : 'static', bones, size: [size.x, size.y, size.z].map((v) => Number(v.toFixed(2))), at: [gltf.scene.position.x, gltf.scene.position.y, gltf.scene.position.z].map((v) => Number(v.toFixed(1))) };
        console.info('show:', file, result);
        return result;
      },
      scene: () => this.scene,
      find: (pattern: string) => {
        const out: unknown[] = [];
        this.scene.traverse((o) => {
          if (!new RegExp(pattern).test(o.name)) return;
          const g = (o as THREE.Mesh).geometry;
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          out.push({ name: o.name, visible: o.visible, y: o.position.y, indices: g?.getIndex()?.count ?? null, verts: g?.getAttribute('position')?.count ?? null, layers: o.layers.mask, material: m ? { opacity: m.opacity, transparent: m.transparent, color: m.color?.getHexString(), stencilRef: m.stencilRef, stencilFunc: m.stencilFunc, stencilWrite: m.stencilWrite } : null });
        });
        return out;
      },
      water: (x: number, z: number) => this.world.terrain.waterHeightAt(x, z),
      /**
       * The lava drawn now (tables, and each look with where its textures came from: "client",
       * "partial" or "stand-in") and the look every lava material shares. `lava({ intensity, glow,
       * glowFrom, glowTo })` tunes the colour and which veins glow; `lava({ axes: 'xzy' })` reads the
       * client's texture coordinate the other way round, `{ axes: 'xyz' }` restores it.
       */
      lava: (look?: { intensity?: number; glow?: number; glowFrom?: number; glowTo?: number; axes?: 'xyz' | 'xzy' }) => {
        if (look) this.world.setLavaLook(look);
        return this.world.lavaStatus;
      },
      /**
       * The heat haze: what drew last frame and why it did not, with console tuning (`show` tints the
       * hot air cyan, `clientOffset`, `gate`, `fadeStart`, `fadeEnd`, `lift`, `plumeRange`,
       * `minPlumePixels`, `lavaNoiseRate`, `plumeNoiseRate`). Reads stored values only.
       */
      heat: (tune?: Partial<typeof heatTuning>) => {
        if (tune) {
          const into = heatTuning as Record<string, unknown>;
          for (const [k, v] of Object.entries(tune)) {
            // Only the known keys, each with a value of its own kind (a finite number where a number goes).
            if (!(k in heatTuning) || typeof v !== typeof into[k] || (typeof v === 'number' && !Number.isFinite(v))) continue;
            into[k] = v;
          }
        }
        const S = this.settings;
        const sources = { lavaTables: this.heat.lava.length, providers: this.heat.providerCount };
        const fx = this.postfx;
        if (!fx) return { effects: false, note: 'the heat haze is drawn by the effects chain; turn Effects on', setting: S.heatHaze, strength: S.heatHazeStrength, tuning: { ...heatTuning }, sources };
        const product = fx.product<HeatProduct>('heat');
        const row = fx.describe().passes.find((p) => p.id === 'heatHaze');
        return {
          effects: true,
          setting: S.heatHaze,
          strength: S.heatHazeStrength,
          tuning: { ...heatTuning },
          sources,
          product: product ? product.describe() : null,
          why: !product || !row ? 'the heat haze is not installed on this chain' : row.drewLastFrame ? null : (row.why ?? null),
        };
      },
      /** A plume 5 m ahead of the camera, crossing the view left to right, for `seconds`: the haze without a vehicle or a gun. */
      heatPlume: (seconds = 10) => {
        const start = performance.now();
        const cam = this.cam.camera;
        const fwd = new THREE.Vector3();
        const right = new THREE.Vector3();
        const at = new THREE.Vector3();
        let remove = () => {};
        remove = this.heat.addProvider((sink) => {
          const elapsed = (performance.now() - start) / 1000;
          // The remover only marks it: the list drops it after the loop that is running.
          if (!(elapsed <= seconds)) {
            remove();
            return;
          }
          cam.getWorldDirection(fwd);
          right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
          at.setFromMatrixPosition(cam.matrixWorld).addScaledVector(fwd, 5).addScaledVector(right, -3);
          sink.push(at.x, at.y, at.z, right.x, right.y, right.z, 6, 0.3, 1.2, 1.4, (elapsed * 6 * plumeNoiseFrequency(1.2) + 0.25) % 1);
        });
        return { seconds, providers: this.heat.providerCount, effects: !!this.postfx, setting: this.settings.heatHaze };
      },
      /**
       * Every water body with the shader it came from, its look, what it reflects and whether it
       * is on screen. `waterFx({ env: 'shader' })` switches every body to its own shader's cube
       * map, `{ env: 'sky' }` back to the area's day and night map; `{ envIntensity }` changes how
       * hard the water mirrors. With the effects on, `{ view }` shows what the reflections pass
       * traces ('confidence': red traced, blue fallback), adds ('added'), the fallback alone
       * ('envOnly', which must look exactly like the pass off) or the traced part alone
       * ('tracedOnly'); 'off' is the picture. The march takes `maxDistance`, `thickness`,
       * `thicknessPerMetre`, `minWeight`, `sky` and `strength`. Use it as `await __debug.waterFx(...)`.
       */
      waterFx: async (opts?: {
        env?: 'sky' | 'shader';
        envIntensity?: number;
        view?: 'off' | 'confidence' | 'added' | 'envOnly' | 'tracedOnly';
        maxDistance?: number;
        thickness?: number;
        thicknessPerMetre?: number;
        minWeight?: number;
        sky?: boolean;
        strength?: number;
      }) => {
        const bodies = this.world.waterBodies;
        if (opts?.envIntensity !== undefined) bodies.envIntensity = opts.envIntensity;
        if (opts?.env && opts.env !== bodies.envMode) await bodies.setEnvMode(opts.env);
        else bodies.refresh();
        const fx = this.postfx;
        type Tune = { maxDistance: number; thickness: number; thicknessPerMetre: number; minWeight: number; sky: boolean; strength: number; view: number };
        const pass = fx?.pass('waterReflections') as unknown as { tune: Tune; views: Record<string, number> } | undefined;
        if (pass && opts) {
          if (opts.view !== undefined) pass.tune.view = pass.views[opts.view] ?? 0;
          for (const k of ['maxDistance', 'thickness', 'thicknessPerMetre', 'minWeight', 'strength'] as const) if (typeof opts[k] === 'number') pass.tune[k] = opts[k];
          if (opts.sky !== undefined) pass.tune.sky = opts.sky;
        }
        const row = fx?.describe().passes.find((p) => p.id === 'waterReflections');
        const mask = fx?.product('waterMask') as unknown as { allocated: boolean; drawn: number; idleFor(ctx: unknown): number } | undefined;
        return {
          ...bodies.describe(this.cam.camera.position),
          pass: pass && row ? { drewLastFrame: row.drewLastFrame, why: row.why ?? null, gpuMs: row.gpuMs, tune: { ...pass.tune } } : null,
          mask: mask && fx ? { allocated: mask.allocated, drawn: mask.drawn, idleSeconds: Number(mask.idleFor(fx.ctx).toFixed(1)) } : null,
        };
      },
      /** Placed objects within r metres of the player: model, distance, tier, and whether the model and its region are loaded. */
      near: (r = 150) => {
        const list = this.world.objectsNear(this.player.pos.x, this.player.pos.z, r);
        const summary = { total: list.length, notInManifest: list.filter((o) => !o.inManifest).length, notLoaded: list.filter((o) => o.inManifest && !o.loaded).length, regionsNotLoaded: [...new Set(list.filter((o) => o.regionState !== 'loaded').map((o) => `${o.region}/tier${o.tier}:${o.regionState}`))] };
        console.table(list.slice(0, 60));
        return summary;
      },
      /** Movement rules: 'jka' (Jedi Academy's, the default on this branch) or 'swg' (the original numbers). Reports the current one. */
      profile: (name?: 'jka' | 'swg') => {
        if (name) this.player.moveProfile = name;
        return this.player.moveProfile;
      },
      /** Rebind an action to one or more keys (KeyboardEvent.code names, or Mouse0/Mouse1/Mouse2); no keys restores the default. Kept in local storage. */
      bind: (action: Action, ...codes: string[]) => {
        this.input.bind(action, codes);
        return this.input.bindings[action];
      },
      /** Every action and the keys bound to it. */
      bindings: () => ({ ...this.input.bindings }),
      resetBindings: () => this.input.resetBindings(),
      /**
       * The mixer, and its live numbers. Nothing can be heard from a driven tab, so this is how
       * sound is checked headless: the context's state (`suspended` means nobody has clicked yet),
       * every voice with its layer, priority, slot and the gain the listener would hear it at, the
       * voices refused a slot, the grid's pass, the bank (templates, samples, memory) and the last
       * dozen sounds asked for with what became of each. With an object it also tunes, live:
       * `{ distance: { audible: 12 } }`, `{ voices: { positional: 24 } }`, `{ grid: { rate: 2 } }`
       * and `{ mixer: { writeRate: 60 } }`, each merged into the invented numbers of its kind.
       */
      audio: (opts: { distance?: Record<string, number>; voices?: Record<string, number>; grid?: Record<string, number>; mixer?: Record<string, number> } = {}) => {
        if (opts.distance) Object.assign(this.audio.distance, opts.distance);
        if (opts.grid) Object.assign(this.audio.grid.tune, opts.grid);
        if (opts.mixer) Object.assign(this.audio.tune, opts.mixer);
        // A source's reach and its cell are worked out when it is filed, so moving either the
        // audible radius or the cell edge has to file everything again or the change reaches
        // nothing already in the grid.
        if (opts.distance || opts.grid) this.audio.grid.rebuild();
        if (opts.voices) console.warn('audio: the voice pools are sized when the mixer is made; reload after changing them in voices.ts');
        return { ...this.audio.status(), tune: { distance: { ...this.audio.distance }, grid: { ...this.audio.grid.tune }, mixer: { ...this.audio.tune } } };
      },
      /**
       * Play one of the game's sound templates by its archive path, at the player (`sound(id)`),
       * at a point (`sound(id, [x, y, z])`) or with no place at all (`sound(id, false)`). Returns
       * the voice's key, or 0 with the reason in `audio().recent`.
       */
      sound: (id: string, where?: [number, number, number] | false) => {
        if (where === false) return this.audio.play(id);
        const at = where ?? this.player.worldPos.toArray();
        return this.audio.play(id, { x: at[0], y: at[1], z: at[2] });
      },
      /**
       * The per-category multiplier over the game's own volumes (an invented knob, 1 by default),
       * for settling how the very quiet one-shot beds are meant to read against their bed. The
       * categories are the game's own: 0 ambient, 1 explosion, 2 item, 3 movement, 4 interface,
       * 5 vehicle, 6 vocalization, 7 weapon, 10 machine, 13 voice-over. No argument lists them.
       */
      soundGain: (category?: number, value?: number) => {
        if (category !== undefined && value !== undefined && category >= 0 && category < this.audio.categoryGain.length) this.audio.categoryGain[category] = value;
        return [...this.audio.categoryGain];
      },
      /**
       * The sound of the place, headless: which of the sky's own rows are playing and at what share
       * of the frame, the day fraction the beds are crossfaded by, how much of the frame the room
       * the player is in has taken and which of the interior table's rows that is, the planet's
       * placed sound objects (how many the pack holds, how many are within earshot, how many hold a
       * voice), the loops its particle effects name, and each weather channel's own sound.
       *
       * With an object it tunes, live: `{ dayFade: 5 }` and `{ roomFade: 0.2 }` make the two
       * crossfades quick enough to see in one walk, and `{ weatherParticles: true }` adds the
       * thunder the rain sheets carry to the thunder the storm rows already play (the owner's
       * decision 5, which is off by default so the two do not double). The placed sound objects'
       * own three numbers (`cap`, `spaceTries`, `spaceGiveUp`) go in the same object and take from
       * the next grid pass; `cap` is read when a planet's places are put down, so it takes on the
       * next arrival.
       */
      ambience: (opts: Partial<AmbienceTune & WorldSourceTune> = {}) => {
        const a = this.world.ambience;
        if (!a) return { ok: false, why: 'the world has no mixer' };
        // Each number goes to the tune it belongs to: the two are separate objects, one on the
        // ambience and one on its sources, and a key named in neither is said rather than dropped.
        const unknown: string[] = [];
        for (const [key, value] of Object.entries(opts)) {
          if (key in a.tune) (a.tune as unknown as Record<string, unknown>)[key] = value;
          else if (key in a.sources.tune) (a.sources.tune as unknown as Record<string, unknown>)[key] = value;
          else unknown.push(key);
        }
        if (unknown.length) console.warn(`ambience: nothing here is tuned by ${unknown.join(', ')}`);
        return { ...a.status(), tune: { ...a.tune, ...a.sources.tune } };
      },
      /**
       * Renders a known sound through an offline context and checks it came out at the gain the
       * master and the Effects slider ask for: the one check of the audio path that needs neither a
       * click nor the sound pack. `ok` false with `peak` 0 is a broken chain; `suspended` in
       * `audio().state` is only an unlock, which this does not need.
       */
      audioSelfTest: () => this.audio.selfTest(),
      /**
       * Feet and voices, headless: the last foot events with the clip that marked each, what the
       * foot was taken to have landed on and which of the four sources said so (water, room,
       * object, terrain), the sound that was chosen and whether it got a voice; then which bodies
       * are being watched, which client data each speaks from, and how many events have been
       * crossed at all. `footsteps(n)` prints the last n as a table.
       *
       * With an object it tunes, live, every invented number of its kind: the watching range
       * (`range`), the idle loops' range (`loopRange`), the wading depths (`wade`, `swim`), the
       * ray that finds what is stood on (`probe`, `reach`, which the world reads from the same
       * object), the hunting call's spread (`call`), the fall after a death (`deathFall`) and the
       * default surface (`fallback`); the clip reader's own three (`maxStep`, `speakWeight`,
       * `footWeight`); and how many chunks' ground families are kept (`familyChunks`, reported
       * beside it as `ground`). A key named in none of the three is said rather than dropped.
       */
      footsteps: (n = 12, opts: Partial<FootTune & ClipEventTune & typeof FAMILY_TUNE> = {}) => {
        const unknown: string[] = [];
        for (const [key, value] of Object.entries(opts)) {
          if (key in this.feet.tune) (this.feet.tune as unknown as Record<string, unknown>)[key] = value;
          else if (key in CLIP_EVENT_TUNE) (CLIP_EVENT_TUNE as unknown as Record<string, unknown>)[key] = value;
          else if (key in FAMILY_TUNE) (FAMILY_TUNE as unknown as Record<string, unknown>)[key] = value;
          else unknown.push(key);
        }
        if (unknown.length) console.warn(`footsteps: nothing here is tuned by ${unknown.join(', ')}`);
        const log = this.feet.log.slice(-Math.max(1, n));
        console.table(log);
        return { ...this.feet.status(), ground: { familyChunksHeld: this.inWorld ? this.world.terrain.familyChunks : 0, familyChunks: FAMILY_TUNE.familyChunks }, recent: log };
      },
      /**
       * What is under a point right now and which of the four sources says so: with no argument the
       * player's own feet, else a point. This is how a surface that sounds wrong is tracked down --
       * it names the room's row, the object template under the foot and the terrain's own surface
       * template, so the answer can be told from the data it came from.
       */
      surface: (at?: [number, number, number]) => {
        const p = at ? { x: at[0], y: at[1], z: at[2] } : this.player.worldPos;
        return this.feet.probe(p.x, p.y, p.z, at ? this.world.inside : this.world.inside || !!this.player.aboard);
      },
      /** The saber system's state: style, current move, chain count, whether the rig has Jedi Academy's clips, the special jump in progress, and the thrown saber's flight. */
      saber: () => ({ blade: (() => { const a = new THREE.Vector3(); const b = new THREE.Vector3(); this.player.bladeSegmentAt(0, a, b); return { hilt: a.toArray().map((v) => Number(v.toFixed(3))), tip: b.toArray().map((v) => Number(v.toFixed(3))) }; })(), blade2: (() => { if (this.player.bladeCount < 2) return null; const a = new THREE.Vector3(); const b = new THREE.Vector3(); this.player.bladeSegmentAt(1, a, b); return { hilt: a.toArray().map((v) => Number(v.toFixed(3))), tip: b.toArray().map((v) => Number(v.toFixed(3))) }; })(), style: this.player.saber.style, move: this.player.saber.move, chain: this.player.saber.chainCount, timer: Number(this.player.saber.timer.toFixed(2)), jkaClips: this.player.hasJkaClips, on: this.player.saberOn, special: this.player.jka.specialJump, thrown: this.player.thrown.inFlight ? { returning: this.player.thrown.returning, at: this.player.thrown.pos.toArray().map((v) => Number(v.toFixed(2))) } : null }),
      /** Particle effects within r metres of the player: file, distance, whether playing, live particles. With `verbose`, every emitter: texture, blend, whether the texture loaded, and the first particle's size, alpha, colour and screen position. */
      particles: (r = 200, verbose = false) => {
        const list = this.world.particlesNear(this.player.pos.x, this.player.pos.z, r);
        console.table(list.slice(0, 60));
        if (verbose) {
          const emitters = this.world.emittersNear(this.player.pos.x, this.player.pos.z, r);
          console.table(emitters.slice(0, 60));
          console.log(JSON.stringify(emitters.slice(0, 60)));
        }
        return { status: this.world.particleStatus, total: list.length, playing: list.filter((p) => p.playing).length };
      },
      /** Scale the sky's fog density (1 is the client's value) and report it. */
      fog: (scale?: number) => {
        if (scale !== undefined) this.world.fogScale = scale;
        return { scale: this.world.fogScale, density: (this.scene.fog as THREE.FogExp2 | null)?.density ?? null };
      },
      /** Set the time of day (0 midnight, 0.5 noon) and report the sky's current lighting. */
      time: (t?: number) => {
        if (t !== undefined) this.world.day.time = t;
        const L = this.world.swgSky?.lighting;
        return { time: this.world.day.time, clock: this.world.day.clock(), swg: this.world.day.swg, isDay: this.world.day.isDay, index: this.world.day.colorIndex, light: this.world.day.lightDir.toArray().map((v) => Number(v.toFixed(2))), lighting: L ? { main: L.main.getHexString(), mainScale: Number(L.mainScale.toFixed(2)), ambient: L.ambient.getHexString(), fog: L.fog.getHexString(), fogDensity: L.fogDensity, sunMoonAlpha: L.sunMoonAlpha, starAlpha: L.starAlpha } : null };
      },
      /** Simulate `seconds` of play at 60 Hz with the given keys held (KeyboardEvent codes or Mouse0..2), without waiting on real frames: movement, the weapons, the bolts and the turrets. With `hold`, the keys stay down afterwards (a later call without it releases them), so a key is not pressed afresh each call. */
      advance: (seconds: number, keys: string[] = [], hold = false) => {
        for (const k of keys) this.input.force(k, true);
        const dt = 1 / 60;
        // Ten simulated seconds run in a fraction of a real one: whatever they would have sounded
        // is recorded and nothing is started, or a visible tab would burst with a minute of noise.
        this.audio.advancing = true;
        try {
          for (let i = 0; i < Math.round(seconds / dt); i++) {
            this.stepEmoteKeys();
            this.stepEmoteEnd();
            this.player.update(dt, this.input, this.cam, this.world);
            this.scorch(dt);
            this.stepCombat(dt);
            // The jump's clock (its countdown and phases); the transit itself waits on drawn frames and streaming, which this does not give.
            if (!this.traveling) this.hyperspace.update(dt, dt, false);
            // The ultra cruise's own clock, before the hulls step, as the frame loop has it: a run
            // can be started and watched to its stop with no frames drawn at all.
            this.ultraCruise.update(dt);
            this.stepVehicles(dt, true);
            if (!this.player.noclip && !this.player.mounted) this.world.turrets.update(dt, this.player, this.world.bolts);
            // Where the player stands first, then one step of everything alive: without the first,
            // the brains would all chase where the player was when the helper was called.
            this.world.setPlayerTarget(this.player.worldPos, !this.player.noclip && this.player.hp > 0, (dmg) => this.player.takeDamage(dmg));
            this.world.stepLiving(dt, this.player.worldPos, this.cam.camera);
            this.physics.step(dt);
            this.effects.update(dt);
            this.updateCamera(null);
            // The feet step with the simulation: the mixer is recording rather than playing, so a
            // helper can count the steps a walk took without the tab bursting into noise.
            const eye = this.cam.camera.position;
            this.stepFeet(dt, eye.x, eye.y, eye.z);
            this.input.endFrame();
          }
        } finally {
          this.audio.advancing = false;
        }
        if (!hold) for (const k of keys) this.input.force(k, false);
      },
      /** With the effects on: scan the frame for pixels that are not numbers (what the bloom smears into a black box) and name the object under the first one. */
      blackBox: () => {
        if (!this.postfx) return 'the effects are off (turn Effects on): the scan reads their frame';
        this.postfx.wantScan = true;
        this.drawFrame();
        const s = this.postfx.lastScan;
        if (!s) return 'no scan';
        let under: Record<string, unknown> | null = null;
        if (s.first) {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2((s.first[0] / s.width) * 2 - 1, -(s.first[1] / s.height) * 2 + 1), this.cam.camera);
          const hits = ray.intersectObjects(this.scene.children, true);
          const hit = hits.find((h) => h.object.visible);
          if (hit) {
            const o = hit.object as THREE.Mesh;
            const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material | undefined;
            let named: THREE.Object3D | null = o;
            while (named && !named.name) named = named.parent;
            under = { object: o.name || '(unnamed)', named: named?.name ?? null, parents: [o.parent?.name, o.parent?.parent?.name].filter(Boolean), material: mat?.type, materialName: mat?.name, distance: Number(hit.distance.toFixed(1)), userData: o.userData };
          }
        }
        return { ...s, under };
      },
      /** The colour grade now: what the sky gave, the planet's look, the terms and parameters, how far it still lags the sky, and the room weight. `grade({ compare: 0.5 })` splits the screen (ungraded on the left), `grade({ look: { gloom: 0.3 } })` tries a look live and logs the line for the table, `grade({ look: {} })` shows the planet with none and `grade({ look: null })` puts it back; `freeze`, `params` and `room` force the rest. */
      grade: (
        opts: {
          look?: import('./core/fx/gradeMath').GradeLook | null;
          freeze?: boolean;
          params?: Partial<import('./core/fx/gradeMath').GradeParams> | null;
          compare?: number | null;
          room?: number | null;
        } = {},
      ) => {
        const pass = this.gradePass();
        if (!this.postfx || !pass) return 'the effects are off (turn Effects on): the grade is one of their passes';
        if ('look' in opts) {
          pass.lookOverride = opts.look ?? null;
          if (opts.look) console.info(`GRADE_LOOKS: ${this.world.planet?.id ?? ''}: ${JSON.stringify(opts.look)},`);
        }
        if ('freeze' in opts) pass.frozen = !!opts.freeze;
        if ('params' in opts) pass.forcedParams = opts.params ?? null;
        if ('compare' in opts) pass.compare = opts.compare ?? null;
        if ('room' in opts) pass.forcedRoom = opts.room ?? null;
        if (!this.settings.colorGrade) return 'the colour grade is off (Menu, Graphics, Effects)';
        return pass.report(this.postfx.ctx);
      },
      /** Draw the grade's own shader over known colours and compare every texel with the JavaScript the node test sweeps: `ok` false means the two have drifted apart. */
      gradeSelfTest: () => {
        const pass = this.gradePass();
        if (!pass) return 'the effects are off (turn Effects on): the self test draws the grade’s own shader';
        return pass.selfTest(this.renderer);
      },
      /** An estimate of how far the grade moves the frame just drawn: `darkened` and `brightened` should both be 0. */
      gradeCheck: () => {
        const pass = this.gradePass();
        if (!this.postfx || !pass) return 'the effects are off (turn Effects on): the check reads their frame';
        this.drawFrame();
        return pass.check(this.renderer, this.postfx.sceneTarget);
      },
      /** Draw `n` frames back to back with the GPU waited on after each, and report the milliseconds one takes; `await bench(30, false)` first turns the effects off, `bench(30, true)` on. */
      bench: async (n = 30, effects?: boolean) => {
        if (effects !== undefined && effects !== this.settings.effects) {
          this.settings.effects = effects;
          await this.reconcileEffects();
        }
        const gl = this.renderer.getContext();
        this.drawFrame();
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          this.drawFrame();
          gl.finish();
        }
        const ms = (performance.now() - t0) / n;
        return { effects: !!this.postfx, msPerFrame: Number(ms.toFixed(2)), fps: Math.round(1000 / ms), calls: this.frameCalls, passes: this.portals.passes };
      },
      /** Open or close the map window (M), on its `'here'` or `'galaxy'` tab. */
      map: (tab?: 'here' | 'galaxy') => {
        if (this.map.open && !tab) this.toggleMap();
        else if (!this.map.open) this.toggleMap();
        if (tab && this.map.open) this.map.show(tab);
        return this.map.open ? `map open on ${tab ?? 'here'}` : 'map closed';
      },
      /** The converted sky's parts (the dome, the skybox faces, the stars, space dust, the sun and star sprites) and its lighting now; `sky('skybox')` and the like toggle a part to see what it contributes. */
      sky: (toggle?: 'dome' | 'skybox' | 'stars' | 'dust' | 'sprites') => this.world.swgSky?.describe(toggle) ?? 'no converted sky on this world',
      /**
       * Which star lights this space zone, and what stops its rays. No argument: the pick, every
       * star the zone has, and how far the zone file's own light points from the one chosen.
       * `suns({ rule: 'disc' })` lights it from the largest disc instead of the brightest glow and
       * `{ rule: 'glow' }` puts it back, both at once, with the shadows, the flare and the rays
       * following. `{ companionDegrees }` changes how near a second star must be to flare beside the
       * sun, `{ skyShare }` where the rays count a pixel as open sky (a share of the far plane), and
       * `{ standInDistance }` how far out, in metres, a planet writes the depth that stops them,
       * which is read when a zone's bodies are built, so it shows on the next arrival. Nothing
       * here is saved.
       */
      /**
       * The ultra cruise. No argument: the run's state, its speed, how far it has gone, how many
       * stops it is watching, whether a program was built during the last run (which must be 0) and
       * why it cannot run here when it cannot. `'toggle'` starts a run or lets go of one, the same
       * as the key. An object tunes it live and nothing is saved: `{ top }` the top speed in m/s,
       * `{ spinUp, brake }` the seconds up and down, `{ standOff }` how far short of a planet's
       * surface it stops, `{ edge }` how far the system reaches, `{ countdown, settleWait }` the
       * two waits, `{ fxAhead, fxTurn }` where the streaks sit on the hull.
       */
      cruise: (arg?: 'toggle' | Partial<typeof CRUISE_TUNE>) => {
        if (arg === 'toggle') return this.ultraCruise.toggle();
        if (arg && typeof arg === 'object') tuneCruise(arg);
        return this.ultraCruise.describe();
      },
      suns: (opts?: { rule?: SunRule; companionDegrees?: number; skyShare?: number; standInDistance?: number; quadAt?: number; quadTan?: number; quadMargin?: number }) => {
        const sky = this.world.swgSky;
        // `quadAt`, `quadTan` and `quadMargin` are the depth stand-in of a body that stands somewhere
        // in the zone rather than hanging on the sky; they take effect on the next frame drawn.
        if (opts && (opts.companionDegrees !== undefined || opts.skyShare !== undefined || opts.standInDistance !== undefined || opts.quadAt !== undefined || opts.quadTan !== undefined || opts.quadMargin !== undefined)) tuneSpaceSky(opts);
        // Any of them can change which star keeps the sun company, so the pick is made again.
        if (opts) sky?.setSunRule(opts.rule ?? (sky.sunStar?.chosenBy === 'disc' ? 'disc' : 'glow'));
        const pick = sky?.sunStar ?? null;
        if (!pick) return { sun: 'no space zone here: a planet is lit by its day cycle', rays: { ...SPACE_SKY_TUNE } };
        return {
          rule: pick.chosenBy,
          ours: 'the game says nothing about which star is the sun; this rule is ours',
          sun: pick.sun ? { at: [pick.sun.yaw, pick.sun.pitch], disc: pick.sun.discSize, glow: pick.sun.glowSize } : null,
          companion: pick.companion ? { at: [pick.companion.yaw, pick.companion.pitch], glow: pick.companion.glowSize } : null,
          secondFlare: pick.second ? { at: [pick.second.yaw, pick.second.pitch], glow: pick.second.glowSize } : null,
          degreesFromFileLight: pick.lightOffDegrees === null ? null : Number(pick.lightOffDegrees.toFixed(1)),
          stars: pick.groups.length,
          lightDir: sky?.spaceLightDir?.toArray().map((v) => Number(v.toFixed(3))) ?? null,
          rays: { ...SPACE_SKY_TUNE },
        };
      },
      /**
       * The weather. No argument: the state (area, level, mix, effects, wetness, the roof grid, programs, cpuMs).
       * A number holds a level; 'rain' | 'dust' | 'snow' (and a level, 3 by default) forces a kind; null returns
       * to the schedule. An object: { level, kind, family, lifeDay, snap } force (merged with what is forced);
       * { wetness, puddles, snowCover } set at once; { timeScale, skip } run or skip the schedule's clock
       * (minutes); { find: 'moseisley' } where an area is (then __debug.teleport(x, z)); { windHeading } holds
       * the wind (radians, null frees it); { emitters: true } adds the falling effects' emitter rows;
       * { draw: false } skips the weather pass (to time it); { wrap: false | true } whether world materials
       * get the wet wrap (read at load: reload to apply).
       */
      weather: (arg?: number | 'rain' | 'dust' | 'snow' | null | Record<string, unknown>, level?: number) => {
        const w = this.world.weather;
        let emitters = false;
        if (arg === null) w.force(null);
        else if (typeof arg === 'number') w.force({ ...(w.forcedNow ?? {}), level: arg });
        else if (typeof arg === 'string') w.force({ ...(w.forcedNow ?? {}), kind: arg, level: level ?? 3 });
        else if (arg && typeof arg === 'object') {
          const o = arg as Record<string, unknown>;
          if (typeof o.find === 'string') return this.world.terrain.swg?.environmentAreaCentre(o.find) ?? 'no such area';
          if ('wrap' in o) {
            try {
              if (o.wrap === false) localStorage.setItem('swg.weather.wrap', '0');
              else localStorage.removeItem('swg.weather.wrap');
            } catch {
              return 'no storage in this browser';
            }
            return 'reload to apply';
          }
          const patch: Record<string, unknown> = {};
          for (const k of ['level', 'kind', 'family', 'lifeDay', 'snap']) if (k in o) patch[k] = o[k];
          if (Object.keys(patch).length) w.force({ ...(w.forcedNow ?? {}), ...(patch as import('./world/weather').WeatherForce) });
          const wet: Record<string, number> = {};
          for (const k of ['wetness', 'puddles', 'snowCover']) if (typeof o[k] === 'number') wet[k] = o[k] as number;
          if (Object.keys(wet).length) w.setWet(wet);
          if (typeof o.timeScale === 'number' || typeof o.skip === 'number') w.setClock({ timeScale: typeof o.timeScale === 'number' ? o.timeScale : undefined, skipMinutes: typeof o.skip === 'number' ? o.skip : undefined });
          if ('windHeading' in o) w.holdWind(typeof o.windHeading === 'number' ? o.windHeading : null);
          if (typeof o.draw === 'boolean') w.drawPass = o.draw;
          emitters = o.emitters === true;
        }
        this.hud.setWeatherNote(w.heldNote());
        return w.describe({ emitters });
      },
      /** The lens flare this frame: every source slot the sky has, whether it is on, its visibility ([smoothed, depth open, cloud transmittance]) and `turn`, the degrees right and up to face it whatever steers the view. */
      flare: () => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/lensFlare').LensFlarePass>('lensFlare');
        if (!fx) return 'the effects are off: the flare is one of them';
        if (!pass) return 'the lens flare is not registered on this chain';
        this.drawFrame();
        return { ...pass.report(fx.ctx), visibility: pass.readVisibility(), sky: this.world.swgSky?.describe().flare ?? null };
      },
      /** Change the flare's look live (`{ streak: 0.5 }`, `{ debugOnly: true }` for the flare alone on black, `{ nightSuns: false }`), or `'reset'`; kept across the Effects switch until a reload, never saved. */
      flareTune: (patch?: Partial<import('./core/fx/flareMath').FlareLook> | 'reset') => {
        // The module's live look: tuned with the effects off too, and read by the pass when they come on.
        return tuneFlareLook(patch);
      },
      /** Measure the next frame round the first sun on screen: pixels over white and over the flare's ceiling, before and after it (the counts must match). */
      flareProbe: () => {
        const fx = this.postfx;
        const pass = fx?.pass<import('./core/fx/lensFlare').LensFlarePass>('lensFlare');
        if (!fx || !pass) return 'the effects are off: the flare is one of them';
        pass.probeWanted = true;
        this.drawFrame();
        if (pass.probeWanted) {
          pass.probeWanted = false;
          return { error: `the flare did not draw: ${pass.reason(fx.ctx) ?? 'switched off'}` };
        }
        return pass.lastProbe;
      },
      /** Point the camera at sun `i` (by default the first one up: Mustafar's night sun is slot 1), `offset` radians of yaw aside so the head does not hide it; on foot or riding only (flying, aboard and adrift, steer by `flare().sources[i].turn`). */
      faceSun: (slot?: number, offset = 0.25) => {
        const p = this.player;
        const flown = p.mounted ?? p.piloting;
        const steer = `turn by hand: __debug.flare().sources[${slot ?? 0}].turn says how far right and up`;
        if (flown?.spec.ship && flown.airborne) return `flying: the view follows the ship; ${steer}`;
        if (p.aboard) return `aboard a ship: the view is in the hull's frame; ${steer}`;
        if (p.eva) return `adrift: the view is in the body's frame; ${steer}`;
        // The frame input's kept list, which drawFrame refills every frame: the effects need not be on.
        const lights = this.fxInput.skyLights;
        const n = this.world.skyLights(lights, flareLook.nightSuns);
        const up = (k: number) => k >= 0 && k < n && lights[k].alpha > 0.002;
        let i = 0;
        if (slot === undefined) {
          while (i < n && !up(i)) i++;
          if (i >= n) return `no sun up now (${n} flare slots)`;
        } else if (!Number.isInteger(slot) || !up(slot)) return `no sun ${slot} up now (${n} flare slots, numbered from 0)`;
        else i = slot;
        const d = lights[i].dir;
        this.cam.yaw = Math.atan2(-d.x, -d.z) + offset;
        this.cam.pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), -1.25, 1.4);
        return { slot: i, direction: d.toArray().map((v) => Number(v.toFixed(3))), yaw: Number(this.cam.yaw.toFixed(3)), pitch: Number(this.cam.pitch.toFixed(3)) };
      },
      /** Bolts in the air: whose, where, which way, how fast, whether drawn as the game's projectile effect, how many have flown and been blocked, and the ship effects' state. */
      bolts: () => ({ fired: { ...this.world.bolts.fired }, blocked: this.player.blocks, inFlight: this.world.bolts.bolts.map((b) => ({ owner: b.owner, reflected: b.reflected, at: b.pos.toArray().map((v) => Number(v.toFixed(1))), dir: b.dir.toArray().map((v) => Number(v.toFixed(2))), speed: Math.round(b.speed), effect: b.fx?.file ?? null })), shipEffects: this.world.shipFx.status, target: this.shipTarget?.spec.id ?? null, lead: this.shipLeadValid ? this.shipLead.toArray().map((v) => Number(v.toFixed(1))) : null }),
      /** The turrets: where each stands, its health, whether it is down, and its shots. */
      turrets: () => this.world.turrets.turrets.map((t) => ({ at: t.pos.toArray().map((v) => Number(v.toFixed(1))), distance: Number(t.pos.distanceTo(this.player.pos).toFixed(1)), hp: t.hp, dead: t.dead, shots: t.shots })),
      /** Stand a turret `distance` metres ahead of the player, facing them, and report where. */
      turret: (distance = 20) => {
        this.cam.forward(tmp);
        const x = this.player.pos.x + tmp.x * distance;
        const z = this.player.pos.z + tmp.z * distance;
        const t = this.world.turrets.place(x, z, Math.atan2(-tmp.x, -tmp.z));
        return t.pos.toArray().map((v) => Number(v.toFixed(1)));
      },
      /** Fire a bolt at the player from `distance` metres in front, as an enemy would, for testing blocks. */
      shootPlayer: (distance = 15) => {
        this.cam.forward(tmp);
        boltFrom.copy(this.player.pos).addScaledVector(tmp, distance);
        boltFrom.y += 1.15;
        tmp.negate();
        this.world.bolts.fire(boltFrom, tmp, { owner: 'enemy', damage: 15 });
        return this.world.bolts.bolts.length;
      },
      /** Full health, for tests that stand in front of the turrets. */
      heal: () => {
        this.player.heal(this.player.maxHp);
        return this.player.hp;
      },
      /** Play any clip the player's rig has, looping (or once), to see it on the player: `__debug.anim('BOTH_A2_SPECIAL')`; no name stops it. */
      anim: (name?: string, loop = true) => {
        const rig = this.player.rig;
        if (!rig) return 'no rig';
        if (!name) {
          rig.stopOverride();
          return 'stopped';
        }
        const clips = rig.clipsMatching(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        const exact = rig.has(name) ? name : clips[0];
        if (!exact) return `no clip matches ${name}`;
        if (/^add_/.test(exact)) {
          rig.playUpper(exact);
          return { playing: exact, note: 'an additive clip: played once as a delta over the current pose', matches: clips.slice(0, 20) };
        }
        rig.play(exact, { loop, hold: !loop });
        return { playing: exact, matches: clips.slice(0, 20) };
      },
      /** Mount the nearest vehicle, or dismount, as E does. */
      mount: () => {
        this.handleMount();
        return this.player.mounted ? `riding ${this.player.mounted.spec.id}` : 'on foot';
      },
      /** Aboard a ship's rooms: stand at the pilot's spot and take the controls, as walking there and pressing E does; `controls(false)` lets go. */
      controls: (take = true) => {
        const p = this.player;
        const room = p.aboard;
        if (!room) return 'not aboard a ship';
        if (!take) {
          p.piloting = null;
          return 'let go of the controls';
        }
        if (!room.pilotSpot) return 'this ship has no pilot spot in its rooms';
        p.pos.copy(room.pilotSpot);
        p.body.setTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, true);
        p.placeVisual();
        this.handleMount();
        return p.piloting ? `at the controls of the ${p.piloting.spec.id}` : 'could not take the controls';
      },
      /** The ship menu from the console: `ship()` or `ship('status')` reports what it would show; `ship('space')`, `ship('land')`, `ship('eject')` press its buttons; `ship('open')` opens it. */
      ship: (action: 'status' | 'open' | 'space' | 'land' | 'eject' = 'status') => {
        if (action === 'open') {
          this.toggleShipMenu();
          return this.shipMenu.open ? 'open' : 'not in a ship';
        }
        if (action === 'space') void this.goToSpace();
        else if (action === 'land') void this.landShip();
        else if (action === 'eject') void this.eject();
        const s = this.shipStatus();
        const p = this.player;
        return { ...s, gate: this.spaceGate, aboard: !!p.aboard, piloting: !!p.piloting, mounted: !!p.mounted, local: p.aboard ? p.pos.toArray().map((n) => Number(n.toFixed(2))) : null, heading: Number(p.heading.toFixed(2)) };
      },
      /** How a clip splits between the upper body and the legs (`split('BOTH_RUN2')`): the bones each half drives, the bone the split is at, and the weights of the actions playing now. */
      split: (clip: string) => this.player.rig?.splitInfo(clip) ?? 'no rig',
      /** The clip the rig's selector picks for a value: `variant('loop_riding', 'vehicle_hover_chair')`, `variant('skill_action_3', 'dance_18')`. */
      variant: (base: string, value: string) => this.player.rig?.variant(base, value) ?? 'no rig',
      /** Travel to a world by id (`travel('space_tatooine')`), as the galaxy map does; a space zone is arrived at in the ship last flown. */
      travel: (id: string) => {
        void this.travel(planetById(id));
        return `travelling to ${id}`;
      },
      /**
       * The System Map's lists (`await jumps()` for the zone flown in, `jumps('space_light1')` for another): every system's title,
       * and the zone's destinations with their keys for `jump`, how far each is from the ship (km, this zone only), whether it is
       * made up, and why it cannot be jumped to now.
       */
      jumps: async (zone?: string) => {
        const cat = await this.catalogue();
        const here = zone ?? this.world.planet.id;
        const sys = cat.systems.find((s) => s.id === here);
        const ship = this.pilotedShip();
        return {
          systems: cat.systems.map((s) => `${s.title}${s.pack?.hyperspace ? '' : ' (not converted)'}`),
          here,
          destinations: (sys?.destinations ?? []).map((d) => {
            let km: number | null = null;
            if (ship && d.zone === this.world.planet.id) {
              const g = toGame(d.at);
              km = Number((Math.hypot(g[0] - ship.pos.x, g[1] - ship.pos.y, g[2] - ship.pos.z) / 1000).toFixed(2));
            }
            return { key: d.key, name: d.name, kind: d.kind, km, invented: d.invented, why: this.hyperspace.why(d) };
          }),
        };
      },
      /**
       * Start a jump to a destination by its key (`jump('space_tatooine:space_tatooine_2')`); `{ now: true }` skips the countdown.
       * Answers why it cannot, or that it has begun: 'jumping' with `now` means the enter stage starts on the next frame (in a
       * hidden tab, the next `advance`), so `jumpState()` read at once still says `countdown`.
       */
      jump: async (key: string, opts: { now?: boolean } = {}) => {
        const cat = await this.catalogue();
        const d = cat.find(key);
        if (!d) return `no destination ${key}: see __debug.jumps(zone) for the keys`;
        const why = this.hyperspace.start(d, opts.now ? 0 : undefined);
        if (why !== null) return why;
        if (this.hyperspaceUi.open) {
          this.hyperspaceUi.hide();
          this.freeMouse(false);
        }
        return opts.now ? 'jumping' : 'counting down';
      },
      /**
       * The jump now: its phase, time in it, destination, the cruise it commands, the hull's ghosting, how closed the tunnel
       * is (`tunnel` 0..1, `covered` when closed), whether the others are told not to show the ship (`hidden`), whether the
       * hull came through another system itself (`carried`), programs made while the tunnel was closed, hits taken (should
       * be 0), how far off the arrival was, the worst frame seen while the tunnel was not closed; and the camera's far plane.
       */
      jumpState: () => ({ ...this.hyperspace.describe(), far: this.cam.camera.far, crew: this.jumpCrew ? (this.player.aboard?.vehicle === this.jumpCrew ? 'aboard' : 'outside') : null }),
      /**
       * The NPC ships: the cap and how many are out, the anchors (name, side, distance, their groups' states), the groups
       * (side, formation, members: type, tier, state, target, shields/armour/hull, shots, hits, distance, ready, paused),
       * NPC bolts in the air, the programs, the portal set's and the cascades' sizes (`materials`, the leak check), and
       * `ms: { think, physics }`. `{ patrols: false }` stops the patrols streaming in, `{ passive: true }` every NPC's fire,
       * `{ clear: true }` takes every NPC ship away.
       */
      npcShips: (opts: { patrols?: boolean; passive?: boolean; clear?: boolean } = {}) => {
        const mgr = this.world.npcShips;
        const data = this.world.ships.data;
        let cleared: number | null = null;
        if (mgr) {
          if (typeof opts.patrols === 'boolean') mgr.patrols = opts.patrols;
          if (typeof opts.passive === 'boolean') mgr.passive = opts.passive;
          if (opts.clear) cleared = mgr.clear();
        }
        return {
          combat: data ? { ...(data.file.counts ?? { types: data.file.types.length }) } : "no combat.json in the ships pack: no NPC ships (npm run swg -- ships '@SWG' assets-private --retail-only)",
          ...(cleared !== null ? { cleared } : {}),
          ...(mgr ? mgr.report() : { live: 0, note: 'no world loaded' }),
          contacts: this.world.ships.list.map((c) => `${c.label || c.vehicle.spec.id} (${c.faction}${c === this.world.ships.playerShip ? ', yours' : ''}${c.targetable ? '' : ', not targetable'})`),
          target: this.targetFx.describe(),
          programs: this.renderer.info.programs?.length ?? 0,
          materials: this.world.materialCounts(),
          ms: { think: Number((mgr?.ms.think ?? 0).toFixed(3)), physics: Number(stats.physicsMs.toFixed(3)) },
        };
      },
      /**
       * Stand NPC ships ahead of the view: `await npcShip('tiefighter_tier1', { distance: 400 })` one of a type, or a family
       * with `{ tier, count: 3 }` for a patrol in formation; 700 m ahead by default, facing you. Returns the sentence.
       */
      npcShip: async (what = 'tiefighter', opts: { tier?: number; count?: 1 | 3; distance?: number } = {}) => {
        const mgr = this.world.npcShips;
        const data = this.world.ships.data;
        if (!mgr) return 'no world loaded';
        if (!data) return "no combat.json in the ships pack: convert the ships again (npm run swg -- ships '@SWG' assets-private --retail-only)";
        const type = data.typeById(what);
        const family = type ? type.family : what;
        const tier = opts.tier ?? type?.tier ?? (this.world.planet.space ? (ZONE_TIER[this.world.planet.id] ?? 3) : 3);
        const p = this.player;
        const flown = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const from = (flown ? flown.pos : p.worldPos).clone();
        const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return mgr.spawnFamily(family, tier, opts.count === 3 ? 3 : 1, from, dir, opts.distance ?? 700);
      },
      /**
       * The flown ship's fight (or with `target: true` the target's): its stats, condition, components with grades, what is
       * down, and its top speed (`speed`, m/s where it flies). `{ hit: 'shield' | 'armor' | 'chassis' | '<slot>', amount: 0..1 }`
       * strikes it through the same path as a bolt; `{ repair: true }`; `{ god: true | false }` (it takes no damage);
       * `{ stats: { refire: 0.3 } }` overrides its numbers live.
       */
      shipCombat: (opts: { target?: boolean; hit?: string; amount?: number; repair?: boolean; god?: boolean; stats?: Record<string, number> } = {}) => {
        const p = this.player;
        const v = opts.target ? this.shipTarget : (p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null);
        if (!v) return opts.target ? 'no target: Tab onto a ship first' : 'not in a ship';
        const combat = v.combat;
        if (!combat) return `${v.spec.id} has no fight (a ship gets one when it is spawned; is there a combat.json?)`;
        if (opts.repair) combat.repair();
        if (typeof opts.god === 'boolean') combat.god = opts.god;
        if (opts.stats) {
          const s = combat.stats as unknown as Record<string, unknown>;
          for (const [k, n] of Object.entries(opts.stats)) if (typeof n === 'number' && Number.isFinite(n) && typeof s[k] === 'number') s[k] = n;
        }
        const hit = opts.hit ? combat.forceHit(opts.hit, THREE.MathUtils.clamp(opts.amount ?? 1, 0, 1)) : null;
        return { ship: v.spec.id, ...(hit ? { hit: { ...hit } } : {}), ...combat.report(), speed: Math.round(v.spec.maxSpeed * (v.space ? 2 : 1)), cruise: Math.round(v.cruise), hp: Math.round(v.hp) };
      },
      /**
       * Mouse flight and the NPC pilots' skill, live (every number invented): `flight({ circleDeg: 6 })` and any of ringDeg,
       * deadZone, curve, snapDeg, convergeM, nearestM, speed; `flight({ npc: { 1: { stickMax: 0.8, response: 0.3 } } })` and
       * any of a tier's reaction, scatterDeg, gunConeDeg, lead, breakRange, evadeChance, stickMax, response. Returns them
       * all, with the cursor (half-heights from the boresight), the stick, and whether the guns aim through the cursor and
       * sit on the lead now.
       */
      flight: (opts: FlightTuneInput = {}) => ({ ...flightTune(opts), cursor: { ...this.flightCursor }, stick: { ...this.flightStick }, aiming: this.flightAiming, onLead: this.flightOnLead, range: Math.round(this.flightRange) }),
      /** Show an NPC pilot's line: `taunt('imperial', 'entercombat')` (a table that names you), `taunt('pirate', 'death')`. */
      taunt: (faction: ShipFaction = 'imperial', event: 'entercombat' | 'gothit' | 'hityou' | 'death' = 'entercombat') => {
        const data = this.world.ships.data;
        if (!data) return 'no combat.json in the ships pack';
        // A type of that side from tier 3 up (the tiers 1 and 2 tables name nobody), picked at random.
        const types = data.file.types.filter((t) => t.faction === faction && t.tier >= 3 && data.taunts(t.taunts));
        const type = types[Math.floor(Math.random() * types.length)];
        const lines = type ? data.taunts(type.taunts)?.[event] ?? [] : [];
        const line = pickLine(lines, Math.random);
        if (!type || !line) return `no ${event} line for ${faction}`;
        const text = fillTaunt(line, this.world.ships.playerName);
        this.shipHud.say(type.name, text, FACTION_COLOR[faction]);
        return `${type.name} (${type.taunts}): ${text}`;
      },
      /**
       * The warp effects' turn about the hull's Y (degrees) and how far ahead of the hull they are placed (metres along the
       * nose), for checking by eye; the next jump uses them. The tunnel's look, all invented and live: `radius` (over the
       * jump camera's distance behind the ship), `minRadius` (hull radii), `length` (half-length in radii; these three at
       * the next jump), `spin` (turns a second), `speed` (the streaks' run), `glow`, and `cull` (false: the camera's far
       * plane is left alone while the tunnel is closed, so the world is drawn behind it). The timing, invented and live:
       * `close` and `open` (seconds the tunnel takes to close round the ship and to open ahead of it), `min` (the least
       * seconds inside it) and `zoom` (the pilot's held view, 0.7 to 24; 7 is the camera's default).
       */
      jumpFx: (opts: { turn?: number; ahead?: number; radius?: number; minRadius?: number; length?: number; spin?: number; speed?: number; glow?: number; cull?: boolean; close?: number; open?: number; min?: number; zoom?: number } = {}) => {
        const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
        if (num(opts.turn)) this.hyperspace.fxTurn = opts.turn;
        if (num(opts.ahead)) this.hyperspace.fxAhead = opts.ahead;
        const look = this.jumpTunnel.look;
        for (const k of ['radius', 'minRadius', 'length', 'spin', 'speed', 'glow'] as const) {
          const v = opts[k];
          if (num(v)) look[k] = v;
        }
        if (typeof opts.cull === 'boolean') look.cull = opts.cull;
        const times = TUNNEL_TIMES;
        for (const k of ['close', 'open', 'min'] as const) {
          const v = opts[k];
          if (num(v)) times[k] = Math.max(0, v);
        }
        if (num(opts.zoom)) times.zoom = Math.min(24, Math.max(0.7, opts.zoom));
        return { ...this.world.hyperspaceEffects(), turn: this.hyperspace.fxTurn, ahead: this.hyperspace.fxAhead, times: { ...times }, tunnel: { ...look, size: { ...this.jumpTunnel.size }, far: this.jumpTunnelFar, shown: this.jumpTunnel.shown } };
      },
      /**
       * Nudge the ridden vehicle's seat by metres in its own frame (right, up, forward) and report where it now is, with the pose
       * playing and its root offset, for finding a seat by eye. In a ship seated by its cockpit eye the body moves under the eye
       * and the view stays put; `paste` is the line for COCKPIT_BODY_NUDGE in cockpitSeat.ts.
       */
      seat: (dx = 0, dy = 0, dz = 0) => {
        const v = this.player.mounted;
        if (!v) return 'not riding anything';
        if (v.eyeSeat) {
          v.bodyNudge[0] += dx;
          v.bodyNudge[1] += dy;
          v.bodyNudge[2] += dz;
          this.player.syncMount();
          const r = this.player.seatReport;
          const frame = frameFileName(v.def?.cockpit?.file);
          const eye = v.cockpitEye(tmp);
          const n3 = (n: number) => Number(n.toFixed(3));
          return { vehicle: v.spec.id, frame: frame || null, eye: eye ? eye.toArray().map(n3) : null, eyeSource: v.eyeSource, bodyNudge: v.bodyNudge.map(n3), seatDrop: v.seatDrop === null ? null : n3(v.seatDrop), lift: n3(r.lift), riderPose: v.riderPose, clip: r.clip, paste: `'${frame}': [${v.bodyNudge.map((n) => n3(n)).join(', ')}],` };
        }
        v.seat.position.x += dx;
        v.seat.position.y += dy;
        v.seat.position.z += dz;
        const clip = this.player.rig?.currentClip ?? null;
        const root = clip ? this.player.rig?.rootOffset(clip, tmp) : null;
        return { vehicle: v.spec.id, seat: v.seat.position.toArray().map((n) => Number(n.toFixed(2))), seatIsPelvis: v.seatPelvis, riderPose: v.riderPose, seatFrom: v.seatFrom, saddle: !!v.saddle, clip, clipRoot: root ? root.toArray().map((n) => Number(n.toFixed(2))) : null };
      },
      /** The garage: `vehicles('speeder')` lists what can be spawned; `spawn('speeder_ab1')` or `spawn('bantha', 'ground')` stands one in front of you; `vehicles.clear` is the panel's Remove all. */
      vehicles: (find?: string) => {
        const g = this.garage ?? this.world.garage;
        if (!g) return 'the garage is not loaded yet: open it with G once, or call spawn()';
        const f = find?.toLowerCase();
        return { onWorld: this.world.vehicles.map((v) => `${v.spec.id} (${v.spec.kind}${v === this.player.mounted ? ', ridden' : ''}) at ${v.pos.toArray().map((n) => n.toFixed(0)).join(',')}`), garage: g.vehicles.filter((v) => !f || v.id.toLowerCase().includes(f) || v.kind.includes(f)).map((v) => `${v.id}: ${v.kind}${v.inferred ? '' : ' (guessed)'}, ${v.source}`).slice(0, 80) };
      },
      /** Stand a plain box of the given size in front of you as a vehicle of `kind`, for handling tests without a model. */
      spawnBox: (w = 1, h = 1, l = 2.4, kind: VehicleKind = 'speederbike') => {
        const bounds = { min: [-w / 2, 0, -l / 2] as [number, number, number], max: [w / 2, h, l / 2] as [number, number, number] };
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshStandardMaterial({ color: 0x8899aa }));
        mesh.position.y = h / 2;
        const v = this.world.addVehicle(specFor(kind, 'box', 'box', bounds), mesh, this.player.pos, this.player.heading);
        return `box ${w}×${h}×${l} spawned as a ${kind} at ${v.pos.toArray().map((n) => n.toFixed(1)).join(',')}`;
      },
      /** Change the ridden (else the nearest) vehicle's handling live: `vehicleTune({ bank: 0, turnRate: 1.2 })`, a ship's `{ inertia: 1, turnRate: 0.8 }`; returns the spec. */
      vehicleTune: (patch: Partial<import('./vehicles/vehicle').VehicleSpec> = {}) => {
        const v = this.player.mounted ?? [...this.world.vehicles].sort((a, b) => a.pos.distanceTo(this.player.pos) - b.pos.distanceTo(this.player.pos))[0];
        if (!v) return 'no vehicle';
        Object.assign(v.spec, patch);
        return v.spec;
      },
      /** Every vehicle's state: where, how level (1 upright, 0 on its side), how fast it turns and moves, and how many corners find the ground. */
      /** Set the ship whose room the player is in (or the nearest ship) adrift: forward speed and a spin (rad/s) with no gravity or righting, so the room's physics can be tried; `shipDrift(0)` brings it to rest. */
      /** Move the cockpit frame over the seat of the ship you are in (metres right, up, forward), to find where it should sit; the numbers to report. */
      cockpitFrame: (dx = 0, dy = 0, dz = 0) => {
        FRAME_NUDGE.x += dx;
        FRAME_NUDGE.y += dy;
        FRAME_NUDGE.z += dz;
        const v = this.player.mounted;
        if (v?.cockpitFrame) {
          v.cockpitFrame.position.add(new THREE.Vector3(dx, dy, dz));
          // The frame's eye moves with it (its seat does too, so the seat's drop under the eye is unchanged).
          if (v.cockpit) v.cockpit = [v.cockpit[0] + dx, v.cockpit[1] + dy, v.cockpit[2] + dz];
          this.player.syncMount();
        }
        return `frame nudge ${FRAME_NUDGE.toArray().map((n) => n.toFixed(2)).join(', ')} (right, up, forward)`;
      },
      /**
       * The wings of the ship ridden, piloted or aboard (else the nearest ship): `wings('open')` / `wings('closed')` holds
       * them, `wings('toggle')` does what the wings key (U) does (the pilot's own choice, flipped), `wings('auto')` gives
       * them back to the flight rule (the console's hold and the pilot's choice both dropped), `wings('multiplier')` /
       * `wings('threshold')` picks how every ship reads its chassis's speed factor. Returns the report: the rule, the top
       * speed now, the drop and the clearance, each wing's share open and the hull hardpoint its mount stands on, each
       * moving collider's distance from its mesh, the guns and what was left off.
       */
      wings: (mode?: 'open' | 'closed' | 'toggle' | 'auto' | 'multiplier' | 'threshold') => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? [...this.world.vehicles].filter((o) => o.spec.ship && !o.autopilot).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
        if (!v) return 'no ship: spawn one (spawn(\'xwing\')) or board one';
        if (mode === 'open' || mode === 'closed') v.wings.force = mode;
        else if (mode === 'toggle') v.wings.toggle();
        else if (mode === 'auto') {
          v.wings.force = null;
          v.wings.pilot = null;
        } else if (mode === 'multiplier' || mode === 'threshold') WING_RULE.speed = mode;
        else if (mode !== undefined) return `wings: '${String(mode)}' is none of open, closed, toggle, auto, multiplier, threshold`;
        if (mode === 'open' && !v.airborne && v.wingDrop > 0) console.warn(`wings: forced open on the ground: they reach ${v.wingDrop.toFixed(1)} m under the belly and may stand in the terrain (the game never opens them there)`);
        return v.wingReport();
      },
      /**
       * How the ship ridden, piloted or nearest stands on the ground: `landing()` reports it, `landing({ gap: 0.1 })`
       * sets any of the invented numbers (LANDING in vehicles/landing.ts: gap, tilt, settle, reach, catchLead, hold,
       * hard, floorReach, spread, bandSlack) and `landing({ room: { spare: 4 } })` the ones for a ship in a building's
       * rooms (SHIP_ROOM: every, step, spare). `landing({ rule: 'springs' })` puts the older hover-only ride back for
       * every ship, `landing({ cut: true })` cuts its engines, so it comes down and settles where it stands (false
       * starts them again), and `landing({ up: true })` lifts it off. `__debug.advance` steps all of it, so a settle
       * can be watched from a hidden tab: `__debug.landing({ cut: true }); __debug.advance(4); __debug.landing()`.
       * Out in space `landing({ down: true })` asks the ship to set down on whatever is under it (and, once it
       * is down, to lift off again), and `landing({ space: { reach: 60 } })` sets the invented numbers for it
       * (SPACE_LANDING: reach, speed, spread, clear). The report's `space` block says whether anything is under it.
       */
      landing: (opts: { rule?: 'landing' | 'springs'; cut?: boolean; up?: boolean; down?: boolean; room?: Partial<typeof SHIP_ROOM>; space?: Partial<typeof SPACE_LANDING> } & Partial<typeof LANDING> = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? [...this.world.vehicles].filter((o) => o.spec.ship && !o.autopilot).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
        if (opts.rule === 'landing' || opts.rule === 'springs') SHIP_GROUND.rule = opts.rule;
        for (const k of Object.keys(LANDING) as (keyof typeof LANDING)[]) {
          const n = opts[k];
          if (typeof n === 'number' && Number.isFinite(n)) LANDING[k] = n;
        }
        for (const k of Object.keys(SHIP_ROOM) as (keyof typeof SHIP_ROOM)[]) {
          const n = opts.room?.[k];
          if (typeof n === 'number' && Number.isFinite(n)) SHIP_ROOM[k] = n;
        }
        for (const k of Object.keys(SPACE_LANDING) as (keyof typeof SPACE_LANDING)[]) {
          const n = opts.space?.[k];
          if (typeof n === 'number' && Number.isFinite(n)) SPACE_LANDING[k] = n;
        }
        if (!v) return 'no ship: spawn one (spawn(\'xwing\')) or board one';
        if (opts.cut === true) v.cutEngines();
        if (opts.cut === false) v.enginesOn();
        if (opts.up) v.liftOff();
        if (opts.down) v.askSetDown();
        return v.landReport();
      },
      /**
       * The gravity boots: `boots()` reports whether they hold and what they hold to, `boots({ on: true })` takes
       * hold of whatever is within reach out in space (the same as pressing E adrift), `boots({ off: true })` lets
       * go, and any of the invented numbers (SURFACE_ROOM in vehicles/surfaceRoom.ts: patch, reach, feel, release,
       * turn, stray, triangles, lift, gravity) is set by name: `boots({ turn: 180 })` snaps the view onto the face
       * under the feet twice as fast. `__debug.advance` steps it all, so a walk round a rock can be taken from a
       * hidden tab: `__debug.boots({ on: true }); __debug.advance(2, ['KeyW']); __debug.boots()`.
       */
      boots: (opts: { on?: boolean; off?: boolean } & Partial<typeof SURFACE_ROOM> = {}) => {
        for (const k of Object.keys(SURFACE_ROOM) as (keyof typeof SURFACE_ROOM)[]) {
          const n = opts[k];
          if (typeof n === 'number' && Number.isFinite(n)) SURFACE_ROOM[k] = n;
        }
        if (opts.on) this.bootsTake(null);
        if (opts.off && isSurfaceRoom(this.player.aboard)) this.leaveShip(false);
        const room = this.player.aboard;
        const up = isSurfaceRoom(room) ? new THREE.Vector3(0, 1, 0).applyQuaternion(roomTurn(room)) : null;
        return {
          on: isSurfaceRoom(room),
          space: this.world.planet.space,
          note: this.bootsNote,
          up: up ? up.toArray().map((n) => Number(n.toFixed(3))) : null,
          at: this.player.worldPos.toArray().map((n) => Number(n.toFixed(2))),
          ...(isSurfaceRoom(room) ? room.report() : { tune: { ...SURFACE_ROOM } }),
        };
      },
      /**
       * Docking at a station: `dock()` reports where it stands and every hull in the zone with lanes,
       * `dock({ laneSpeed: 60 })` sets any of the invented numbers (DOCK_TUNE in space/dockingMath.ts:
       * ask, laneSpeed, dockSpeed, gain, arrive, standOff, linkCos, linkMax, bank, settle, repair,
       * sideCos, approachCos, nearLeg, flyBy, budget, faceCos) and `dock({ face: 'lane' })` chooses
       * what a parked ship faces (auto, hardpoint, lane). `sideCos` and `approachCos` are the two
       * bearings that decide whether a lane can be reached from where the ship stands without crossing
       * the hull: at -1 both are off and the row offers a lane from anywhere, as it used to.
       * `dock({ go: true })` asks for a lane in the ship flown, `{ go: false }` launches or breaks off.
       * `dock({ clamp: { gap: 3 } })` sets the ship-to-ship clamp's own numbers (CLAMP_TUNE, all invented)
       * and `dock({ allow: false })` turns away another player asking for room on this hull.
       * `__debug.advance` steps it, so a whole approach can be watched from a hidden tab.
       */
      dock: (opts: { go?: boolean; face?: 'auto' | 'hardpoint' | 'lane'; clamp?: Partial<typeof CLAMP_TUNE>; allow?: boolean } & Partial<typeof DOCK_TUNE> = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting ?? null;
        const out = this.docking.tune(opts);
        if (opts.go === true) return { asked: v ? this.docking.dock(v) : 'no ship is being flown', ...this.docking.report() };
        if (opts.go === false) return { said: this.docking.act(v), ...this.docking.report() };
        return out;
      },
      /**
       * The astromechs in their sockets: `droid({ shown: 0.4 })` sets the share of a droid's height shown over its socket
       * for every hull without its own, `droid({ shown: 0.5, hull: 'vwing' })` one hull's own (DROID_SHOWN and
       * DROID_SHOWN_BY_HULL in shipFit.ts); every droid on the world is sunk again at once. Returns each: its hull, the
       * share, how far it is sunk and its height.
       */
      droid: (opts: { shown?: number; hull?: string } = {}) => {
        if (typeof opts.shown === 'number' && Number.isFinite(opts.shown)) {
          if (opts.hull) DROID_SHOWN_BY_HULL[opts.hull] = opts.shown;
          else DROID_SHOWN.share = opts.shown;
        }
        const n3 = (n: number) => Number(n.toFixed(3));
        const out: { ship: string; shown: number; sunk: number; height: number }[] = [];
        for (const v of this.world.vehicles) {
          const id = v.def?.id;
          if (!id) continue;
          v.group.traverse((o) => {
            const span = o.userData.droidSpan as [number, number] | undefined;
            if (!o.userData.droid || !Array.isArray(span)) return;
            const shown = droidShown(id);
            const sunk = droidSink(span[0], span[1], shown);
            o.position.y = -sunk;
            out.push({ ship: id, shown: n3(shown), sunk: n3(sunk), height: n3(span[1] - span[0]) });
          });
        }
        return out.length ? out : 'no droid in a socket on the world: edit a ship with a socket (the X-wing), pick R2, spawn it';
      },
      /**
       * The cockpit of the ship ridden or piloted: where the eye is and where it came from, the seat under it, the body's lift
       * and how far the figure's eyes are from the camera, the view in use. `cockpit({ offset: false })` takes the cockpit
       * file's first-person offset off the view (true puts it back; the body stays where the whole offset puts it),
       * `cockpit({ share: 0.5 })` sets the share of that offset the view and the seated eyes take (COCKPIT_OFFSET_SHARE, this
       * ship until it is spawned again), `cockpit({ cushion: true })` seats every ship's pilot on the cushion under the eye as
       * before (false: the eyes on the eye), `cockpit({ bridgeHull: false })` hides the hull around a bridge pilot flying in
       * first person (true shows it again).
       */
      cockpit: (opts: { offset?: boolean; share?: number; cushion?: boolean; bridgeHull?: boolean } = {}) => {
        const p = this.player;
        const v = p.mounted ?? p.piloting;
        if (!v || !v.spec.ship) return 'not seated in a ship';
        if (opts.offset !== undefined) v.cockpitOffset = opts.offset ? mirroredOffset(v.def?.cockpit?.firstOffset) : [0, 0, 0];
        if (typeof opts.share === 'number' && Number.isFinite(opts.share)) v.cockpitShare = THREE.MathUtils.clamp(opts.share, 0, 1);
        if (opts.cushion !== undefined) {
          SEAT_RULE.place = opts.cushion ? 'cushion' : 'eyes';
          for (const o of this.world.vehicles) if (o.eyeSeat) o.seatDrop = seatDropUsed(o.cushionDrop);
        }
        if (opts.bridgeHull !== undefined) this.bridgeHullInFlight = opts.bridgeHull;
        p.syncMount();
        const n3 = (n: number) => Number(n.toFixed(3));
        const v3 = (a: THREE.Vector3 | readonly number[] | null) => (a ? (Array.isArray(a) ? a : (a as THREE.Vector3).toArray()).map(n3) : null);
        const seated = p.mounted === v && v.eyeSeat;
        const free = this.input.held('freeLook');
        const inCockpit = seated && this.cam.firstPerson;
        const view = free && (v.airborne || inCockpit) ? 'free look' : v.airborne ? 'chase' : inCockpit ? 'cockpit' : 'orbit';
        const eyeLocal = this.shipEyeLocal(v, new THREE.Vector3());
        const model = v.group.children[0];
        const authored = eyeLocal && model ? eyeLocal.clone().sub(model.position) : null;
        const off = v.def?.cockpit?.firstOffset ?? null;
        const want = mirroredOffset(off);
        const offsetOn = !!off && v.cockpitOffset.every((n, i) => Math.abs(n - want[i]) < 1e-9) && want.some((n) => n !== 0);
        const base = { ship: v.spec.id, seated, source: v.eyeSource, eye: v3(eyeLocal), authored: v3(authored), firstOffset: off ? [...off].map(n3) : null, offsetOn, share: n3(v.cockpitShare), seatRule: SEAT_RULE.place, view, locked: view === 'cockpit' && !v.airborne, bridgeHull: this.bridgeHullInFlight };
        if (!seated) return { ...base, seatDrop: null, lift: null, scale: null, bodyNudge: null, seatGap: null, eyeGapClip: null, eyeGapLive: null };
        const r = p.seatReport;
        const camEye = this.shipEyeWorld(v, new THREE.Vector3());
        // Where the seated clip's eyes land: the figure's matrix over the clip's first frame (or the stock seated figure).
        p.group.updateMatrixWorld(true);
        const clipEye = new THREE.Vector3();
        const clipPelvis = new THREE.Vector3();
        if (!(r.clip && p.rig?.seatedPoints(r.clip, clipEye, clipPelvis))) clipEye.fromArray(SEATED_EYE_FALLBACK).multiplyScalar(r.scale);
        clipEye.applyMatrix4(p.group.matrixWorld);
        // The live eyes: the eye joints' middle, else the head joint plus the head-to-eye step, scaled and turned with the figure.
        let liveEye: THREE.Vector3 | null = null;
        const rig = p.rig;
        if (rig) {
          const eyeBones = rig.boneNames.filter((n) => /^[lr]_?eye$/i.test(n)).map((n) => rig.bone(n)!);
          if (eyeBones.length >= 2) liveEye = eyeBones[0].getWorldPosition(new THREE.Vector3()).add(eyeBones[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
          else {
            const head = rig.boneFor('head');
            if (head) liveEye = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...HEAD_TO_EYE).multiplyScalar(r.scale).applyQuaternion(p.group.quaternion));
          }
        }
        return {
          ...base,
          seatDrop: v.seatDrop === null ? null : n3(v.seatDrop),
          lift: n3(r.lift),
          scale: n3(r.scale),
          bodyNudge: v.bodyNudge.map(n3),
          // How far the pelvis sits over the cushion measured under the eye (negative: in it), whichever rule placed the body.
          cushion: v.cushionDrop === null ? null : n3(v.cushionDrop),
          seatGap: v.cushionDrop === null ? null : n3(v.cushionDrop - r.eyeOverPelvis + r.lift + v.bodyNudge[1]),
          eyeGapClip: camEye ? n3(camEye.distanceTo(clipEye)) : null,
          eyeGapLive: camEye && liveEye ? n3(camEye.distanceTo(liveEye)) : null,
          clip: r.clip,
          firstPersonSeat: p.firstPersonSeat,
        };
      },
      /** Shadow casting by every mesh of the ship you are aboard (or the nearest ship): off, to see whether its own geometry is what keeps the sun out of the rooms. */
      shipShadows: (on = true) => {
        const p = this.player;
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship && !x.autopilot).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
        if (!v) return 'no ship';
        let n = 0;
        const changed: string[] = [];
        v.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const was = m.castShadow;
          m.castShadow = on && !(Array.isArray(m.material) ? m.material : [m.material]).some((mat) => mat.userData.glass || mat.userData.invisible || (mat.transparent && mat.opacity < 1));
          if (m.castShadow !== was) changed.push(`${m.name || '(unnamed)'} [${(Array.isArray(m.material) ? m.material : [m.material]).map((mat) => mat.name).join('|')}] visible=${m.visible} ${was}->${m.castShadow}`);
          n++;
        });
        console.info(`shipShadows(${on}): ${changed.length} meshes changed\n  ${changed.join('\n  ')}`);
        return `${v.spec.id}: ${n} meshes ${on ? 'cast shadows again' : 'cast no shadow'}, ${changed.length} changed (listed in the console)`;
      },
      /** Whether the figure pushes the dynamic bodies it walks into (off: a hull's triangles as the pushed shape crashed the engine). */
      pushBodies: (on = true) => {
        this.player.setPushBodies(on);
        return on ? 'the figure pushes bodies it walks into' : 'the figure pushes nothing';
      },
      shipDrift: (speed = 2, spin = 0.4) => {
        const p = this.player;
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship && !x.autopilot).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
        if (!v) return 'no ship';
        v.drift = speed !== 0 || spin !== 0;
        v.body.setGravityScale(v.drift ? 0 : 1, true);
        v.quaternion(tmpQ);
        tmp.set(0, 0, 1).applyQuaternion(tmpQ).multiplyScalar(speed);
        v.body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
        v.body.setAngvel({ x: spin * 0.35, y: spin, z: spin * 0.5 }, true);
        return v.drift ? `${v.spec.id} adrift at ${speed} m/s, spinning ${spin} rad/s` : `${v.spec.id} at rest`;
      },
      vehicleState: () => this.world.vehicles.map((v) => {
        v.quaternion(tmpQ);
        const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ).y;
        const a = v.body.angvel();
        const e = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ');
        const com = v.body.localCom();
        return { id: v.spec.id, kind: v.spec.kind, com: [com.x, com.y, com.z].map((n) => Number(n.toFixed(2))), at: v.pos.toArray().map((n) => Number(n.toFixed(2))), level: Number(upY.toFixed(3)), pitch: Math.round((e.x * 180) / Math.PI), roll: Math.round((e.z * 180) / Math.PI), spin: Number(Math.hypot(a.x, a.y, a.z).toFixed(3)), speed: Number(v.speed.toFixed(2)), corners: v.groundedPoints, ridden: v === this.player.mounted, hp: Math.round(v.hp), riderPose: v.riderPose, vel: [v.body.linvel().x, v.body.linvel().y, v.body.linvel().z].map((n) => Number(n.toFixed(2))), steer: Number(v.steer.toFixed(2)), heading: Number(v.heading.toFixed(2)), boosting: v.boosting, overheated: Number(v.overheated.toFixed(1)), meter: Number(v.meter.toFixed(2)), ...(v.wings.length ? { wingsOpen: Number(v.wingsOpen.toFixed(2)) } : {}), ...(v.spec.ship ? { airborne: v.airborne, target: this.shipTarget === v } : {}) };
      }),
      /** Remove every spawned vehicle except the one being ridden, as the garage's Remove all does. */
      unspawn: () => {
        this.world.removeVehicles(this.player.mounted ?? this.player.aboard?.vehicle ?? null);
        return this.world.vehicles.length;
      },
      spawn: async (name: string, kind?: VehicleKind) => {
        const def = (await this.loadGarage()).find(name);
        return def ? this.spawnVehicle(def, kind) : `no vehicle matches ${name}`;
      },
      /**
       * A ship's fit: `shipFit()` the ship ridden, flown or boarded (else the nearest spawned), as it stands: each slot's
       * component, its look of how many, the parts hung and those waiting for a carrier, the droid, the paint, and each
       * gun's slot, bolt and whether its muzzle is live; `shipFit('xwing')` a garage id's stock fit and its parts, with
       * what the character keeps.
       */
      shipFit: (id?: string) => this.shipFitReport(id),
      /**
       * Refit the ship ridden (else the nearest): `refit('engine', '<component>')`, `refit('weapon_0', 'wpn_light_blaster_green')`,
       * `refit('droid', 'r2')`; '' empties the slot. Kept with the character. Returns the refit's report and the programs the
       * swap made (`compiledOnSwap`, read two frames later, must be 0).
       */
      refit: (slot: string, component: string) => this.debugRefit(slot, component),
      /**
       * Repaint the ship ridden (else the nearest): `paint({ index_color_1: 20, index_texture_1: 2 })`, kept with the character;
       * `paint('static')` shows each shader's own texture from before customization, `paint('custom')` goes back. Returns the
       * same shape as `refit`.
       */
      paint: (values: Record<string, number> | 'static' | 'custom') => this.debugPaint(values),
      /** Open a ship's edit page: `shipEdit('xwing')`; `shipEdit()` reports what the page shows. */
      shipEdit: async (id?: string) => {
        if (!id) return this.shipEdit.report();
        const def = (await this.loadGarage()).find(id);
        if (!def) return `no vehicle matches ${id}`;
        this.openShipEdit(def);
        return def.fit ? `editing the ${def.label}` : `${def.id} has no fit in this pack (converted before ship customization); the page says so`;
      },
      /** The weapons rack: `weapons('dl44')` lists matches; `equip('dl44')` or `equip('dl44', 'left')` puts one in a hand, `equip(null, 'left')` empties it. */
      weapons: (find?: string) => {
        const c = this.weapons;
        if (!c) return 'no weapons converted (npm run swg -- weapons @SWG assets-private --retail-only)';
        const f = find?.toLowerCase();
        return { held: { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null }, styles: this.player.allowedStyles, weapons: c.weapons.filter((w) => !f || w.id.toLowerCase().includes(f) || w.class.includes(f)).map((w) => `${w.id} (${w.class}, ${w.length} m)`).slice(0, 80), leftOut: c.skipped.length };
      },
      equip: (name: string | null, hand: 'right' | 'left' = 'right') => {
        if (name === null) return this.equip(null, hand);
        const def = this.weapons?.find(name);
        return def ? this.equip(def, hand) : `no weapon matches ${name}`;
      },
      /** The backpack's state: what is owned (with the game's name, where it is and the species' verdict), worn and held, what is being put on, the record's `inv`. */
      items: () => {
        const snap = this.equipment.snapshot();
        const ctx = this.equipment.lastContext;
        const where = (kind: 'wear' | 'weapon', id: string) => (kind === 'weapon' ? (snap.held.right === id ? 'right' : snap.held.left === id ? 'left' : 'pack') : id in snap.worn ? 'worn' : 'pack');
        return {
          inv: snap.inv,
          record: snap.record,
          species: snap.species,
          wardrobe: snap.wardrobe,
          weapons: snap.weapons,
          owned: snap.owned.map((o) => {
            const info = ctx ? itemInfo(o.kind, o.id, ctx) : null;
            return { id: o.id, kind: o.kind, name: info?.name ?? o.id, where: where(o.kind, o.id), fit: info?.fit ?? null, missing: info?.missing ?? null };
          }),
          worn: snap.worn,
          held: snap.held,
          busy: snap.busy,
        };
      },
      /** Give an item: `give('wear', 'jacket_s02')`, `give('weapon', 'baton_stun')`. It goes in the backpack, not on. */
      give: async (kind: 'wear' | 'weapon', id: string) => {
        if (kind !== 'wear' && kind !== 'weapon') return "kind is 'wear' or 'weapon'";
        const ctx = await this.equipment.itemContext();
        const info = itemInfo(kind, id, ctx);
        if (info.missing) return kind === 'wear' ? `${id} is not in this character's wardrobe` : `${id} is not on the weapons rack`;
        if (!this.current || this.creating) return 'no character is being played';
        return this.equipment.give(kind, id) ? `${info.name} is in the backpack` : `${info.name} is owned already`;
      },
      /** Use an item as a double-click does (on or off, in hand or put away); `use('sword_lightsaber_training', 'left')` for the left hand. */
      use: async (id: string, hand?: 'left') => {
        const kind = await this.kindOf(id);
        if (!kind) return `${id} is neither on the rack nor in the wardrobe`;
        return this.useItem(`${kind}:${id}`, hand);
      },
      /** Destroy an owned item (taken off or put away first). */
      destroy: async (id: string) => {
        const owned = this.equipment.owned().find((o) => o.id === id);
        if (!owned) return `${id} is not owned`;
        return this.destroyItem(`${owned.kind}:${id}`);
      },
      /** The backpack panel's state: open, how many cells, selected, how many without a picture. */
      backpack: () => this.backpack.state(),
      /** The kit a class would get, resolved against this character's catalogues; nothing is given. */
      startingKit: (cls?: ClassId) => this.equipment.kit(cls ?? this.current?.class ?? this.kit.id),
      /** Whether the torso is held steady over running legs while a pose rides the upper body (on by default). */
      steady: (on?: boolean) => {
        if (this.player.rig && on !== undefined) this.player.rig.steady = on;
        return this.player.rig?.steady ?? null;
      },
      /** Play a clip once on the upper body over whatever the legs do (a shot, a gesture), as the game's shots play. */
      upper: (name: string) => {
        const rig = this.player.rig;
        if (!rig) return 'no rig';
        const d = rig.playUpper(name);
        return d === null ? `no clip ${name} (or a whole-body clip is playing)` : { playing: name, seconds: Number(d.toFixed(2)) };
      },
      /** The gallery world: how many mannequins are up and the animation slot nearest the player; `gallery(10)` widens the range they wake in (metres). */
      gallery: (range?: number) => {
        if (range !== undefined) RANGE.wake = Math.max(1, range);
        return this.world.gallery ? { ...this.world.gallery.status(), nearest: this.world.gallery.nearest(this.player.pos) } : 'not on the gallery planet (?planet=gallery)';
      },
      /**
       * Move the blade's axis in the hand to see where it looks right. `grip({ source: 'tags' })` swaps in the axis
       * the importer read from the game's own tag geometry (when it could), `grip({ source: 'solved' })` the one
       * solved from the swings; `grip({ tilt: 20, turn: -10 })` turns the axis by degrees about two axes at right
       * angles to it, for every clip alike (there is one true axis), and the result's `effective` field is the
       * axis to bake into the manifest. `stanceRoll` and `jkaRoll` roll the hilt about the forearm as before.
       */
      grip: (tune?: { jkaRoll?: number; stanceRoll?: number; source?: 'solved' | 'tags'; tilt?: number; turn?: number }) => {
        if (tune?.jkaRoll !== undefined) this.player.gripTune.jkaRoll = tune.jkaRoll;
        if (tune?.stanceRoll !== undefined) this.player.gripTune.stanceRoll = tune.stanceRoll;
        if (tune?.source !== undefined) this.player.gripTune.source = tune.source;
        if (tune?.tilt !== undefined) this.player.gripTune.tilt = tune.tilt;
        if (tune?.turn !== undefined) this.player.gripTune.turn = tune.turn;
        this.player.refitGrip();
        return { ...this.player.gripTune, effective: { right: this.player.tunedGrip('right'), left: this.player.tunedGrip('left') }, axes: this.player.rig?.grip ?? null };
      },
      /** How many lightsaber burns are on the world's surfaces now. */
      marks: () => this.marks.count(),
      /**
       * The lightsaber glow. No argument: the blades lit now, whether the pass drew, the light ceiling and the flash pool.
       * `show`: 'light' the added light over a dim picture, 'normals' the normals it lit with, 'rect' the box it worked in
       * tinted, null the picture. Any number of BLADE_GLOW_TUNE (`power`, `core`, `knee`, `range`, `albedo`, `hue`,
       * `glowDim`, `wrap`, `walls`, `far`, `fadeFrom`, `whiteness`, `marchMin`) retunes live, and `tune` in the result is
       * what to bake. `flashes: true` gives the blades their pooled lights back to compare. `occlusion: false` turns the
       * wall march off, `jitter: true` offsets its taps. `at: [x, y, z]` adds up, from the CPU copy of the shader without
       * the march, the light a neutral surface there facing each blade gets.
       */
      bladeGlow: (opts?: { show?: 'light' | 'normals' | 'rect' | null; flashes?: boolean; occlusion?: boolean; jitter?: boolean; at?: [number, number, number] } & Partial<BladeGlowTune>) => {
        const fx = this.postfx;
        const pass = fx?.pass<BladeGlowPass>('bladeGlow') ?? null;
        const notes: string[] = [];
        const r3 = (v: number) => Number(v.toFixed(3));
        if (opts) {
          const live = (what: string, apply: (p: BladeGlowPass) => void) => (pass ? apply(pass) : notes.push(`${what}: the glow pass is not running (Effects off, or the pass not installed)`));
          if (opts.show !== undefined) live('show', (p) => (p.debug = Math.max(0, BLADE_GLOW_VIEWS.indexOf(opts.show ?? 'picture'))));
          if (opts.occlusion !== undefined) live('occlusion', (p) => (p.occlusion = !!opts.occlusion));
          if (opts.jitter !== undefined) live('jitter', (p) => (p.jitter = !!opts.jitter));
          if (opts.flashes !== undefined) this.bladeGlowFlashes = !!opts.flashes;
          // Floors that keep the curve finite: a zero core or knee divides by zero at the blade.
          const floor: Partial<Record<keyof BladeGlowTune, number>> = { core: 1e-4, knee: 1e-3, range: 0.01, power: 0, albedo: 0, far: 0.01 };
          for (const key of Object.keys(BLADE_GLOW_TUNE) as (keyof BladeGlowTune)[]) {
            const v = opts[key];
            if (typeof v === 'number' && Number.isFinite(v)) BLADE_GLOW_TUNE[key] = Math.max(floor[key] ?? -Infinity, v);
          }
          if (BLADE_GLOW_TUNE.fadeFrom > BLADE_GLOW_TUNE.far - 0.01) BLADE_GLOW_TUNE.fadeFrom = BLADE_GLOW_TUNE.far - 0.01;
        }
        const raw = this.settings as unknown as Record<string, unknown>;
        const strength = typeof raw.bladeGlowStrength === 'number' ? raw.bladeGlowStrength : null;
        const eye = this.cam.camera.position;
        const list = createBladeList();
        collectBlades(list, this.player.saberBlades, this.world.npcs.npcs, eye, this.world.mobiles?.live);
        const row = fx?.describe().passes.find((p) => p.id === 'bladeGlow') ?? null;
        const seen = pass?.lastBlades ?? null;
        const rect = pass?.lastRect ?? null;
        let at: { point: number[]; perBlade: number[]; total: number } | null = null;
        if (opts?.at) {
          const per: number[] = [];
          const total = lightAt(new THREE.Vector3(...opts.at), list, strength ?? 1, per);
          at = { point: opts.at, perBlade: per.map(r3), total: r3(total) };
        }
        return {
          effects: !!fx,
          installed: !!pass,
          setting: fxPassDef('bladeGlow').toggles.some((k) => !!this.settings[k]),
          strength,
          shadows: typeof raw.bladeGlowShadows === 'boolean' ? raw.bladeGlowShadows : null,
          drewLastFrame: row?.drewLastFrame ?? false,
          why: row ? (row.why ?? null) : fx ? 'the glow pass is not installed' : 'Effects are off',
          ownsLight: this.bladeGlowOwnsLight(),
          flashes: this.bladeGlowFlashes,
          occlusion: pass?.occlusion ?? null,
          jitter: pass?.jitter ?? null,
          show: pass ? BLADE_GLOW_VIEWS[pass.debug] ?? pass.debug : null,
          blades: list.items.slice(0, list.count).map((b) => ({
            own: b.own,
            from: b.a.toArray().map((v) => Number(v.toFixed(2))),
            to: b.b.toArray().map((v) => Number(v.toFixed(2))),
            ignition: r3(b.ignition),
            intensity: r3(b.intensity),
            color: `#${b.color.getHexString()}`,
            distance: Number(Math.sqrt(segmentDistanceSq(eye, b.a, b.b)).toFixed(1)),
          })),
          rect: rect ? [rect.x0, rect.y0, rect.x1, rect.y1].map((v) => Number(v.toFixed(2))) : null,
          litCeiling: seen ? r3(seen.litCeiling) : null,
          up: seen ? seen.up.toArray().map(r3) : null,
          pool: this.effects.poolState(),
          gpuMs: row?.gpuMs ?? null,
          tune: { ...BLADE_GLOW_TUNE },
          at,
          notes,
        };
      },
      /** The Force powers in the slots: `powers(['grip', 'pull', null, 'repulse'])` sets them (ids from forcePowers.ts), no argument lists them. */
      powers: (ids?: (string | null)[]) => {
        if (ids) this.setSkills('jedi', ids);
        return { slots: this.jediKit().loadout, all: POWERS.map((p) => `${p.id}: ${p.name} (${p.kind}, ${p.cost})`) };
      },
      /** The Bounty Hunter's gadgets in the slots: `gadgets(['cryoban', 'trip_mine', 'det_pack'])` sets them (ids from gadgets.ts), no argument lists them. */
      gadgets: (ids?: (string | null)[]) => {
        if (ids) this.setSkills('bounty_hunter', ids);
        return { slots: this.hunterKit().loadout, ...this.hunterKit().status(), all: GADGETS.map((p) => `${p.id}: ${p.name} (${p.kind}, ${p.cost})`) };
      },
      /** Stand a creature of the planet `metres` ahead, for trying the powers and guns on. */
      creature: (metres = 8) => {
        const list = () => this.world.creatures.creatures.map((c) => ({ hp: Number(c.hp.toFixed(1)), at: c.pos.toArray().map((n) => Number(n.toFixed(2))), dist: Number(c.pos.distanceTo(this.player.pos).toFixed(2)), dead: c.dead, slowed: Number(c.slowed.toFixed(1)), held: c.held, grounded: c.grounded, ragdoll: c.ragdoll?.status ?? null }));
        if (metres <= 0) return list();
        const p = this.player.pos;
        this.cam.forward(tmp);
        this.world.creatures.spawnAt(p.x + tmp.x * metres, p.z + tmp.z * metres);
        return list();
      },
      /** Stand `n` of a catalogue entry `metres` ahead (an exact id or name, else the best find); waits for their models, so the answer says whether they are up. */
      mobile: async (idOrFind: string, metres = 10, n = 1) => {
        const mobiles = this.world.mobiles;
        const cat = this.world.mobileCatalogue;
        if (!mobiles) return 'no world loaded';
        if (!cat) return 'the creature and NPC catalogue has not loaded yet (or is not converted: npm run swg -- mobiles @SWG assets-private --retail-only)';
        if (this.player.aboard) return 'nothing can be stood aboard a ship’s rooms';
        const exact = cat.byId(idOrFind) ?? cat.resolve(idOrFind);
        const hits = exact ? [exact] : cat.search(idOrFind, { limit: 9 });
        const e = hits[0];
        if (!e) return `nothing in the catalogue matches "${idOrFind}"`;
        this.cam.forward(tmp);
        const r = mobiles.spawnAhead(e, this.player.pos, tmp, Math.max(1, Math.floor(n)), metres, this.world.inside);
        await Promise.all(r.mobiles.map((m) => mobiles.loaded(m)));
        return {
          entry: { id: e.id, name: e.name, kind: e.kind, group: e.group, pack: e.pack, appearance: e.appearance },
          spawned: r.spawned,
          note: r.note,
          matches: exact ? undefined : hits.slice(1).map((h) => h.id),
          mobiles: r.mobiles.map((m) => ({ ...m.describe(this.player.pos), error: mobiles.loadError(m) })),
        };
      },
      /** With no argument, every mobile out: state, health, distance, clip, target, tier, shadow. With a string, the catalogue search: the total and the first forty, with whether each can be stood and why not. */
      mobiles: (find?: string) => {
        const mobiles = this.world.mobiles;
        if (find === undefined) return (mobiles?.live ?? []).map((m) => m.describe(this.player.pos));
        const cat = this.world.mobileCatalogue;
        if (!cat) return 'the creature and NPC catalogue has not loaded yet (or is not converted: npm run swg -- mobiles @SWG assets-private --retail-only)';
        const all = cat.search(find, { limit: 100000 });
        return {
          total: all.length,
          first: all.slice(0, 40).map((e) => {
            const why = mobiles?.whyNot(e, cat) ?? null;
            return { id: e.id, name: e.name, kind: e.kind, group: e.group, ready: cat.ready(e).ok, standable: !why, why };
          }),
        };
      },
      /** An entry's pack and its roles by name, the gait speeds, the template's, and the walk and run the game will use: the feet check without spawning. */
      mobileRoles: async (id: string) => {
        const cat = this.world.mobileCatalogue;
        if (!cat || !this.world.mobiles) return 'the creature and NPC catalogue has not loaded yet';
        const e = cat.byId(id) ?? cat.resolve(id) ?? cat.search(id, { limit: 1 })[0];
        if (!e) return `nothing in the catalogue matches "${id}"`;
        return this.world.mobiles.rolesReport(e);
      },
      /** The model and pack cache: what is held, by whom, how many bytes, the referenced total against the budget, loads in flight. `mobileAssets(true)` trims now. */
      mobileAssets: (trim = false) => {
        const mobiles = this.world.mobiles;
        if (!mobiles) return 'no world loaded';
        const trimmed = trim ? mobiles.assets.trim() : null;
        const s = mobiles.assets.stats();
        const mb = (n: number) => Number((n / 1e6).toFixed(1));
        return { megabytes: mb(s.bytes), referencedMegabytes: mb(s.referenced), budgetMegabytes: mb(s.budget), loading: s.loading, failed: s.failed, trimmed, models: s.models, packs: s.packs };
      },
      /** Read or change live the brain's, the tiers' and the gaits' numbers, the cache budget (`{ budget: 260e6 }`), the cap and the animation range; `{ passMatrices: 'every' }` puts the portal renderer's scene walk back to once a pass, to measure what `'once'` saves. */
      mobileTune: (tune?: Parameters<import('./world/mobiles/manager').MobileManager['tune']>[0] & { passMatrices?: 'once' | 'every' }) => {
        if (tune?.passMatrices) this.portals.matrixOnce = tune.passMatrices === 'once';
        const mobiles = this.world.mobiles;
        if (!mobiles) return 'no world loaded';
        return { ...mobiles.tune(tune), passMatrices: this.portals.matrixOnce ? 'once' : 'every' };
      },
      /** Every mobile's cull sphere, whether it is on and near the screen, whether it is drawn and casts, and its tier: the check that the one sphere is in the frame it claims. */
      mobileCull: () => this.world.mobiles?.cullReport(this.cam.camera, this.player.pos) ?? 'no world loaded',
      /** Blow up the vehicle ridden, piloted or stood in (its health to nothing), to see the rider thrown or the crew put out. */
      wreck: () => {
        const v = this.player.mounted ?? this.player.piloting ?? this.player.aboard?.vehicle ?? null;
        if (!v) return 'not on or in anything';
        v.hp = 0;
        return `${v.spec.id} wrecked`;
      },
      /** Stand `n` fighters ahead (random species, look and weapon; they fight you and each other), or with 0 list the ones out. */
      fighter: (n = 1, species?: string) => {
        for (let i = 0; i < n; i++) {
          this.cam.forward(tmp);
          const d = 8 + Math.random() * 6;
          this.world.npcs.spawnAt(this.player.pos.x + tmp.x * d + (Math.random() - 0.5) * 6, this.player.pos.z + tmp.z * d + (Math.random() - 0.5) * 6, species);
        }
        return this.world.npcs.npcs.map((f) => ({ name: f.name, arm: f.arm, weapon: f.weapon?.id ?? null, outfit: f.outfit, hp: Number(f.hp.toFixed(0)), dead: f.dead, dist: Number(f.pos.distanceTo(this.player.pos).toFixed(1)), rig: !!f.rig }));
      },
      /** The gun in hand: its Jedi Academy type and numbers. */
      gunType: () => {
        const p = (this.kits.bounty_hunter as BountyHunterKit | undefined ?? new BountyHunterKit(this.scene)).profile({ player: this.player } as KitContext);
        return { type: p.type, label: p.label, primary: p.blurb, alt: p.altBlurb || 'none', fx: this.player.equipped.right?.fx ?? null };
      },
      /** The blaster in hand, 'pistol' or 'rifle': which of the game's carries play. `gun('carbine', { aim: 30, aimKneel: 30, ready: 30 })` sets how far right, in degrees, that kind's torso turns while aiming standing or moving, aiming kneeling or crouched, and in the hip-fire carry, as a starting point; the barrel is then measured against the crosshair every frame and the torso turned the rest of the way (`fix`, in degrees; `gun(undefined, { fix: false })` turns that off to see the poses bare). */
      gun: (kind?: 'pistol' | 'carbine' | 'rifle' | 'heavy', tune?: { ready?: number; aim?: number; aimKneel?: number; fix?: boolean }) => {
        if (kind) {
          this.player.gunClass = kind;
          this.player.gunKind = kind === 'pistol' ? 'pistol' : 'rifle';
        }
        if (tune) {
          const t = this.player.gunTune[(kind as 'pistol' | 'carbine' | 'rifle' | 'heavy' | undefined) ?? this.player.gunClass];
          if (tune.ready !== undefined) t.ready = tune.ready;
          if (tune.aim !== undefined) t.aim = tune.aim;
          if (tune.aimKneel !== undefined) t.aimKneel = tune.aimKneel;
          if (tune.fix !== undefined) this.player.aimFix.on = tune.fix;
        }
        const fix = this.player.aimFix;
        return { kind: this.player.gunKind, class: this.player.gunClass, tune: this.player.gunTune, fix: { on: fix.on, yaw: Number(((fix.yaw * 180) / Math.PI).toFixed(1)), pitch: Number(((fix.pitch * 180) / Math.PI).toFixed(1)) }, aiming: this.player.aiming, ready: this.player.gunReady, sinceShot: Number(this.player.sinceShot.toFixed(1)), clips: this.player.rig?.clipsMatching(/pistol|rifle/) ?? [] };
      },
      /** The saber defence rank (1..3): how bolts are turned away. */
      saberDefense: (rank?: number) => {
        if (rank !== undefined) this.player.saberDefense = Math.max(1, Math.min(3, Math.round(rank)));
        return this.player.saberDefense;
      },
      player: () => {
        const p = this.player;
        return { hp: Number(p.hp.toFixed(1)), blocking: p.blocking, aiming: p.aiming, gunReady: p.gunReady, prone: p.prone, kneeling: p.kneeling, crouching: p.crouching, jkaMode: p.jkaMode, rig: p.rig?.describe() ?? null, pos: p.pos.toArray().map((v) => Number(v.toFixed(2))), camera: this.cam.camera.position.toArray().map((v) => Number(v.toFixed(2))), vel: p.vel.toArray().map((v) => Number(v.toFixed(2))), grounded: p.grounded, heading: Number(((p.heading * 180) / Math.PI).toFixed(0)), cameraYaw: Number(((Math.atan2(this.cam.camera.getWorldDirection(new THREE.Vector3()).x, this.cam.camera.getWorldDirection(new THREE.Vector3()).z) * 180) / Math.PI).toFixed(0)), swimming: p.swimming, submerged: p.submerged, water: this.world.terrain.waterHeightAt(p.pos.x, p.pos.z), ground: this.world.terrain.heightAt(p.pos.x, p.pos.z), captured: this.input.captured };
      },
    };

    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    this.ui.appendChild(this.fade);
    // The death card: over the fallen body, with the way back.
    this.death = document.createElement('div');
    this.death.id = 'death';
    this.death.innerHTML = `<div class="death-card"><h2>You have become one with the Force</h2><button class="respawn">Respawn</button></div>`;
    this.death.querySelector('.respawn')!.addEventListener('click', () => this.respawn());
    this.ui.appendChild(this.death);
    this.loadingScreen = new LoadingScreen(this.ui, import.meta.env.BASE_URL);
    this.emoteWheel = new EmoteWheel(this.ui);
    this.remotes = new RemotePlayers(this.scene, import.meta.env.BASE_URL, async () => {
      this.world.garage ??= await Garage.load(import.meta.env.BASE_URL);
      return this.world.garage;
    });
    // A peer dressed, or their look changed: the motion blur's shaders for their outfit, before it is drawn.
    this.remotes.onDressed = (root) => void this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]);
    // A peer's weapons come off the same rack, and anything of theirs is compiled before it shows.
    this.remotes.weapons = () => this.weapons;
    this.remotes.prepare = (root) => this.prepareRoot(root);
    // A peer's ride is compiled before it shows, parts, glows and all (this.world was assigned in the constructor, long before).
    this.remotes.prepareVehicle = (roots) => this.world.vehiclePrepare(roots);
    // A peer's painted ship owns copies of its materials: out of the world's sets when they go (read at call time).
    this.remotes.forget = (m) => this.world.forgetMaterials(m);
    // A new mobile prototype: the motion blur's shaders for its morph counts, after the world's own preparation.
    MobileAssets.for(import.meta.env.BASE_URL).alsoPrepare = (root) => this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]) ?? Promise.resolve();
    this.net.onJoin = (peer) => this.remotes.add(peer.id, peer.hello);
    this.net.onHello = (peer) => this.remotes.hello(peer.id, peer.hello);
    this.net.onLeave = (id) => this.remotes.remove(id);
    this.net.onState = (id, state) => this.remotes.state(id, state);
    this.net.onEmote = (id, clip) => this.remotes.emote(id, clip);
    // One ship clamped onto another, across the relay: the word meant for this player alone (a pilot
    // asking for room on this hull, and the answer), the peers a clamp may hold to, and the way out to
    // one of them. `carrierPose` answers for this player's own ship, which is no peer's picture: a peer
    // docked onto the ship this player is on hangs from where that hull really is.
    this.net.onAsk = (from, word) => this.docking.clamp.heard(from, word, this.pilotedShip());
    this.docking.clamp.peers = this.remotes;
    this.docking.clamp.link = { id: () => this.net.id, send: (to, word) => this.net.sendAsk(to, word) };
    this.remotes.carrierPose = (to, pos, quat) => {
      const p = this.player;
      const v = to === this.net.id ? p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null : null;
      if (!v || v.disposed) return false;
      pos.copy(v.pos);
      v.quaternion(quat);
      return true;
    };
    this.net.onStatus = (status, detail) => {
      this.netStatus = detail ? `${status} (${detail})` : status;
      if (status === 'online') this.hud.setPrompt('connected to the relay');
    };

    this.select = new CharacterSelect(this.ui);
    this.select.onPlay = (c) => void this.play(c).catch((err) => console.warn('could not enter the world', err));
    this.select.onCreate = () => void this.openCreator().catch((err) => console.warn('creator', err));
    this.select.onDelete = (c) => {
      deleteCharacter(c.id);
      this.select.show(loadCharacters());
    };
    this.creatorBar = new CreatorBar(this.ui);
    this.creatorBar.onBack = () => {
      this.leaveCreator();
      this.select.show(loadCharacters());
    };
    this.creatorBar.onTab = (id) => this.showCreatorTab(id);
    this.creatorBar.onCreate = (name, cls, planet) => void this.finishCreation(name, cls, planet).catch((err) => console.warn('creator', err));
    this.menu = new Menu(this.ui, this.input, this.settings);
    draggable(this.menu.root, '.menu-panel', '.menu-nav', 'menu');
    this.menu.net = {
      url: () => Net.savedUrl(),
      status: () => this.netStatus,
      peers: () => this.remotes.here(),
      connect: (url) => {
        Net.saveUrl(url);
        if (url) this.net.connect(url, this.helloNow());
        else this.net.disconnect();
      },
      disconnect: () => this.net.disconnect(),
    };
    this.menu.onResume = () => this.resume();
    this.menu.onSwitchCharacter = () => this.switchToSelect();
    // The menu's own clicks, from the game's interface table.
    this.menu.onUiSound = (action) => void this.audio.ui.play(action);
    this.menu.onSetting = (key) => this.applySetting(key);
    // Escape: in the world it opens the menu (the browser drops the pointer lock on it, which is
    // caught below); with the menu up it resumes; with a panel or the map up it closes that.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.inWorld || !this.started || this.traveling) return;
      // The Escape that dropped the lock (and so opened the menu) must not close it again in the same breath.
      if (this.menu.open) {
        if (performance.now() - this.menuOpenedAt > 300) this.resume();
      }
      else if (this.anyPanelOpen() || this.map.open) {
        this.closePanels();
        this.map.hide();
        this.freeMouse(false);
      } else this.openMenu();
    });

    // Releasing the mouse leaves the game running and the world visible, so the wardrobe and the
    // map can be used with a cursor. Clicking the world takes the mouse back; the menu is only
    // for arriving and for dying, not for every Escape.
    document.addEventListener('pointerlockchange', () => {
      if (!this.started || this.traveling) return;
      // The lock went without a panel asking for it: Escape, or a click away. The menu, not a bare cursor.
      if (!this.input.locked && !this.input.captured && this.inWorld && !this.map.open && !this.anyPanelOpen()) this.openMenu();
      this.hud.setMouseFree(!this.input.locked && !this.map.open && !this.anyPanelOpen());
    });
    this.canvas.addEventListener('click', () => {
      if (this.started && !this.input.locked && !this.map.open && !this.anyPanelOpen() && !this.traveling) this.input.requestLock();
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postfx?.setSize();
      this.cam.camera.aspect = window.innerWidth / window.innerHeight;
      this.cam.camera.updateProjectionMatrix();
      this.world.onCameraResized();
    });

    // Sound starts on the first press, which is what browsers require; the game already needs a
    // click for the pointer lock, so nothing extra is asked of the player. Both listeners are
    // passive and stay on, since `unlock` after the first time does nothing.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    // Away to another tab: silent, and the context stopped, unless the player asked otherwise.
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));

    // Nothing loads until a character is chosen: the select screen first, the creator or the
    // world after. The species list is small and feeds both the creator and the console.
    void loadSpeciesIndex(import.meta.env.BASE_URL).then((list) => {
      this.speciesList = list;
      this.world.npcDeps.species = list.map((s) => s.id);
      this.world.npcs?.attach(this.world.npcDeps);
      this.appearanceUi.setSpecies(list, this.characterId);
    });
    // The creature and NPC catalogue: about 8 MB, fetched and indexed once while the select
    // screen is up. Nothing waits on it in a frame; until it lands a spawn says so.
    void this.world.loadMobileCatalogue().then((c) => {
      if (c) console.info(`mobiles: ${c.entries.length} in the catalogue`);
    });
    // Aboard a ship's rooms nothing is stood, whoever asks (the console, the spawner, the wildlife).
    this.world.refuseMobiles = () => (this.player?.aboard ? 'nothing can be stood aboard a ship’s rooms' : null);
    this.appearanceUi.onSpecies = (id) => void this.switchCharacter(id);
    const params = new URLSearchParams(location.search);
    this.setClass(params.get('class') === 'bounty_hunter' ? 'bounty_hunter' : 'jedi');
    this.select.show(loadCharacters());
    // Where the character stands is written back now and then, and when the page goes.
    window.addEventListener('pagehide', () => this.savePlace(true));
  }

  // ---- The Escape menu and its settings. ----

  private menuOpenedAt = 0;

  private openMenu(): void {
    if (this.menu.open) return;
    this.menuOpenedAt = performance.now();
    this.menu.show();
    this.freeMouse(true);
  }

  private resume(): void {
    this.menu.hide();
    this.freeMouse(false);
  }

  /** Back to the select screen: the place is written, the world unloaded, nothing streams until a character is chosen. */
  private switchToSelect(): void {
    // A jump lets go of everything it holds (the hull, the white, its effects) before the ship is left.
    this.hyperspace.abort('leaving');
    // So does a run: it holds the hull and the streamer, and both would be left behind.
    this.ultraCruise.abort();
    // Every voice and every looping source goes with the world, or a planet's beds would follow
    // the player onto the select screen and into the next character's world.
    this.audio.stopAll();
    this.savePlace(true);
    this.menu.hide();
    this.closePanels();
    // The hands are emptied on the way out, or the next character played (of the same species) would start with this one's weapon.
    this.equipment.reset();
    this.map.hide();
    if (this.player.mounted) this.handleMount();
    // Off the ship before its room's physics world goes with the world.
    if (this.player.aboard) this.leaveShip(true);
    this.player.noclip = false;
    this.inWorld = false;
    this.started = false;
    this.current = null;
    this.net.disconnect();
    this.world.leave();
    this.shipHud.clear();
    this.hud.setPrompt('');
    this.hud.setMouseFree(false);
    this.input.captured = false;
    this.input.releaseLock();
    this.select.show(loadCharacters());
  }

  /** A setting moved in the menu: it takes effect now. */
  private applySetting(key: keyof Settings): void {
    const S = this.settings;
    switch (key) {
      case 'renderScale':
        this.renderer.setPixelRatio(S.renderScale);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.postfx?.setSize();
        this.world.onCameraResized();
        break;
      case 'fov':
        this.cam.baseFov = S.fov;
        break;
      case 'exposure':
        this.renderer.toneMappingExposure = S.exposure;
        break;
      case 'fog':
        this.world.userFog = S.fog;
        break;
      case 'normalStrength':
        Character.normalScale.set(S.normalStrength, -S.normalStrength);
        this.world.setNormalScale(S.normalStrength, -S.normalStrength);
        this.player.rig?.character?.customizer?.setNormalScale(S.normalStrength, -S.normalStrength);
        break;
      case 'shadows':
        this.world.setShadowsEnabled(S.shadows);
        break;
      case 'shadowMapSize':
      case 'shadowSoftness':
        this.world.setShadowLook(S.shadowSoftness, undefined, S.shadowMapSize);
        break;
      case 'shadowDistance':
      case 'shadowCasterRadius':
        this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);
        break;
      case 'objectReach':
      case 'terrainRadius':
      case 'farRadius':
        this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
        break;
      case 'mobileCap':
      case 'mobileAnimRange':
        this.world.setMobileDetail(S.mobileCap, S.mobileAnimRange);
        break;
      case 'sensitivity':
        this.cam.sensitivity = S.sensitivity;
        break;
      case 'invertY':
        this.cam.invertY = S.invertY;
        break;
      case 'weather':
      case 'weatherDensity':
      case 'rainOpacity':
      case 'wetSurfaces':
      case 'weatherShadows':
      case 'weatherForce':
      case 'weatherKind':
      case 'lifeDay':
        // Uniforms and rates only: nothing here compiles a shader.
        this.world.weather.configure(S);
        this.hud.setWeatherNote(this.world.weather.heldNote());
        break;
      case 'soundMaster':
      case 'soundAmbience':
      case 'soundEffects':
      case 'soundVoices':
      case 'soundFootsteps':
      case 'soundVehicles':
      case 'soundInterface':
      case 'soundMusic':
      case 'soundHeadphones':
      case 'soundRoomEcho':
      case 'soundInBackground':
      case 'soundSabers':
        // Gains only: nothing here rebuilds the graph, and nothing compiles.
        this.audio.apply(S);
        break;
      default:
        // Anything in the effects registry: the chain takes them all in one go on the next
        // microtask, so resetting the graphics is one reconcile rather than two dozen.
        if (isFxSettingKey(key)) this.queueEffects();
        break;
    }
  }

  // ---- Sound. ----

  /**
   * A number per space the ear or a sound can be in, so "are these two in the same room" is one
   * comparison and nothing holds a reference to a building that the world may unload: -1 is the
   * open world, and every building and every boarded hull gets a number of its own the first time
   * it is met. The map is weak, so an unloaded building's number simply goes with it.
   */
  private readonly spaceIds = new WeakMap<object, number>();
  private nextSpaceId = 1;

  private spaceIdOf(of: object | null | undefined): number {
    if (!of) return -1;
    let id = this.spaceIds.get(of);
    if (id === undefined) {
      id = this.nextSpaceId++;
      this.spaceIds.set(of, id);
    }
    return id;
  }

  /**
   * The ear at the camera, and the mixer's own step. Called after the frame's last camera move, so
   * a cockpit view hears from the cockpit and a chase view from behind the hull. Nothing is
   * allocated: the pose and the two vectors are fields.
   */
  private stepAudio(dt: number): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    const pose = this.listenerPose;
    pose.x = cam.matrixWorld.elements[12];
    pose.y = cam.matrixWorld.elements[13];
    pose.z = cam.matrixWorld.elements[14];
    // Three's camera looks down its own -Z, and its +Y is up.
    this.listenerDir.set(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[9], -cam.matrixWorld.elements[10]).normalize();
    this.listenerUp.set(cam.matrixWorld.elements[4], cam.matrixWorld.elements[5], cam.matrixWorld.elements[6]).normalize();
    pose.fx = this.listenerDir.x;
    pose.fy = this.listenerDir.y;
    pose.fz = this.listenerDir.z;
    pose.ux = this.listenerUp.x;
    pose.uy = this.listenerUp.y;
    pose.uz = this.listenerUp.z;
    const aboard = this.player.aboard;
    const cell = this.world.cellState;
    // A surface the boots hold to is out of doors: the ear is beside a rock, not inside the hull that the
    // room happens to be named by, so the zone's own bed keeps playing rather than crossfading away.
    const inHull = aboard && !isSurfaceRoom(aboard) ? aboard.vehicle : null;
    pose.space.building = inHull ? this.spaceIdOf(inHull) : this.spaceIdOf(cell?.building ?? null);
    // Which room of a hull the player stands in is not tracked yet; a building's is.
    pose.space.cell = inHull ? -1 : (cell?.cell ?? -1);
    // The world's own sound reads the same two numbers: its beds sit wherever the ear does, so
    // walking into a cantina crossfades the street away rather than cutting it off at the door.
    this.world.listenerSpace.building = pose.space.building;
    this.world.listenerSpace.cell = pose.space.cell;
    // Feet and voices before the mixer's own step, so a step that lands this frame is given a voice
    // on the same frame it lands rather than the next.
    this.stepFeet(dt, pose.x, pose.y, pose.z);
    this.audio.update(dt, pose);
  }

  /**
   * What every body's clips marked since the last frame: the feet, the voices, and the loops a
   * standing body makes. The three lists are the managers' own arrays and the player's record is a
   * field, so this allocates nothing.
   */
  private stepFeet(dt: number, lx: number, ly: number, lz: number): void {
    // A planet handed over once, and taken away on the way out: the feet fetch what that planet's
    // own objects are made of.
    const pack = this.inWorld ? this.world.packId : '';
    if (pack !== this.feetPack) {
      this.feetPack = pack;
      if (pack) this.feet.begin(pack);
      else this.feet.leave();
    }
    // The shared table that names the nine terrain surfaces arrives with the sound bank, some
    // frames after the game starts. Handed over when it changes rather than read through a cast,
    // so a rename in the bank is a type error here and not a silent fall back to file names.
    const tables = this.audio.bank.sources;
    if (tables !== this.feetTables) {
      this.feetTables = tables;
      this.feet.setSurfaceTable(tables?.surfaces as Record<string, { type?: string }> | undefined);
    }
    const player = this.player;
    const rig = player.rig;
    const lists = this.footBodies;
    if (rig && this.inWorld && !this.creating) {
      const p = this.footPlayer;
      const at = player.worldPos;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.inside = this.world.inside || (!!player.aboard && !isSurfaceRoom(player.aboard));
      // A ship's rooms are a physics world of their own that no ray of the planet's reaches, and
      // the interior table gives a hull's rooms metal: INVENTED only in that it is not looked up.
      // Standing on a surface with the boots on is not a deck: the world's own ray answers there,
      // so a rock stays a rock.
      const hull = player.aboard && !isSurfaceRoom(player.aboard) ? player.aboard : null;
      p.deck = hull ? 'metal' : null;
      // Aboard, the body's own sounds belong to the hull the ear is in. Without this the muffling
      // rule puts a low-pass over every step the player takes on the deck, because there is no
      // streamed building at the point and the world would answer "outside".
      this.footSpace.building = hull ? this.spaceIdOf(hull.vehicle) : OUTSIDE.building;
      this.footSpace.cell = OUTSIDE.cell;
      p.space = hull ? this.footSpace : null;
      p.dead = this.dying || player.hp <= 0;
      p.species = this.characterId;
      this.feet.playerTemplate = rig.character?.manifest.template ?? null;
      lists.player = p;
    } else lists.player = null;
    lists.mobiles = this.inWorld && this.world.mobiles ? this.world.mobiles.live : EMPTY_BODIES;
    lists.fighters = this.inWorld ? this.world.npcs.npcs : EMPTY_BODIES;
    this.listenerAt.x = lx;
    this.listenerAt.y = ly;
    this.listenerAt.z = lz;
    this.feet.update(dt, this.listenerAt, lists);
    this.stepRideSounds();
  }

  /**
   * Getting on and off. The game has three sounds of its own for it and nothing in the archives
   * says which goes where, so the reading is ours: climbing onto a mount or a speeder is
   * `pl_all_mount`, stepping aboard a ship's rooms is `pl_all_embark`, and leaving either is
   * `pl_all_disembark`. Watched as a change rather than called from the mount code, so every way on
   * and off (the key, the menu, a travel, a death) sounds the same.
   */
  private stepRideSounds(): void {
    const on = !!this.player.mounted;
    const aboard = !!this.player.aboard;
    if (on !== this.rodeLast) {
      this.rodeLast = on;
      if (this.started) this.playAtPlayer(on ? 'sound/pl_all_mount.snd' : 'sound/pl_all_disembark.snd');
    }
    if (aboard !== this.aboardLast) {
      this.aboardLast = aboard;
      if (this.started) this.playAtPlayer(aboard ? 'sound/pl_all_embark.snd' : 'sound/pl_all_disembark.snd');
    }
  }

  private rodeLast = false;
  private aboardLast = false;

  /**
   * One of the game's sounds where the player stands, in whatever space the player is in: stepping
   * aboard a hull is heard from inside it, not through the muffle the mixer puts over another room.
   */
  private playAtPlayer(id: string): void {
    const at = this.player.worldPos;
    this.audio.play(id, { x: at.x, y: at.y, z: at.z, space: this.listenerPose.space });
  }

  /** Where the ear is, for the feet; a field, so the frame allocates nothing. */
  private readonly listenerAt = { x: 0, y: 0, z: 0 };
  /** The space the player's own feet and voice belong to while aboard a hull; a kept record. */
  private readonly footSpace: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };

  /** The look of the character as it is now. */
  private appearanceOf(c: Character): Appearance {
    return { morphs: c.morphValues(), values: c.variableValues(), height: c.height };
  }

  /** The sliders and colours changed on the appearance tab: written into the character's record while one is being played. */
  private saveAppearance(): void {
    const c = this.player.rig?.character;
    if (!c || !this.current || this.creating) return;
    this.current.appearance = this.appearanceOf(c);
    this.current.outfit = this.outfitOf(c);
    upsertCharacter(this.current);
  }

  /**
   * Whether the effects light what is around the lit blades this frame. The blades then ask for no
   * pooled flash lights, which stay with shots, hits and ship rooms. With Effects or the glow off,
   * the blades glow from the pool as before. It follows the setting (or a console override), not
   * whether a blade is on screen this frame, so a blade crossing the screen's edge never swaps one
   * light for the other; and not the strength, since at 0 the owner asked for no glow at all.
   */
  private bladeGlowOwnsLight(): boolean {
    const fx = this.postfx;
    if (!fx || this.bladeGlowFlashes || !fx.pass('bladeGlow')) return false;
    const forced = fx.override.bladeGlow;
    if (forced !== undefined) return forced;
    const toggles = fxPassDef('bladeGlow').toggles;
    for (let i = 0; i < toggles.length; i++) if (this.settings[toggles[i]]) return true;
    return false;
  }

  /**
   * A lit lightsaber through a wall or the ground burns it: each blade is cast along its length against
   * the world's fixed surfaces, and where it meets one a mark is laid in the blade's colour, spaced along
   * the blade's path. Swords and polearms burn nothing, nor does a blade aboard a ship's rooms.
   */
  private scorch(dt: number): void {
    this.marks.update(dt);
    const player = this.player;
    if (player.aboard || player.noclip || !player.saberOn) return;
    const n = player.saberSegments(this.bladeSegments);
    if (!n) return;
    // Any mesh burns but flesh: the creatures, the mobiles and the fighters are skipped.
    const flesh = (h: number) => this.world.creatures.byCollider.has(h) || this.world.npcs.byCollider.has(h) || !!this.world.mobiles?.byCollider.has(h);
    for (let i = 0; i < n; i++) {
      const seg = this.bladeSegments[i];
      const hit = this.physics.surfaceHit(seg.a, seg.b, player.body, this.world.inside, flesh);
      if (!hit) continue;
      this.markPoint.fromArray(hit.point);
      this.markNormal.fromArray(hit.normal);
      this.marks.touch(i, this.markPoint, this.markNormal);
    }
  }

  /** What the character wears, by the names it wears them under. */
  private outfitOf(c: Character): string[] {
    return c.status().filter((p) => p.worn && !p.body).map((p) => p.name);
  }

  private applyAppearance(c: Character, a: Appearance | null): void {
    applyAppearance(c, a);
  }

  /** Dress the character in a saved outfit: everything else comes off, each piece goes on by the name it was worn under. */
  private async dress(c: Character, outfit: string[]): Promise<void> {
    await dress(c, outfit, import.meta.env.BASE_URL, (key) => console.warn(`outfit: ${key} is not in the wardrobe any more`));
  }

  /** Put the rig of a species on the player (the placeholder body, or another species, comes off). */
  private async useSpecies(id: string): Promise<Character | null> {
    if (this.player.rig?.character?.manifest.id === id) return this.player.rig.character;
    const rig = await loadPlayerRig(import.meta.env.BASE_URL, id);
    this.player.unequip('right');
    this.player.unequip('left');
    this.player.detachRig();
    this.player.attachRig(rig);
    this.characterId = rig.character?.manifest.id ?? id;
    this.wireEmotes(rig.clipNames);
    this.appearanceUi.setSpecies(this.speciesList, this.characterId);
    return rig.character;
  }

  /** Who and where this player is, for the relay, and how they look, so the others draw them as they are. */
  private helloNow(): Hello {
    const c = this.current;
    // The weapons in hand, so the others see them (the outfit is the record's, which the equipment keeps current).
    const r = this.player.equipped.right?.id;
    const l = this.player.equipped.left?.id;
    const held = r || l ? { ...(r ? { r } : {}), ...(l ? { l } : {}) } : undefined;
    // The ship this player flies (or last flew or stood out), with its components, droid and paint.
    const ship = this.helloShip();
    if (ship) this.helloShipId = ship.id;
    return { name: c?.name ?? 'someone', species: this.characterId, class: this.kit?.id ?? 'jedi', planet: this.world.planet?.id ?? '', zone: this.zone, look: c ? packLook(c.appearance, c.outfit ?? []) : undefined, held, ship };
  }

  /** Send the hello again shortly (dressing several pieces sends one): a change of clothes or weapon reaches the others. */
  private queueHello(): void {
    if (!this.net.online) return;
    window.clearTimeout(this.helloTimer);
    this.helloTimer = window.setTimeout(() => {
      if (this.net.online && this.current) this.net.setHello(this.helloNow());
    }, 400);
  }

  /**
   * Compile something of the player's (or a peer's) before it is shown: the world's actor preparation,
   * then the motion blur's. Outside the world nothing is drawn by the main renderer, and arriving
   * compiles the whole scene behind the loading screen, so there is nothing to do.
   */
  private async prepareRoot(root: THREE.Object3D): Promise<void> {
    if (!this.inWorld) return;
    await this.world.prepareActor(root);
    await this.postfx?.product<VelocityProduct>('velocity')?.prepareRoots([root]);
  }

  /** The equipment changed what is owned, worn or held (or what is being put on): the panels follow, and the others are told. */
  private onEquipmentChanged(what: 'owned' | 'worn' | 'held' | 'busy'): void {
    if (this.backpack.open) void this.refreshBackpack();
    if (what === 'busy') return;
    this.weaponsUi.held = { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null };
    if (this.weaponsUi.open) this.weaponsUi.render();
    if (this.wardrobe.open && what === 'worn') this.wardrobe.refresh();
    this.queueHello();
  }

  /** Whether an id is a weapon or a wardrobe item: owned first, then the rack, then the wardrobe. */
  private async kindOf(id: string): Promise<'wear' | 'weapon' | null> {
    const owned = this.equipment.owned().find((o) => o.id === id);
    if (owned) return owned.kind;
    const ctx = await this.equipment.itemContext();
    if (!itemInfo('weapon', id, ctx).missing) return 'weapon';
    if (!itemInfo('wear', id, ctx).missing) return 'wear';
    return null;
  }

  /** The backpack's double-click (or Enter, or the console): on or off, in hand or put away; a weapon may switch the kit. */
  private async useItem(key: string, hand?: 'left'): Promise<string> {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind !== 'wear' && kind !== 'weapon') return `no item ${key}`;
    const r = await this.equipment.use(kind, id, hand);
    if (r.wants && r.wants !== this.kit.id && this.inWorld) this.setClass(r.wants);
    if (r.note !== 'dropped') this.hud.setPrompt(r.note);
    return r.note;
  }

  /** Destroy an owned item for good. */
  private async destroyItem(key: string): Promise<string> {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind !== 'wear' && kind !== 'weapon') return `no item ${key}`;
    const note = await this.equipment.destroy(kind, id);
    if (note !== 'dropped') this.hud.setPrompt(note);
    return note;
  }

  /** What the class fights with while a hand is empty, for the backpack's hand cells. */
  private standIns(): { right: string | null; left: string | null } {
    const p = this.player;
    if (p.fists) return { right: null, left: null };
    if (this.kit?.id === 'bounty_hunter') return { right: 'the plain rifle', left: null };
    return { right: 'the plain saber', left: p.saber.style === 'dual' ? 'the plain saber' : null };
  }

  /** Build the backpack from the equipment's snapshot and what the game says about each item. */
  private async refreshBackpack(): Promise<void> {
    const ctx: ItemContext = await this.equipment.itemContext();
    if (!this.backpack.open) return;
    const snap = this.equipment.snapshot();
    const now = Date.now();
    const busy = new Set(snap.busy);
    const newest = snap.owned.reduce((m, o) => Math.max(m, o.got), 0);
    const character = this.player.rig?.character ?? null;
    const cell = (kind: 'wear' | 'weapon', id: string, got: number): BackpackCell => {
      const info = itemInfo(kind, id, ctx);
      const where: BackpackCell['where'] = kind === 'weapon' ? (snap.held.right === id ? 'right' : snap.held.left === id ? 'left' : 'pack') : id in snap.worn ? 'worn' : 'pack';
      const first = info.slots?.[0];
      const slotsText = kind === 'weapon' ? (first ? slotWords(first) : '') : info.slots?.length ? `takes: ${info.slots.map((a) => slotWords(a)).join(' or ')}` : '';
      const classRank = info.cls ? WEAPON_ORDER.indexOf(info.cls) : WEAPON_ORDER.length;
      const order = where === 'worn' ? slotRank(first?.[0]) : kind === 'weapon' ? classRank : 100 + slotRank(first?.[0]);
      const fitNote = info.missing
        ? kind === 'weapon'
          ? 'not on this machine\'s weapons rack'
          : "not in this character's wardrobe"
        : info.fit === 'block'
          ? `${speciesWords(ctx.species, true)} cannot wear this`
          : info.fit === 'hide' || info.unseen
            ? `worn unseen on ${speciesWords(ctx.species, false)}`
            : undefined;
      return {
        key: info.key,
        kind,
        id,
        name: info.name,
        icon: info.icon,
        where,
        fit: info.fit,
        missing: info.missing,
        unseen: info.unseen,
        busy: busy.has(info.key),
        isNew: got > 0 && got === newest && now - got < 2000,
        kindText: info.kindText,
        slotsText,
        description: info.description,
        canLeft: kind === 'weapon' && !!info.cls && OFF_HAND_CLASSES.has(info.cls),
        order,
        fitNote,
      };
    };
    const cells = snap.owned.map((o) => cell(o.kind, o.id, o.got));
    // Anything worn or held that is not owned (it should not happen once a record is played) is shown all the same, so the panel matches the body.
    for (const id of Object.keys(snap.worn)) if (!cells.some((c) => c.kind === 'wear' && c.id === id)) cells.push(cell('wear', id, 0));
    for (const id of [snap.held.right, snap.held.left]) if (id && !cells.some((c) => c.kind === 'weapon' && c.id === id)) cells.push(cell('weapon', id, 0));
    this.backpack.render({
      cells,
      standIn: this.standIns(),
      noWardrobe: !!character && !ctx.wardrobe,
      note: !character ? 'this character is a single model: clothes cannot change' : !ctx.weapons ? 'no weapons converted' : undefined,
    });
  }

  /** Tell the relay where this player is, a few times a second, and move the others along. */
  private stepNet(dt: number): void {
    this.remotes.update(dt);
    if (!this.net.online) return;
    const now = performance.now();
    if (now - this.lastStateSent < 100) return;
    this.lastStateSent = now;
    const p = this.player;
    const rig = p.rig;
    const at = p.worldPos;
    const n2 = (n: number) => Number(n.toFixed(2));
    const n3 = (n: number) => Number(n.toFixed(3));
    // The vehicle this player is on, so the others see it with them on it; and the figure's
    // whole turn where a heading is not enough (aboard a banked hull, adrift in space).
    // Standing on a surface is not being aboard a ship: peers would otherwise draw the figure inside a hull
    // it is merely beside. The whole turn goes over as it already does for anyone adrift.
    const v = p.mounted ?? p.piloting ?? (isSurfaceRoom(p.aboard) ? null : p.aboard?.vehicle) ?? null;
    // Another fitted ship taken: the hello (with that ship's fit) goes again once, debounced. Two strings compared, nothing allocated.
    const shipId = v?.def?.fit ? v.def.id : this.helloShipId;
    if (shipId !== this.helloShipId) {
      this.helloShipId = shipId;
      this.queueHello();
    }
    // Clamped onto another ship: whose, and where on it. The others then hang the picture of this hull
    // from that ship's own pose rather than gliding it about on the hull it rides.
    const dock = v ? this.docking.clamp.wire(v) : null;
    const veh: PeerVehicle | undefined = v ? { id: v.def?.id ?? v.spec.id, p: [n2(v.pos.x), n2(v.pos.y), n2(v.pos.z)], q: v.quaternion(tmpQ).toArray().map(n3) as [number, number, number, number], role: p.mounted ? 'ride' : p.piloting ? 'pilot' : 'aboard', pose: v.riderPose ?? undefined, ...(v.wings.length ? { w: v.wings.target ? 1 : 0 } as const : {}), ...(v.landed ? { landed: 1 } as const : {}), ...(dock ? { dock } : {}) } : undefined;
    const q = p.aboard || p.eva ? (p.group.quaternion.toArray().map(n3) as [number, number, number, number]) : undefined;
    // In a jump, from its start until the tunnel opens, the others do not see this player or the ship
    // (`j`). An ultra cruise is hidden the same way and for the same reason: at kilometres a second a
    // peer would be handed a place a kilometre from the last one ten times a second, which their side
    // glides through as a teleport and hands to their motion blur as a screen-wide smear.
    const hidden = this.hyperspace.hiddenToPeers || this.ultraCruise.running;
    this.net.sendState({ p: [n2(at.x), n2(at.y), n2(at.z)], h: n3(p.heading), s: p.mounted ? 'seated' : (rig?.describe().state ?? 'idle'), v: n2(Math.hypot(p.vel.x, p.vel.z)), m: !!p.mounted, sab: p.saberOn, q, veh, ...(hidden ? { j: 1 as const } : {}) });
  }

  /** The wheel's slots from the rig's own emotes when none were kept yet, and the menu's Emotes page fed from it. */
  private wireEmotes(clips: string[]): void {
    if (this.emotes.every((e) => e === null)) this.emotes = defaultEmotes(clips);
    this.menu.emotes = {
      choices: () => emoteChoices(clips),
      slots: () => this.emotes,
      set: (i, clip) => {
        this.emotes[i] = clip;
        saveEmotes(this.emotes);
      },
    };
  }

  /**
   * Play an emote, a dance or a sit on the player: a dance or a sit loops until they move, an
   * emote plays once, and a flourish plays once over the dance, which comes back after it.
   */
  private playEmote(clip: string | null): void {
    const rig = this.player.rig;
    if (!clip || !rig || this.player.mounted) return;
    if (rig.play(clip, { fadeIn: 0.15, loop: loopsEmote(clip) }) === null) {
      this.hud.setPrompt(`the rig has no clip ${clip}`);
      return;
    }
    this.emoting = true;
    this.dance = isDanceClip(clip) ? clip : isFlourishClip(clip) ? this.dance : null;
    this.net.sendEmote(clip);
  }

  /** The emote ends (the player moved, mounted, or was told to stop): the figure goes back to what it was doing, here and on the relay. */
  private endEmote(): void {
    if (!this.emoting) return;
    this.player.rig?.stopOverride(0.2);
    this.emoting = false;
    this.dance = null;
    this.net.sendEmote('');
  }

  /** The emote keys: the arrows play the wheel's first four slots outright, and a dance takes the number keys. */
  private stepEmoteKeys(): void {
    for (let i = 1; i <= 4; i++) if (this.input.pressedAction(`emote${i}` as Action)) this.playEmote(this.emotes[i - 1]);
    this.stepDance();
  }

  /** Moving, jumping, attacking or mounting ends an emote; a dance or a sit would otherwise loop for good. */
  private stepEmoteEnd(): void {
    const { input, player } = this;
    if (this.emoting && (input.held('forward') || input.held('back') || input.held('left') || input.held('right') || input.held('jump') || input.held('attack') || player.mounted)) this.endEmote();
  }

  /**
   * Dancing: the number keys play the dance's flourishes (the game's /flourish 1 to 8, each
   * style's own), taken before the kit sees them as its slots, and the loop comes back when a
   * flourish ends.
   */
  private stepDance(): void {
    const rig = this.player.rig;
    if (!this.dance || !this.emoting || !rig) return;
    const style = danceOf(this.dance);
    for (let i = 1; i <= FLOURISHES; i++) {
      if (!this.input.consumeKey(`Digit${i}`)) continue;
      const clip = style ? rig.variant(`skill_action_${i}`, style) : null;
      if (clip) this.playEmote(clip);
      else this.hud.setPrompt(`this dance has no flourish ${i}`);
    }
    if (!rig.overriding) rig.play(this.dance, { fadeIn: 0.15, loop: true });
  }

  /** Play as another species or gender: the parts pack of that id replaces the rig, the wardrobe follows. */
  async switchCharacter(id: string): Promise<string> {
    const character = await this.useSpecies(id);
    if (!character || character.manifest.id !== id) return `no parts pack for ${id}: run the converter's species command`;
    if (this.creating) {
      // A fresh start for the species, with the look last tuned for it in this browser when there is one.
      this.applyAppearance(character, this.legacyAppearance(id));
    } else if (this.current) {
      this.current.species = id;
      this.current.appearance = this.appearanceOf(character);
      this.current.outfit = this.outfitOf(character);
      upsertCharacter(this.current);
    }
    // The new rig's worn pieces become owned, and the saved hands go back in the new rig's hands.
    if (!this.creating && this.current) await this.equipment.resync();
    if (this.wardrobe.open) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
    if (this.appearanceUi.open) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
    if (this.inWorld) this.hud.setPrompt(`now playing as ${id.replace(/_/g, ' ')}`);
    return `playing as ${id}`;
  }

  /** The look kept per species before characters had records of their own, as a starting point in the creator. */
  private legacyAppearance(species: string): Appearance | null {
    try {
      const saved = localStorage.getItem(`swg.appearance.${species}`);
      return saved ? (JSON.parse(saved) as Appearance) : null;
    } catch {
      return null;
    }
  }

  // ---- The creator: the appearance and wardrobe panels at full size, no world behind them. ----

  private async openCreator(): Promise<void> {
    this.select.hide();
    this.creating = true;
    this.current = null;
    this.wardrobe.root.classList.add('creation');
    this.appearanceUi.root.classList.add('creation');
    this.creatorBar.show();
    const species = this.speciesList.find((s) => s.id === this.characterId)?.id ?? this.speciesList[0]?.id ?? 'human_male';
    const character = await this.useSpecies(species);
    // Whoever was played last leaves their weapons behind, even when the species is the same.
    this.equipment.reset();
    if (!this.creating) return;
    if (character) this.applyAppearance(character, this.legacyAppearance(species));
    this.showCreatorTab('appearance');
  }

  private showCreatorTab(tab: 'appearance' | 'wardrobe'): void {
    if (!this.creating) return;
    this.closePanels();
    this.creatorBar.setStep(tab);
    this.inventoryTab = tab;
    const character = this.player.rig?.character ?? null;
    if (tab === 'appearance') {
      this.appearanceUi.show();
      if (character) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
      else this.appearanceUi.explain('No parts pack for the player: run <code>npm run swg -- species @SWG assets-private --retail-only</code> and reload.');
    } else {
      // In the creator the Clothes tab only dresses: nothing is given (there is no record yet).
      this.wardrobe.developer = false;
      this.wardrobe.show();
      if (character) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
      else this.wardrobe.explain('No parts pack for the player: run the converter\'s <code>species</code> command and reload.');
    }
  }

  private leaveCreator(): void {
    this.creating = false;
    this.closePanels();
    this.creatorBar.hide();
    this.wardrobe.root.classList.remove('creation');
    this.appearanceUi.root.classList.remove('creation');
    // The first I after making a character opens the backpack, not the creator's last tab.
    this.inventoryTab = 'backpack';
  }

  private async finishCreation(name: string, cls: ClassId, planet: string): Promise<void> {
    const c = this.player.rig?.character;
    // The class's starting kit, and what the creator dressed the character in, are its first items;
    // the kit's weapon goes in its hand when it arrives.
    const kit = await this.equipment.kit(cls);
    const outfit = c ? this.outfitOf(c) : [];
    const worn = outfit.map((part) => this.equipment.itemIdOf(part)).filter((id): id is string => !!id).map((id) => ({ id, kind: 'wear' as const, got: Date.now() }));
    const record: SavedCharacter = {
      id: newCharacterId(),
      name,
      species: this.characterId,
      class: cls,
      appearance: c ? this.appearanceOf(c) : { morphs: {}, values: {}, height: 0.5 },
      outfit,
      planet,
      created: Date.now(),
      played: 0,
      items: normalizeOwned([...worn, ...kit.items]),
      held: kit.held,
      inv: 1,
    };
    if (!upsertCharacter(record)) {
      this.creatorBar.note('No room for another character: delete one first.');
      return;
    }
    this.leaveCreator();
    await this.play(record);
  }

  // ---- Playing a character: its rig, look and outfit, then its world behind a loading screen. ----

  private async play(c: SavedCharacter): Promise<void> {
    this.select.hide();
    this.current = c;
    // The NPC pilots' taunts name the character played.
    this.world.ships.playerName = c.name;
    this.traveling = true;
    this.input.captured = false;
    const planet = PLANETS.find((p) => p.id === c.planet) ?? PLANETS[0];
    this.loadingScreen.show(planet, planet.name, `${c.name} is on the way`);
    const character = await this.useSpecies(c.species);
    if (character) {
      this.applyAppearance(character, c.appearance);
      await this.dress(character, c.outfit ?? []);
    }
    // What the character owns (a record from before the backpack is given what it wears and the kit),
    // with the hands emptied of whoever was played before; outside the `if`, so a single model gets its weapons too.
    await this.equipment.load(c);
    // The character's Force powers and gadgets in the slots (the defaults for a character from before there was a choice).
    this.jediKit().setLoadout(c.powers?.length ? c.powers.map((p) => p || null) : [...DEFAULT_LOADOUT]);
    this.hunterKit().setLoadout(c.gadgets?.length ? c.gadgets.map((p) => p || null) : [...DEFAULT_GADGETS]);
    this.forceUi.loadout = [...this.jediKit().loadout];
    this.setClass(c.class);
    const bladeColor = c.saber?.color ?? DEFAULT_SABER_COLOR;
    this.player.setSaberColor(bladeColor);
    this.weaponsUi.saberColor = bladeColor;
    // The weapons in hand at logout, back in the same hands, blade unlit; behind the loading screen,
    // where arriving compiles the whole scene, the held models included.
    await this.equipment.restoreHeld();
    this.loadingScreen.setProgress(0.04);
    this.arrive(planet, c.zone, c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    if (c.heading !== undefined) {
      this.player.heading = c.heading;
      this.cam.yaw = c.heading + Math.PI;
    }
    // Space is never stood in: a character who was last there comes back flying a ship, where it was.
    if (planet.space) await this.arriveInSpace(c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    this.inWorld = true;
    this.started = true;
    await this.settle();
    c.played = Date.now();
    upsertCharacter(c);
    this.savePlace(true);
    this.remotes.setWorld(planet.id, this.zone);
    const relay = Net.savedUrl();
    if (relay) this.net.connect(relay, this.helloNow());
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
  }

  /**
   * Hold the loading screen until the world around the player is in: the pack, the ground
   * chunks under and around the feet, and the placed objects within working range. The player
   * is not simulated meanwhile, so nothing falls through ground that is not there yet. A world
   * that never settles (a pack missing) lets go after a while rather than never.
   */
  private async settle(timeoutMs = 30000): Promise<void> {
    const t0 = performance.now();
    // The world position: aboard a hull's rooms `player.pos` is in the hull's frame, near its origin, not where the hull is.
    while (performance.now() - t0 < timeoutMs) {
      if (this.world.settled(this.player.worldPos)) break;
      const { total, stage } = this.world.progress(this.player.worldPos);
      // The picture fills to 96% on the world's word; the last of it is the frame drawn below.
      this.loadingScreen.setProgress(0.04 + total * 0.92);
      this.loadingScreen.setWhat(`loading ${stage}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    // Every shader compiles now, behind the screen: the effects, the bolts and the kit's own
    // visuals put one of themselves in the scene first, so the first shot, hit or throw finds its
    // shaders ready rather than compiling them on the frame it is needed.
    this.loadingScreen.setWhat('compiling shaders');
    this.effects.warmUp();
    this.world.bolts.warmUp();
    for (const id of ['jedi', 'bounty_hunter'] as ClassId[]) this.kitFor(id).warmUp?.();
    // Every pass and product too, whether it is on or not, so turning one on later or the sun
    // coming on screen for the first time never compiles on a live frame.
    if (this.postfx) {
      const warmed = await this.postfx.warmUp();
      if (warmed) console.info(`effects: ${warmed} programs warmed`);
    }
    // Space combat's effects (hits, target brackets, explosions, damage bands, every projectile): their batches
    // made hidden and their textures uploaded, so the first hit neither compiles nor uploads.
    this.loadingScreen.setWhat('preparing ship effects');
    await this.world.ships.prepareEffects(this.renderer);
    const tCompile = performance.now();
    const compiled = await this.world.compileAllAsync((done, total) => this.loadingScreen.setWhat(`compiling shaders, ${done} of ${total} objects`));
    if (compiled) console.info(`shaders: ${compiled} programs compiled behind the loading screen in ${(performance.now() - tCompile).toFixed(0)} ms`);
    // A frame with everything in, so the first thing seen is the world and not the screen lifting off a blank.
    this.drawFrame();
    this.lastPrograms = this.renderer.info.programs?.length ?? 0;
    this.loadingScreen.setProgress(1);
    await new Promise((r) => setTimeout(r, 120));
  }

  /** Write where the character stands into its record, every few seconds or at once. */
  private savePlace(now = false): void {
    const c = this.current;
    if (!c || !this.inWorld || this.creating) return;
    const t = performance.now();
    if (!now && t - this.lastPlaceSave < 3000) return;
    this.lastPlaceSave = t;
    const p = this.player;
    // In a ship in flight over a planet, the place kept is the ground at the arrival point: the
    // ship is not kept, so a character put back in mid-air on foot would only fall.
    const flying = !!(p.mounted ?? p.aboard?.vehicle)?.airborne && !this.world.planet.space;
    const at = flying ? this.spawn : p.worldPos;
    c.planet = this.world.planet?.id ?? c.planet;
    c.zone = this.zone;
    c.pos = [Number(at.x.toFixed(2)), Number(at.y.toFixed(2)), Number(at.z.toFixed(2))];
    c.heading = Number(p.heading.toFixed(3));
    c.played = Date.now();
    upsertCharacter(c);
  }

  /** The kits, made once each and kept: a swap that built a kit anew would compile its shaders again, and its light coming and going recompiled everything. */
  private readonly kits: Partial<Record<ClassId, Kit>> = {};

  private kitFor(id: ClassId): Kit {
    return (this.kits[id] ??= id === 'jedi' ? new JediKit(this.scene) : new BountyHunterKit(this.scene));
  }

  private setClass(id: ClassId): void {
    // Leaving the Bounty Hunter: a flame held at the switch stops, heat and effect, since its kit stops updating.
    if (this.kit?.id === 'bounty_hunter' && id !== 'bounty_hunter') this.hunterKit().coolDown();
    this.kit = this.kitFor(id);
    this.player.setClass(id);
    this.player.speedMultiplier = 1;
    this.hud.setKit(this.kit);
    this.updateUrl();
    // The class is kept with the character, so the weapon saved in its hand comes back with the kit that fights with it.
    if (this.current && this.inWorld && !this.creating && this.current.class !== id) {
      this.current.class = id;
      upsertCharacter(this.current);
    }
  }

  private updateUrl(): void {
    if (!this.world.planet) return;
    const zone = this.zone ? `&zone=${this.zone}` : '';
    history.replaceState(null, '', `?planet=${this.world.planet.id}${zone}&class=${this.kit.id}`);
  }

  /** The zone of a multi-terrain planet the player is in, when the planet has zones. */
  private zone: string | undefined;

  /** Load a planet and stand the player at its spawn, or at `at` (where a character last stood). */
  private arrive(planet: PlanetDef, zoneId?: string, at?: THREE.Vector3): void {
    this.zone = planet.zones?.length ? (planet.zones.find((z) => z.id === zoneId) ?? planet.zones[0]).id : undefined;
    this.postfx?.reset();
    this.marks.clear();
    // No pilot's line or ship status from the world left behind.
    this.shipHud.clear();
    this.world.load(planet, packIdOf(planet, this.zone));
    this.spawn = this.world.spawnPoint();
    const stand = at ?? this.spawn;
    this.player.reset(stand);
    this.world.warmUp(stand);
    this.physics.world.step();
    this.cam.yaw = Math.PI;
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id, this.zone);
    this.updateUrl();
    this.remotes.setWorld(planet.id, this.zone);
    this.net.setHello(this.helloNow());
    const arrivalSpawn = this.spawn.clone();
    void this.world.loadPack(stand).then((clearSpawn) => {
      const p = this.player;
      if (p.mounted || p.aboard || p.noclip) return;
      // Still standing where we arrived: move to open ground now that the real city is in.
      // A character back where it stood stays put.
      if (clearSpawn && !at && p.pos.distanceTo(arrivalSpawn) < 4) {
        this.spawn.copy(clearSpawn);
        p.reset(clearSpawn.clone().setY(clearSpawn.y + 0.1));
        return;
      }
      const ground = this.world.terrain.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y < ground + 0.05) {
        p.pos.y = ground + 0.1;
        p.body.setTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, true);
      }
    }).catch((err) => console.warn('asset pack failed', err));
  }

  /**
   * Go to another world. With `ship`, arrive flying it: the ship carried up into space, or down
   * out of it, is spawned again over the arrival point at `height` and launched at `speed`, and
   * whoever was aboard its rooms stands in the new hull where they stood in the old (`crew`). A
   * space zone is always arrived at in a ship (the one last flown or fitted ship last stood out, else an X-wing).
   * A jump in flight ends first (a jump to another system does not come here: `carryAcross`). The ship arrived in is
   * returned, or null.
   */
  private async travel(planet: PlanetDef, zoneId?: string, ship?: ShipCrossing): Promise<Vehicle | null> {
    if (this.traveling) return null;
    this.hyperspace.abort('travel');
    this.ultraCruise.abort();
    this.traveling = true;
    this.map.hide();
    this.closePanels();
    this.input.captured = false;
    const zone = planet.zones?.find((z) => z.id === zoneId);
    console.info(`travel: to ${planet.name}${zone ? ` (${zone.name})` : ''}${ship ? ` flying the ${ship.def.id}${ship.crew ? ` from its rooms${ship.crew.piloting ? ' at the controls' : ''}` : ''}` : ''}`);
    this.loadingScreen.show(planet, zone ? `${planet.name}: ${zone.name}` : planet.name, 'travelling');
    await new Promise((r) => setTimeout(r, 400));
    // Into space with no ship carried (the galaxy map): arriveInSpace puts the ship at the zone's own arrival, so the world
    // streams from there. Read before anyone leaves a ship, so nothing waits between the leave and the unload.
    const spaceArrival = !ship && planet.space ? arrivalAt(await loadSpacePack(import.meta.env.BASE_URL, packIdOf(planet, zoneId))) : null;
    const p = this.player;
    // Off the ship before the world it stands in goes: its room's physics world goes with it.
    if (p.aboard) {
      const room = p.aboard;
      room.reveal(false);
      // A corpse's pieces live in the room's own physics (startRagdoll builds them there): they go before the
      // room does, or the world is freed under bodies the next frame still reads.
      if (isSurfaceRoom(room) && p.ragdoll) p.endRagdoll();
      p.leave();
      // A surface belongs to nothing but the boots: it is given up here, or its world would be left behind.
      if (isSurfaceRoom(room)) room.dispose();
    }
    if (p.mounted) p.dismount(p.pos.clone());
    // A jump's arrival (or the zone's, above) is where the world streams from, not the zone's spawn.
    this.arrive(planet, zoneId, ship?.arrival?.pos ?? (spaceArrival ? new THREE.Vector3(spaceArrival[0], spaceArrival[1], spaceArrival[2]) : undefined));
    const arrived = ship ? await this.arriveInShip(ship.def, ship.speed, ship.height, ship.crew, ship.arrival ?? null, ship.condition ?? null) : planet.space ? await this.arriveInSpace() : null;
    await this.settle();
    this.savePlace(true);
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
    return arrived;
  }

  /**
   * Arrive in space without a ship carried up: seated in the one last flown or fitted ship last stood out, else the default,
   * moving off gently. It comes out at `at` (where a character saved in space was), else the zone's own arrival (a planet's
   * launch point, or a system's first hyperspace point), facing the nearest station or landmark as a jump's arrival does.
   */
  private async arriveInSpace(at?: THREE.Vector3): Promise<Vehicle | null> {
    const def = this.lastShipDef ?? (await this.defaultShipDef());
    if (!def) return null;
    const pack = await loadSpacePack(import.meta.env.BASE_URL, this.world.packId);
    const arrival = arrivalAt(pack);
    const pos = at ? at.clone() : arrival ? new THREE.Vector3(arrival[0], arrival[1], arrival[2]) : this.spawn.clone();
    const pose = arrivalPose({ kind: 'point', at: [pos.x, pos.y, pos.z], radius: 0 }, pack ? landmarksOf(pack) : [], null, 40, sceneOf(pack));
    const q = lookRotation(pose.forward);
    return this.arriveInShip(def, 40, 0, null, { pos, quaternion: new THREE.Quaternion(q[0], q[1], q[2], q[3]) });
  }

  /** A ship to arrive in space with when none was flown: the first X-wing the garage has, else its first ship. */
  private async defaultShipDef(): Promise<VehicleDef | null> {
    this.world.garage ??= await Garage.load(import.meta.env.BASE_URL);
    const g = this.world.garage;
    return g.find('xwing') ?? g.vehicles.find((v) => v.kind === 'ship') ?? null;
  }

  /**
   * Spawn a ship over the arrival point, put the player in it and launch it, on the way into or
   * out of space. A ship with rooms is boarded: where the crew record says, at the controls if
   * they were there, else at its pilot's spot; a fighter is sat in. With `arrival` it comes out there, facing that way,
   * and a death afterwards respawns there (in Ord Mantell the zone's origin is inside its station). With `condition` the
   * new hull arrives as damaged as the one that left (World.spawnVehicle has adopted its fight by the time it returns).
   */
  private async arriveInShip(def: VehicleDef, speed: number, height: number, crew: ShipCrew | null = null, arrival: { pos: THREE.Vector3; quaternion: THREE.Quaternion } | null = null, condition: import('./space/shipCombat').CarriedCondition | null = null): Promise<Vehicle> {
    const p = this.player;
    const at = arrival ? arrival.pos.clone() : this.spawn.clone();
    at.y += height;
    const v = await this.world.spawnVehicle(def, at, Math.PI, def.kind, true, this.fitFor(def));
    if (condition) {
      if (v.combat) v.combat.restore(condition);
      else console.warn(`travel: the ${def.id} arrived with no fight to carry its damage onto`);
    }
    // Turned to the arrival's facing before anyone is put in it, so the rooms and the seat follow the hull's final frame.
    if (arrival) {
      v.teleport(at, arrival.quaternion, 0);
      this.spawn.copy(at);
    }
    const room = v.interior;
    if (room && (crew || room.pilotSpot)) {
      room.reveal(true);
      p.board(room, crew ? crew.local.clone() : room.pilotSpot!.clone());
      if (crew) p.heading = crew.heading;
      if (crew ? crew.piloting : true) p.piloting = v;
      this.cam.zoomTarget = Math.max(this.cam.zoomTarget, 6);
    } else {
      p.mount(v);
      this.cam.distance = Math.max(this.cam.distance, 9.5);
    }
    this.lastShipDef = def;
    v.launch(speed);
    this.physics.world.step();
    return v;
  }

  /** The ship the player flies, from its seat or its bridge, when it is one the garage knows and can spawn again. */
  private pilotedShip(): Vehicle | null {
    const p = this.player;
    const ship = p.mounted ?? p.piloting;
    return ship?.spec.ship && ship.def ? ship : null;
  }

  /** Where the player stands in the ship's rooms, to stand there again in the hull spawned on the other side. */
  private crewRecord(): ShipCrew | null {
    const p = this.player;
    return p.aboard ? { local: p.pos.clone(), heading: p.heading, piloting: !!p.piloting } : null;
  }

  /** The ship's fight as it stands, to put on the hull spawned on the other side of a crossing; null for a ship with none. */
  private conditionRecord(ship: Vehicle): import('./space/shipCombat').CarriedCondition | null {
    return ship.combat ? ship.combat.shares() : null;
  }

  /** The ship menu's way up: the flown ship, high enough over a planet with an orbit, goes into it with everyone aboard. */
  private async goToSpace(): Promise<void> {
    const ship = this.pilotedShip();
    const zone = spaceZoneOf(this.world.planet);
    // A destroyed ship crosses nowhere.
    if (!ship || ship.destroyed || !zone || this.traveling || this.spaceGate !== 'up') return;
    if (this.refuseWhileDocked()) return;
    this.closePanels();
    await this.travel(zone, undefined, { def: ship.def!, speed: Math.max(60, ship.speed), height: 0, crew: this.crewRecord(), condition: this.conditionRecord(ship) });
  }

  /** The ship menu's way down: the flown ship leaves orbit for the planet below, with everyone aboard. A system with no planet below has no way down. */
  private async landShip(): Promise<void> {
    const ship = this.pilotedShip();
    const below = planetBelow(this.world.planet);
    if (!ship || ship.destroyed || !below || this.traveling) return;
    if (this.refuseWhileDocked()) return;
    this.closePanels();
    await this.travel(below, undefined, { def: ship.def!, speed: 90, height: SPACE_ARRIVAL_HEIGHT, crew: this.crewRecord(), condition: this.conditionRecord(ship) });
  }

  /** The ship menu's way off: whoever is in a ship in space goes down to the planet on foot, the ship left behind. */
  private async eject(): Promise<void> {
    const p = this.player;
    const below = planetBelow(this.world.planet);
    if (!below || this.traveling || !(p.mounted || p.aboard)) return;
    this.closePanels();
    await this.travel(below);
  }

  /** The ship menu's Hyperspace row: cancels a countdown, else opens the System Map in place of the ship menu. */
  private hyperspaceButton(): void {
    if (this.hyperspace.phase === 'countdown') {
      this.hyperspace.cancel('cancelled');
      return;
    }
    if (this.hyperspace.locksControls || !this.world.planet.space || !this.pilotedShip()) return;
    // A ship at a dock or on a station's lane is not the pilot's to take anywhere: the map reaches this
    // by its own row as well as the ship menu, so the refusal lives here rather than on the label.
    const why = this.dockRefusal();
    if (why) {
      this.hud.setPrompt(why);
      return;
    }
    this.shipMenu.hide();
    this.hyperspaceUi.show({
      here: this.world.planet.id,
      catalogue: () => this.catalogue(),
      shipAt: () => this.pilotedShip()?.pos ?? null,
      why: (d) => this.hyperspace.why(d),
    });
    // The ship menu freed the mouse; the map keeps it free.
    this.freeMouse(true);
  }

  /**
   * The galaxy map's "Hyperspace to orbit": the same jump the System Map starts, from the other tab of
   * the map window. The map closes only once the countdown has begun, so a refusal is read where it
   * was asked for; the panel shows what comes back.
   */
  private jumpFromGalaxy(d: Destination): string | null {
    // A ship at a dock or on a station's lane is not the pilot's to take anywhere.
    const held = this.dockRefusal();
    if (held) return held;
    const why = this.hyperspace.start(d);
    if (why === null && this.map.open) this.toggleMap();
    return why;
  }

  /** The System Map's Hyperspace: the countdown begins and the map closes, or the refusal is shown on it. */
  private startJump(d: Destination): void {
    const why = this.hyperspace.start(d);
    if (why === null) {
      this.hyperspaceUi.hide();
      this.freeMouse(false);
    } else this.hyperspaceUi.note(why);
  }

  /**
   * Every space zone's pack and destinations, fetched once and kept. A zone not yet converted for hyperspace makes the
   * next call build the catalogue again, and `loadSpacePack` keeps neither a missing pack nor one from before hyperspace,
   * so those zones are fetched again and a reconversion mid-session shows on the System Map without a reload.
   */
  private catalogue(): Promise<HyperspaceCatalogue> {
    if (!this.hyperspaceCatalogue) {
      const systems = PLANETS.filter((p) => p.space).map((p) => ({ id: p.id, name: p.name, below: planetBelow(p)?.name ?? null }));
      const loading = HyperspaceCatalogue.load(import.meta.env.BASE_URL, systems);
      this.hyperspaceCatalogue = loading;
      loading.then(
        (c) => {
          this.loadedCatalogue = c;
          if (this.hyperspaceCatalogue === loading && c.systems.some((s) => !s.pack?.hyperspace)) this.hyperspaceCatalogue = null;
        },
        () => {
          if (this.hyperspaceCatalogue === loading) this.hyperspaceCatalogue = null;
        },
      );
    }
    return this.hyperspaceCatalogue;
  }

  /**
   * A jump to another system, called by the jump inside its closed tunnel: the world is swapped for the zone's with the hull
   * carried across it untouched (World.loadCarrying: its body, its rooms and whoever stands in them or sits in it), and
   * the hull put at the arrival's start `pose`, still held and ghosted. What `arrive` does for a zone, without a loading
   * screen and without standing the player anywhere: `traveling` is never set, so the frames go on (the tunnel draws, the
   * crew walks the rooms) while the pack loads; the jump then waits on `readyAround` as it does inside a system. The same
   * hull, or null when it cannot be carried (gone from the world, destroyed, or another travel under way).
   */
  private async carryAcross(zone: string, hull: Vehicle, pose: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<Vehicle | null> {
    if (hull.destroyed || hull.disposed || this.traveling || !this.world.vehicles.includes(hull)) return null;
    const planet = planetById(zone);
    this.zone = planet.zones?.length ? planet.zones[0].id : undefined;
    this.postfx?.reset();
    this.marks.clear();
    // No pilot's line, ship status or target from the world left behind.
    this.shipHud.clear();
    this.shipTarget = null;
    this.targetFx.select(null, false, null);
    this.world.loadCarrying(hull, planet, packIdOf(planet, this.zone));
    if (!this.world.vehicles.includes(hull)) return null;
    // At the arrival's start, facing the arrival, before anything streams: the world streams round where the hull is.
    hull.teleport(pose.pos, pose.quaternion, 0);
    hull.held = true;
    this.spawn.copy(pose.pos);
    const p = this.player;
    if (p.aboard) p.placeVisual();
    else if (p.mounted) p.syncMount();
    this.world.warmUp(pose.pos);
    this.physics.world.step();
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id, this.zone);
    this.updateUrl();
    this.remotes.setWorld(planet.id, this.zone);
    this.net.setHello(this.helloNow());
    await this.world.loadPack(pose.pos);
    if (this.world.planet !== planet || !this.world.vehicles.includes(hull)) return null;
    this.savePlace(true);
    return hull;
  }

  /**
   * E while a jump flies the ship: nothing, except in the closed tunnel for whoever stands in the hull's rooms, where it
   * works the lifts and takes or lets go of the controls, never the door (outside is the tunnel, or no world at all).
   */
  private pressJumpE(): void {
    const p = this.player;
    const room = p.aboard;
    if (!this.hyperspace.crewFree || !room) return;
    if (this.handleElevator()) return;
    if (p.piloting || (room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE)) this.handleMount();
  }

  /** The prompt line in a jump: the countdown, "jumping", or in the tunnel what the crew can do; null outside a jump. */
  private jumpPrompt(inLift: boolean): string | null {
    const hs = this.hyperspace;
    const line = hs.prompt;
    const p = this.player;
    const room = p.aboard;
    if (!line || !hs.crewFree || !room) return line;
    if (inLift) return 'in hyperspace · <b>E</b> lift';
    if (p.piloting) return 'in hyperspace · the ship comes out when the way ahead is ready · <b>E</b> lets go of the controls';
    if (room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE) return 'in hyperspace · <b>E</b> take the controls';
    return 'in hyperspace · the ship comes out when the way ahead is ready';
  }

  /** The jump's crew kept aboard: someone who stepped out of the rooms in the tunnel (through a door) is boarded again at the entry. */
  private keepJumpCrew(): void {
    const v = this.jumpCrew;
    const p = this.player;
    const room = v?.interior;
    if (!v || !room || p.aboard || p.mounted || this.dying || !this.world.vehicles.includes(v)) return;
    this.postfx?.reset();
    room.reveal(true);
    p.board(room, room.entry.clone());
    this.cam.setFrame(v.group.quaternion);
  }

  /**
   * The jump's view for the pilot (`Hyperspace.holdsView`): the flight chase behind the ship at a fixed distance, the wheel
   * spent, whatever zoom they had (first person included) kept and put back when control returns. Allocates nothing.
   */
  private holdJumpZoom(on: boolean): void {
    const cam = this.cam;
    if (on) {
      if (this.jumpZoomKept === null) this.jumpZoomKept = cam.zoomTarget;
      cam.zoomTarget = TUNNEL_TIMES.zoom;
      cam.distance = TUNNEL_TIMES.zoom;
      this.input.wheel = 0;
    } else if (this.jumpZoomKept !== null) {
      cam.zoomTarget = this.jumpZoomKept;
      this.jumpZoomKept = null;
    }
  }

  /**
   * While the jump's tunnel is closed the world beyond it is not drawn: the camera's far plane comes in to just past the
   * tunnel's tip (three culls everything beyond), and goes back the frame it starts to open. `__debug.jumpFx({ cull: false })`
   * leaves the far plane alone.
   */
  private jumpFar(): void {
    const tunnel = this.jumpTunnel;
    if (!(this.hyperspace.covered && tunnel.shown && tunnel.look.cull && this.jumpTunnelFar > 0)) {
      this.restoreJumpFar();
      return;
    }
    const cam = this.cam.camera;
    if (this.jumpFarKept === null) this.jumpFarKept = cam.far;
    const far = Math.min(this.jumpFarKept, this.jumpTunnelFar);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  /** The camera's own far plane back (and the cascades told, as after a resize). */
  private restoreJumpFar(): void {
    if (this.jumpFarKept === null) return;
    const cam = this.cam.camera;
    cam.far = this.jumpFarKept;
    this.jumpFarKept = null;
    cam.updateProjectionMatrix();
    this.world.onCameraResized();
  }

  /** Jump to a place on the map: travel first when it is on another planet. */
  private async teleport(planet: PlanetDef, poi: Poi, zoneId?: string): Promise<void> {
    this.hyperspace.abort('teleport');
    // A teleport within the same zone changes no zone, destroys no hull and starts no jump, so a run
    // would notice nothing: it would carry the empty ship off and keep the streamer frozen where the
    // player no longer is.
    this.ultraCruise.abort();
    if (this.traveling) return;
    if (planet.id !== this.world.planet.id || (planet.zones?.length && zoneId && zoneId !== this.zone)) {
      await this.travel(planet, zoneId);
      // The pack (and with it the snapshot's centre) loads after arrival; wait for it.
      for (let i = 0; i < 100 && !this.world.layoutCenter; i++) await new Promise((r) => setTimeout(r, 100));
    }
    const c = this.world.layoutCenter;
    if (!c) return;
    this.traveling = true;
    this.map.hide();
    this.input.captured = false;
    this.loadingScreen.show(planet, poi.name, `on ${planet.name}`);
    await new Promise((r) => setTimeout(r, 250));
    // Snapshot space is mirrored in X and centred on the layout centre.
    const gx = -(poi.x - c.x);
    const gz = poi.z - c.z;
    const pos = new THREE.Vector3(gx, this.world.terrain.heightAt(gx, gz) + 0.3, gz);
    const p = this.player;
    if (p.mounted) this.handleMount();
    p.reset(pos);
    this.spawn.copy(pos);
    this.world.jumpTo(pos);
    this.physics.world.step();
    await this.settle();
    this.savePlace(true);
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
  }

  /** The camera after everything has moved: chasing a ship in flight in its own frame, the cockpit, else orbiting the player. */
  private updateCamera(blocked: import('./core/camera').CameraBlocker | null, dt = 1 / 60): void {
    this.placeCamera(blocked, dt);
    // The jump's tunnel on the hull where this frame's step left it (after the physics, before the draw), and the world
    // beyond it not drawn while it is closed.
    this.jumpTunnel.follow();
    this.jumpFar();
    // The body's place in a cockpit depends on whether the view is inside it: re-seat on the frame that changes, after the
    // camera has decided, so the frame drawn has the body where that view wants it.
    const p = this.player;
    const fp = !!p.mounted?.eyeSeat && this.cam.firstPerson;
    if (fp !== p.firstPersonSeat) {
      p.firstPersonSeat = fp;
      p.syncMount();
    }
  }

  /**
   * Where the camera goes this frame. Seated in a ship's cockpit (by its eye) the first-person view is the cockpit eye,
   * hovering (locked to the hull, `cam.cockpit`) and flying (`cam.chase`) alike, so lift-off never moves it; Alt looks
   * round from that same eye. A bridge pilot's first person is their own eyes. Allocates nothing.
   */
  private placeCamera(blocked: import('./core/camera').CameraBlocker | null, dt: number): void {
    const { player, input } = this;
    const flown = player.mounted ?? player.piloting;
    // Off every vehicle: the next ride's hovering cockpit starts its heading target afresh, even on the same hull.
    if (!flown) this.cockpitYawOf = null;
    const ship = flown?.spec.ship ? flown : null;
    // A hull this view hid is shown again once it is no longer the one flown (landed and let go, left, travelled).
    if (this.hullHidden && this.hullHidden !== ship) {
      this.hullHidden.group.visible = true;
      this.hullHidden = null;
    }
    // A jump flying this ship: its pilot's view is the chase behind it at a fixed distance, as the client's was, with no free look.
    const jumpView = !!ship && this.hyperspace.holdsView(ship);
    this.holdJumpZoom(jumpView);
    const free = input.held('freeLook') && !jumpView;
    // Seated by the eye in a ship (not a bridge pilot): the cockpit view when zoomed all the way in, hovering or flying.
    const seated = ship && player.mounted === ship && ship.eyeSeat ? ship : null;
    const inCockpit = !!seated && this.cam.firstPerson;
    if (ship && (ship.airborne || inCockpit) && free) {
      // Alt: looking round from the cockpit eye (a bridge pilot's own eyes) in the ship's frame, starting at the nose, from the
      // eye itself (no step ahead); the wheel zooms out from there in steps sized to the ship.
      this.cam.release();
      this.cam.setFrame(ship.group.quaternion);
      if (!this.altLooking) {
        this.cam.yaw = Math.PI;
        this.cam.pitch = 0;
        this.altLooking = true;
      }
      const eye = this.shipEyeWorld(ship, this.shipEyeW);
      const head = eye ?? ship.pos;
      // The orbit's centre is the standing eye height under the head, the way the figure's camera is placed.
      this.orbitUnder.copy(head).addScaledVector(tmp2.set(0, 1, 0).applyQuaternion(ship.group.quaternion), -1.5);
      this.cam.update(input, this.orbitUnder, null, dt, eye, Math.max(1, (6 + ship.radius * 2.2) / 6), 1.5, 0);
      this.showHull(ship, true);
      return;
    }
    this.altLooking = false;
    if (ship?.airborne) {
      this.cam.chase(input, dt, ship.pos, ship.attitude, ship.heading, 6 + ship.radius * 2.2, this.shipEyeLocal(ship, this.shipEye));
      // Seated in the cockpit the hull would fill the view unless a frame is drawn there; a bridge pilot keeps the rooms
      // (unless __debug.cockpit({ bridgeHull: false }) asks for the hull hidden around them).
      this.showHull(ship, !this.cam.firstPerson || !!ship.cockpitFrame || (player.piloting === ship && this.bridgeHullInFlight));
      return;
    }
    if (inCockpit && seated) {
      this.cam.release();
      this.cam.setFrame(null);
      const eye = this.shipEyeWorld(seated, this.shipEyeW) ?? seated.pos;
      this.cam.cockpit(input, dt, eye, seated.group.quaternion, seated.heading);
      if (this.cam.firstPerson) {
        this.showHull(seated, !!seated.cockpitFrame);
        return;
      }
      // Wheeled out on this very frame: the head shows again and the body rises, so this frame is drawn from the orbit
      // below, never from the eye inside the skull. The orbit's own zoom finds the wheel already spent.
    }
    this.cam.release();
    // Mounted or piloted, a ship out of the cockpit and the chase is always drawn.
    if (ship) this.showHull(ship, true);
    // Aboard a ship the view is upright in the hull's frame, as the body is; adrift in space, in the body's own.
    this.cam.setFrame(player.aboard ? roomTurn(player.aboard) : player.eva ? player.evaFrame : null);
    // Seated in a ship the first-person eye is the cockpit's, so zooming in lands there.
    const eyes = seated ? this.shipEyeWorld(seated, this.shipEyeW) : this.eyes();
    this.cam.update(input, player.worldPos, blocked, dt, eyes, 1, player.eyeHeight);
    // The frame on which the wheel has just brought the orbit in is drawn as the cockpit, not from the orbit's tilt.
    if (seated && eyes && this.cam.firstPerson) {
      this.cam.cockpit(input, dt, eyes, seated.group.quaternion, seated.heading, false);
      this.showHull(seated, !!seated.cockpitFrame);
    }
  }

  /** Show or hide a flown hull for the view, remembering one left hidden so that it is shown again when the view moves on. */
  private showHull(v: Vehicle, shown: boolean): void {
    v.group.visible = shown;
    this.hullHidden = shown ? null : v;
  }

  /** The hovering cockpit's heading target (the mouse's sideways movement, kept near the hull), or null when not steering that way. */
  private cockpitYaw: number | null = null;
  /** The vehicle cockpitYaw was taken for. */
  private cockpitYawOf: Vehicle | null = null;
  /** Alt is held for looking round from a ship's eye: the look starts at the nose once per press. */
  private altLooking = false;
  /** A bridge pilot flying in first person keeps the hull and its rooms drawn (false: hidden around them, as before). */
  private bridgeHullInFlight = true;
  /** The flown hull placeCamera last hid (a frameless cockpit, or a bridge pilot's hull with bridgeHull off); shown again when no longer flown. */
  private hullHidden: Vehicle | null = null;
  private readonly shipEye = new THREE.Vector3();
  private readonly shipEyeW = new THREE.Vector3();
  private readonly orbitUnder = new THREE.Vector3();

  private readonly eyePoint = new THREE.Vector3();

  /** Where the player's eyes are this frame: a little above and ahead of the head's joint, as the animation places it; null without a head. */
  private eyes(): THREE.Vector3 | null {
    const rig = this.player.rig;
    const head = rig?.boneFor('head');
    if (!rig || !head) return null;
    head.getWorldPosition(this.eyePoint);
    // The joint sits at the skull's base; the eyes are a hand up and ahead in the head's own frame.
    this.eyePoint.add(tmp.set(0, 0.12, 0.09).applyQuaternion(this.player.group.quaternion));
    return this.eyePoint;
  }

  /** Where first person looks from in a ship, in the hull's frame: the cockpit eye for a seated pilot, a bridge pilot's own eyes. */
  private shipEyeLocal(v: Vehicle, out: THREE.Vector3): THREE.Vector3 | null {
    if (this.player.piloting === v) {
      const e = this.eyes();
      if (e) return v.group.worldToLocal(out.copy(e)); // worldToLocal uses a module temp: no allocation
    }
    return v.cockpitEye(out);
  }

  /** The same in the world. */
  private shipEyeWorld(v: Vehicle, out: THREE.Vector3): THREE.Vector3 | null {
    if (this.player.piloting === v) {
      const e = this.eyes();
      if (e) return out.copy(e);
    }
    return v.cockpitEye(out) ? v.group.localToWorld(out) : null;
  }

  private readonly hullLocal = new THREE.Vector3();
  private readonly hullInverse = new THREE.Matrix4();

  /**
   * The camera is among the rooms of the ship the player is aboard: in first person there, or
   * standing inside the rooms' bounds. False for the chase camera, for a free look zoomed out of
   * the hull, and for a fighter's pilot, who is aboard no rooms at all. The effects take it to
   * decide how much of the planet's colour grade the view keeps.
   */
  private cameraInHull(): boolean {
    const room = this.player.aboard;
    if (!room) return false;
    // Standing on a surface is out of doors, whatever the physics of it: no room's share of the grade there.
    if (isSurfaceRoom(room)) return false;
    if (this.cam.firstPerson) return true;
    // Seating the figure has already brought the hull's world matrix up to date this frame.
    this.hullInverse.copy(room.vehicle.group.matrixWorld).invert();
    return room.contains(this.hullLocal.copy(this.cam.camera.position).applyMatrix4(this.hullInverse));
  }

  /** The colour grade on the live chain, so every console hook reads the same pass; null with the effects off. */
  private gradePass(): import('./core/fx/grade').ColorGradePass | null {
    return this.postfx?.pass<import('./core/fx/grade').ColorGradePass>('colorGrade') ?? null;
  }

  /** Drive the ridden vehicle from the keys (the mouse or A/D steer, Alt frees the look, W/S throttle, Shift boost, Space hop, the view's tilt or Space and X climb and sink), step every vehicle, and seat the rider. */
  private stepVehicles(dt: number, simulate: boolean): void {
    const { player, input } = this;
    // Whether play runs, and the ship the player flies or is aboard: what the world's ship contacts and NPC ships
    // read in stepLiving, which runs after this in the loop and in __debug.advance alike.
    this.world.simulating = simulate;
    // A hull removed with someone still in its rooms (the garage's clear, the console): out into the world first.
    if (player.aboard && !this.world.vehicles.includes(player.aboard.vehicle)) this.thrownOutOfShip(player.aboard.vehicle);
    let drive: DriveInput | null = null;
    const pilot = player.mounted ?? player.piloting;
    const playerHull = pilot ?? player.aboard?.vehicle ?? null;
    this.world.playerShip = playerHull?.spec.ship ? playerHull : null;
    if (simulate && pilot) {
      // The mouse steers: the vehicle turns toward where the camera looks, and a flyer climbs or
      // sinks as the view tilts up or down past a dead band around level. Alt frees the camera
      // to look around without steering.
      const free = input.held('freeLook');
      const tilt = -(this.cam.pitch - CAMERA_REST_PITCH);
      const vertical = free ? 0 : Math.sign(tilt) * THREE.MathUtils.clamp((Math.abs(tilt) - 0.12) / 0.45, 0, 1);
      // A ship in flight takes the mouse itself (the camera chases it); Alt hands it back to the orbit.
      const shipFlying = !!pilot.spec.ship && pilot.airborne && !free && input.locked;
      // Mouse flight (space/mouseFlight.ts): the mouse moves a cursor over the view that stays where it is left; inside the
      // aim circle it aims the guns and the ship holds its course, outside it the ship keeps turning toward it, harder the
      // further out, for as long as it is held there. Another hull, the ground, a loose pointer or a jump puts it back in the
      // middle; Alt leaves it where it is and holds the stick in the middle while the view looks round.
      const inFlight = !!pilot.spec.ship && pilot.airborne;
      if (this.flightCursorOf !== pilot || !inFlight || !input.locked || this.hyperspace.drives(pilot)) {
        this.flightCursor.x = 0;
        this.flightCursor.y = 0;
        this.flightCursorOf = pilot;
      }
      const steering = shipFlying && !this.hyperspace.drives(pilot);
      if (steering) {
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2);
        moveCursor(this.flightCursor, input.mouseDX, input.mouseDY, window.innerHeight / 2, this.cam.sensitivity, this.cam.invertY, tanHalf);
        stickFromCursor(this.flightCursor, tanHalf, this.flightStick);
      } else {
        this.flightStick.x = 0;
        this.flightStick.y = 0;
        this.flightStick.turn = 0;
      }
      // The mouse is the ship's in flight (the chase camera spends none of it), a jump's included.
      if (shipFlying) {
        input.mouseDX = 0;
        input.mouseDY = 0;
      }
      this.flightAiming = steering;
      // A ship not yet in flight hovers as a VTOL: the view's tilt does not lift it, Space and X
      // do, and A and D slide it sideways rather than turning it; in flight the keys roll it.
      const hovering = !!pilot.spec.ship && !pilot.airborne;
      const keys = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
      // Seated in a ship's cockpit and hovering: the view is the hull's, so the mouse's sideways movement moves a heading target
      // (as the orbit's yaw would) that the hull turns toward; up and down do nothing. At a bridge's controls hovering, the same
      // sideways steering (the view is in the hull's frame and turns with it; up and down still tilt it). Alt frees the view.
      // (`cam.firstPerson` is last frame's, the view being drawn; the cockpit spends the mouse again on its own frame.)
      const cockpitLocked = pilot.eyeSeat && pilot === player.mounted && !pilot.airborne && this.cam.firstPerson && !free;
      const bridgeSteer = !!pilot.spec.ship && pilot === player.piloting && !pilot.airborne && !free;
      // A target left from another ride (or from before a dismount) is never carried onto this one.
      if (this.cockpitYawOf !== pilot) {
        this.cockpitYaw = null;
        this.cockpitYawOf = pilot;
      }
      if (cockpitLocked || bridgeSteer) {
        this.cockpitYaw = cockpitYawStep(this.cockpitYaw, pilot.heading, input.locked ? input.mouseDX : 0, 0.0025 * this.cam.sensitivity);
        input.mouseDX = 0;
        if (cockpitLocked) input.mouseDY = 0;
      } else this.cockpitYaw = null;
      drive = {
        throttle: (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0),
        steer: hovering ? 0 : keys,
        strafe: hovering ? keys : 0,
        heading: free ? null : this.cockpitYaw ?? this.cam.yaw + Math.PI,
        // A ship with a fight boosts on its booster's energy.
        boost: input.held('walk') && (pilot.combat ? pilot.combat.boostLeft > 0 : true),
        hop: input.pressedAction('jump'),
        up: input.held('jump'),
        down: input.held('crouch'),
        vertical: pilot.spec.ship ? 0 : vertical,
        // In flight the stick is the cursor's, held for as long as it is left out (in the middle while Alt looks round or
        // the pointer is loose); flyShip reads a given stick as held, never drifting back.
        stickX: inFlight ? this.flightStick.x : undefined,
        stickY: inFlight ? this.flightStick.y : undefined,
      };
    }
    // A ship in a jump is flown by the jump (its cruise is `jumpCruise`), whether or not a panel is open: the pilot's keys do nothing.
    if (pilot && this.hyperspace.drives(pilot)) drive = null;
    // A dock: while its autopilot flies the ship down a station's lane, or back out along it, the drive
    // it gives is used in place of the pilot's own, and a hand on the controls hands the ship straight
    // back. Docked, it holds the hull and the pilot's drive is passed through untouched.
    if (simulate) drive = this.docking.step(pilot, dt, drive);
    // A ship's target and guns: the guns lead the target when it sits within their cone, else
    // fire along the nose; the bolts are the game's own and strike what a blaster's would, ships included.
    if (simulate && pilot?.spec.ship && !this.hyperspace.drives(pilot)) this.aimShip(pilot, dt);
    else this.shipLeadValid = false;
    const terrain = this.world.terrain;
    for (const v of this.world.vehicles) {
      // Which building room the ship stands in, followed through the portals before it steps: in one, its
      // floor is the room's and its hull ignores the terrain and the shells.
      this.world.trackVehicleRoom(v, dt);
      // An NPC ship flies on its brain's drive while play runs (held, it goes nowhere anyway).
      if (!v.drift) v.update(dt, this.physics, v === pilot ? drive : simulate && v.autopilot ? v.autopilot.drive : null, (x, z) => terrain.heightAt(x, z), (x, z) => terrain.waterHeightAt(x, z));
      else {
        const t = v.body.translation();
        v.pos.set(t.x, t.y, t.z);
        v.group.position.copy(v.pos);
        v.quaternion(v.group.quaternion);
      }
      v.interior?.physics.step(dt);
    }
    if (player.aboard) {
      // A room with a step of its own: a surface eases its up onto the face under the feet before the walker
      // is drawn on it, and says so the moment the boots let go (a jump, or the edge of the patch).
      player.aboard.step?.(dt, player);
      // Fallen out of the room (through a door in flight), or let go of: back into the world with its motion.
      if (!player.aboard.contains(player.pos)) this.leaveShip(true);
      else player.placeVisual();
    }
    // Every vehicle's hits and its state: sparks on a hit, smoke from a battered hull, and the
    // end of one whose hull is gone (its rider thrown off first).
    for (const v of [...this.world.vehicles]) {
      // On its back for a moment: the rider is thrown, and hurt by it.
      if (v === player.mounted && v.flipped) {
        this.dismountBeside(v);
        player.takeDamage(10);
        this.hud.hurt();
        this.hud.setPrompt('thrown off: the speeder is on its back');
      }
      if (v.justHit > 0) {
        this.effects.burst(v.pos, 0xffc070, 0.4 + Math.min(2, v.justHit * 0.08), 0.2);
        this.effects.flash(v.pos, 0xffa050, 6 + v.justHit, 5, 0.12);
        if (v === player.mounted) {
          player.takeDamage(Math.round(Math.min(40, (v.justHit - 6) * 1.5)));
          this.hud.hurt();
        }
      }
      if (v.struck > 0) {
        // Bolts in the hull: a jolt to whoever is at the controls, a little of it as hurt. A ship with a fight
        // takes them in its shields and armour: the pilot is jolted and keeps their health until it is destroyed.
        if (v === player.mounted || v === player.piloting) {
          if (!v.combat) player.takeDamage(Math.round(Math.min(12, v.struck * 0.2)));
          this.hud.hurt();
        }
        v.struck = 0;
      }
      const condition = v.hp / v.maxHp;
      // A ship whose combat plays its own damage bands (the game's smoke and fire) shows no stand-in smoke.
      if (condition < 0.67 && condition > 0 && !(v.combat && (this.world.ships.data?.hullFx(v.spec.id)?.damage.length ?? 0) > 0) && Math.random() < dt * (condition < 0.34 ? 9 : 3)) {
        tmp.copy(v.pos).y += (v.spec.bounds.max[1] - v.spec.bounds.min[1]) * 0.4;
        tmp.x += (Math.random() - 0.5) * v.radius;
        tmp.z += (Math.random() - 0.5) * v.radius;
        this.effects.burst(tmp, condition < 0.34 ? 0x303030 : 0x505050, 0.5 + Math.random() * 0.5, 0.9);
        if (condition < 0.34 && Math.random() < 0.3) this.effects.tracer(tmp, tmp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5)), 0xffd080, 0.12);
      }
      if (v.destroyed) {
        // The game's own explosion, the death taunt for the player's kill, the NPC ships told; then the rest as before.
        this.world.ships.onDestroyed(v);
        if (v === this.shipTarget) this.shipTarget = null;
        if (v === player.mounted) {
          // Blown up under the rider: thrown clear with its speed and a kick upward, flailing, down prone.
          const lv = v.body.linvel();
          tmp.copy(v.pos).y += 0.6;
          player.fling(tmp, tmp2.set(lv.x, lv.y, lv.z));
          player.takeDamage(25);
          this.hud.hurt();
          this.hud.setPrompt('');
        } else if (player.aboard?.vehicle === v) this.thrownOutOfShip(v);
        this.effects.ring(v.pos, 0xffa050, 6 + v.radius, 0.5);
        this.effects.burst(v.pos, 0xffc080, 2 + v.radius, 0.4);
        this.effects.flash(v.pos, 0xffa050, 60, 20, 0.35);
        // Through the world, so a painted ship's own material copies leave the portal set and the cascades with it.
        this.world.disposeVehicle(v);
      }
    }
    // The way up and the way down, for whoever flies the ship: near the top of a planet's sky its
    // space zone is within reach; in space, the planet below. Both are taken from the ship menu.
    const flown = player.mounted ?? player.piloting;
    this.spaceGate = null;
    if (flown?.spec.ship && flown.def) {
      if (this.world.planet.space) this.spaceGate = 'down';
      else if (flown.airborne && spaceZoneOf(this.world.planet) && flown.pos.y - terrain.heightAt(flown.pos.x, flown.pos.z) > SPACE_GATE_HEIGHT) this.spaceGate = 'up';
    }
    if (player.piloting?.crashed) {
      const m = player.piloting;
      player.takeDamage(Math.round(THREE.MathUtils.clamp((m.crashed - 8) * 1.2, 5, 95)));
      this.hud.hurt();
      m.crashed = 0;
    }
    if (player.mounted) {
      player.syncMount();
      const m = player.mounted;
      if (m.crashed) {
        // Flown into the ground: hurt by the speed, and the crash shown where it happened.
        const dmg = Math.round(THREE.MathUtils.clamp((m.crashed - 8) * 1.2, 5, 95));
        player.takeDamage(dmg);
        this.hud.hurt();
        this.effects.burst(m.pos, 0xffb070, 3 + m.radius, 0.35);
        this.effects.flash(m.pos, 0xff8a50, 20, 25, 0.3);
        this.hud.setPrompt(`crashed at ${Math.round(m.crashed * 3.6)} km/h: ${dmg} damage`);
        m.crashed = 0;
      }
    }
  }

  /**
   * A ship's target and guns. The target is a ship ahead: Tab cycles the ships within the
   * target cone by how far off the nose they sit, and with none chosen the nearest to the nose
   * is taken. Its lead is worked out every frame (where a bolt fired now would meet it, in the
   * shooter's frame, since a bolt carries the ship's own velocity). The guns fire in turn while
   * the trigger is held, at the lead when it sits within their cone, else along the nose, with
   * the weapon table's speed and range and the projectile table's look.
   */
  private aimShip(pilot: Vehicle, dt: number): void {
    const { input } = this;
    // A target gone, destroyed, the pilot's own, or not to be picked now (a ship in a jump) is let go.
    if (this.shipTarget && (this.shipTarget.destroyed || this.shipTarget === pilot || !this.world.vehicles.includes(this.shipTarget) || !this.shipPickable(this.shipTarget))) this.shipTarget = null;
    const nose = tmp.set(0, 0, 1).applyQuaternion(pilot.group.quaternion);
    const ahead: { v: Vehicle; off: number; hostile: boolean }[] = [];
    for (const v of this.world.vehicles) {
      if (v === pilot || !v.spec.ship || v.destroyed || !this.shipPickable(v)) continue;
      tmp2.copy(v.pos).sub(pilot.pos);
      const d = tmp2.length();
      if (d > SHIP_TARGET_RANGE || d < 1) continue;
      const off = Math.acos(THREE.MathUtils.clamp(tmp2.dot(nose) / d, -1, 1));
      if (off < SHIP_TARGET_CONE) ahead.push({ v, off, hostile: this.shipHostileToPilot(pilot, v) });
    }
    ahead.sort((a, b) => a.off - b.off);
    // With nothing picked, the ships that attack the pilot come first (Tab and the pick alike), then the nearest to the nose.
    let first = 0;
    while (first < ahead.length && !ahead[first].hostile) first++;
    if (first >= ahead.length) first = 0;
    if (input.pressedAction('target') && ahead.length) {
      const i = this.shipTarget ? ahead.findIndex((a) => a.v === this.shipTarget) : -1;
      this.shipTarget = ahead[i < 0 ? first : (i + 1) % ahead.length].v;
    } else if (!this.shipTarget && ahead.length) this.shipTarget = ahead[first].v;
    // The game's target effects follow the pick (and its standing): a change places them, the same pick does nothing.
    this.shipTargetHostile = this.shipTarget ? this.shipHostileToPilot(pilot, this.shipTarget) : false;
    this.targetFx.select(this.shipTarget, this.shipTargetHostile, this.world.ships.data);
    // The lead is worked out for the gun that fires next: a fitted ship's guns may fire different bolts.
    const nextIndex = pilot.guns.length ? (pilot.combat ? pilot.combat.nextGun : pilot.gunNext) % pilot.guns.length : -1;
    const nextGun = nextIndex >= 0 ? pilot.guns[nextIndex] : undefined;
    const lw = nextGun?.weapon ?? pilot.weapon;
    const speed = lw?.speed ?? SHIP_BOLT_SPEED;
    const range = lw?.range ?? SHIP_BOLT_RANGE;
    const own = pilot.body.linvel();
    this.shipLeadValid = false;
    const t = this.shipTarget;
    if (t) {
      const tv = t.body.linvel();
      const rel = tmp2.copy(t.pos).sub(pilot.pos);
      const relVel = boltFrom.set(tv.x - own.x, tv.y - own.y, tv.z - own.z);
      const time = interceptTime(rel, relVel, speed);
      if (time !== null && time * speed < range * 1.5) {
        leadPoint(rel, relVel, time, this.shipAim);
        this.shipLead.copy(this.shipAim).add(pilot.pos);
        this.shipAim.normalize();
        this.shipLeadValid = true;
      }
    }
    // Mouse flight: the guns aim through the cursor, kept to the aim circle, measured about the hull's nose from the
    // pilot's eye (never from the chase camera, which lags a turn by up to a quarter of a second and looks a little under
    // the hull), and cross where the target's lead is, or where the target is, or MOUSE_FLIGHT.convergeM out; within
    // MOUSE_FLIGHT.snapDeg of the lead they take it exactly. Allocates nothing. (The eye first: `eyes()` spends `tmp`.)
    this.flightOnLead = false;
    if (this.flightAiming) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2);
      const eye = this.shipEyeWorld(pilot, this.flightEye) ?? this.flightEye.copy(pilot.pos);
      this.flightNose.set(0, 0, 1).applyQuaternion(pilot.group.quaternion);
      aimCursor(this.flightCursor, tanHalf, this.flightAimCursor);
      hullRay(this.flightAimCursor, tanHalf, this.flightRay).applyQuaternion(pilot.group.quaternion);
      const far = this.shipLeadValid ? eye.distanceTo(this.shipLead) : t ? eye.distanceTo(t.pos) : MOUSE_FLIGHT.convergeM;
      this.flightRange = Math.max(MOUSE_FLIGHT.nearestM, far);
      if (this.shipLeadValid) {
        tmp2.copy(this.shipLead).sub(eye);
        const d = tmp2.length();
        this.flightOnLead = d > 1e-6 && tmp2.dot(this.flightRay) >= d * Math.cos(THREE.MathUtils.degToRad(MOUSE_FLIGHT.snapDeg));
      }
    }
    if (!pilot.guns.length) return;
    pilot.gunCooldown = Math.max(0, pilot.gunCooldown - dt);
    const combat = pilot.combat;
    if (!(input.held('attack') && input.locked && (combat || pilot.gunCooldown <= 0))) return;
    // A ship with a fight fires on its combat's turn and refire (its capacitor's, its live guns'); else the old interval.
    let gi: number;
    if (combat) {
      gi = combat.takeShot();
      if (gi < 0) return;
    } else {
      gi = pilot.gunNext % pilot.guns.length;
      pilot.gunNext++;
      pilot.gunCooldown = SHIP_GUN_INTERVAL / Math.max(1, Math.min(4, pilot.guns.length / 2));
    }
    const g = pilot.guns[gi];
    pilot.group.updateMatrixWorld(true);
    // From the muzzle as it stands now (a gun on a wing fires from where the wing has turned it).
    const from = pilot.muzzle(g, shotFrom, shotDir);
    const dir = shotDir;
    // In mouse flight the gun swings toward the cursor (every gun's bolt crossing under it), onto the lead when the cursor
    // is on it, and never further off the nose than the guns' cone (a gun far out on a wing crossing near the nose, a lead
    // snapped at the rim). Otherwise (hovering, Alt, a loose pointer) led onto the target when it sits within the guns'
    // cone. The lead is what the ship's frame sees, so the bolt's own velocity (the muzzle's plus the ship's) meets the
    // target there.
    if (this.flightAiming) {
      gunAim(from, this.flightEye, this.flightRay, this.flightRange, this.shipLeadValid ? this.shipLead : null, THREE.MathUtils.degToRad(MOUSE_FLIGHT.snapDeg), dir);
      coneClamp(dir, this.flightNose, SHIP_GUN_CONE);
    } else if (this.shipLeadValid && Math.acos(THREE.MathUtils.clamp(this.shipAim.dot(nose), -1, 1)) < SHIP_GUN_CONE) dir.copy(this.shipAim);
    from.addScaledVector(dir, 1.2);
    // What this gun fires: its own component's bolt on a fitted ship, else the ship's one weapon; with a fight, its combat's stat (invented damage).
    const w = g.weapon ?? pilot.weapon;
    const cw = combat ? combat.weaponOfGun(gi) : null;
    const gunSpeed = cw?.speed ?? w?.speed ?? SHIP_BOLT_SPEED;
    const gunRange = cw?.range ?? w?.range ?? SHIP_BOLT_RANGE;
    const projectileIndex = cw?.projectile ?? w?.projectile;
    const projectile = projectileIndex !== undefined ? this.world.garage?.projectileFor(projectileIndex) ?? null : null;
    // The shot is the pilot's ship's: whatever it hurts remembers that ship (and through it the player).
    this.world.bolts.fire(from, dir, { owner: 'player', damage: cw ? cw.damage : SHIP_GUN_DAMAGE, metresPerSecond: gunSpeed, inherit: new THREE.Vector3(own.x, own.y, own.z), life: gunRange / gunSpeed + 0.05, color: pilot.boltColor, exclude: pilot.body, projectile, source: this.world.ships.of(pilot) });
    this.effects.flash(from, pilot.boltColor, 5, 6, 0.06);
  }

  /** The target display for the HUD: where the target and its lead show on screen, in pixels, and what to call it. */
  private targetHud(pilot: Vehicle): Parameters<Hud['setTarget']>[0] {
    const t = this.shipTarget;
    if (!t) return null;
    const cam = this.cam.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toScreen = (p: THREE.Vector3) => {
      tmp2.copy(p).project(cam);
      const behind = tmp2.z > 1;
      return { x: ((behind ? -tmp2.x : tmp2.x) + 1) * 0.5 * w, y: (1 - (behind ? -tmp2.y : tmp2.y)) * 0.5 * h, on: !behind && Math.abs(tmp2.x) <= 1 && Math.abs(tmp2.y) <= 1 };
    };
    const at = toScreen(t.pos);
    const lead = this.shipLeadValid ? toScreen(this.shipLead) : { x: 0, y: 0, on: false };
    const range = Math.round(t.pos.distanceTo(pilot.pos));
    const c = this.world.ships.of(t);
    const hull = `hull ${Math.round((t.hp / t.maxHp) * 100)}%`;
    let label = `${t.spec.label} · ${range} m · ${hull}`;
    if (c) {
      // Its name, side and tier, then the shields and armour of the face turned to the pilot.
      const s = c.combat?.summary(pilot.pos) ?? null;
      label = `${c.type?.name ?? t.spec.label} · ${FACTION_LABEL[c.faction]}${c.type ? ` · tier ${c.type.tier}` : ''} · ${range} m${s ? ` · shields ${targetPct(s.shield)} · armour ${targetPct(s.armour)} · hull ${targetPct(s.hull)}` : ` · ${hull}`}`;
    }
    const kind = this.shipTargetHostile ? 'enemy' : c && shipStanding(c.faction) === 'friend' ? 'friend' : 'neutral';
    return { x: at.x, y: at.y, onScreen: at.on, leadX: lead.x, leadY: lead.y, leadOnScreen: lead.on, label, kind, onLead: this.flightOnLead && this.world.simulating };
  }

  /** Whether a ship may be picked as a target now (`targetable`: alive and not in a jump); a ship without a contact yet, by its ghosting alone. */
  private shipPickable(v: Vehicle): boolean {
    const c = this.world.ships.of(v);
    return c ? targetable(c) : !v.ghosted && !v.destroyed;
  }

  /** Whether a ship attacks the pilot: its side does on sight, its brain has the pilot's ship as its target, or it struck that ship in the last 20 s. */
  private shipHostileToPilot(pilot: Vehicle, v: Vehicle): boolean {
    const c = this.world.ships.of(v);
    if (!c) return false;
    if (shipStanding(c.faction) === 'enemy') return true;
    const mine = this.world.ships.of(pilot);
    if (!mine) return false;
    if (v.autopilot instanceof NpcBrain && v.autopilot.target === mine) return true;
    return mine.lastAttacker === c.key && this.world.simTime - mine.lastAttackedAt < 20;
  }

  /** The class's weapon and abilities, then the bolts in the air (a bolt reaching the player meets the saber first). */
  private stepCombat(dt: number): void {
    const player = this.player;
    const ctx: KitContext = { dt, input: this.input, player, world: this.world, cam: this.cam, physics: this.physics, effects: this.effects, bolts: this.world.bolts, weapons: this.weapons };
    this.kit.update(ctx);
    this.world.bolts.update(dt, {
      physics: this.physics,
      effects: this.effects,
      hittableAt: (h) => this.world.hittableAt(h),
      player,
      // A bolt the saber turns away becomes the player's: what it then hurts turns on them.
      playerSource: this.world.playerTarget,
      block: (bolt, hit, out) => player.deflect(bolt.dir, hit, this.cam, out),
      onPlayerHit: (dmg) => {
        if (player.mounted || player.noclip) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      },
    });
  }

  /** One frame through the portal renderer: the camera's building in full, the world through its doors (or the reverse). */
  /** Draw calls and triangles of the last frame, summed over every pass. */
  private frameCalls = 0;
  private frameTriangles = 0;

  /**
   * What adds light at a shot and writes no depth, for the depth of field's glow depth: hit bursts and
   * the blades' cores (the player's, the fighters'). A field initialiser, so it exists before the
   * effects chain is built; it reads the world only when a frame asks, while the lens draws.
   */
  private readonly collectDofGlows = (out: THREE.Object3D[], n: number): number => {
    // The guns' bolts, muzzle flashes and hit sparks, and the ships' bolts and their hits.
    n = this.world.weaponFx.glowBatches(out, n);
    n = this.world.shipFx.glowBatches(out, n);
    n = this.effects.glowMeshes(out, n);
    n = this.player.glowCores(out, n);
    // The fighters exist once a planet has loaded.
    if (this.world.npcs) n = this.world.npcs.glowCores(out, n);
    // The catalogue's people with a lightsaber (the dressed Jedi, Sith and Inquisitors).
    if (this.world.mobiles) n = this.world.mobiles.glowCores(out, n);
    return n;
  };

  /** The dolls follow the effects settings: Effects and Depth of field, and its strength; a change shows on their next frame. */
  private syncPreviewEffects(): void {
    const S = this.settings;
    const fx = WardrobeUi.dollEffects;
    fx.on = S.effects && S.depthOfField;
    fx.strength = S.depthOfFieldStrength;
  }

  private drawFrame(): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    // The eye in the world: aboard a ship's rooms `pos` is in the hull's frame, and the building the
    // camera is in must be walked from where the figure really stands. Kept in a field, so nothing is
    // cloned per frame.
    const at = this.player.worldPos;
    const eye = this.cameraEye.set(at.x, at.y + 1.5, at.z);
    const view = this.portals.cameraBuilding(this.world.cellState, eye, cam.position, this.world.buildings);
    // The room's air, before the scene is drawn (its motes are in it): which room this frame is
    // drawn from, its doorway beams, its lamps and its motes. The effects read it after, in the fill below.
    const ra = this.roomAirInput;
    ra.dt = this.lastDt;
    ra.camera = cam;
    ra.view = view;
    ra.cell = this.world.cellState;
    // A ship's rooms have air, lamps and motes; a surface in space has none of it, so it is not one of these.
    ra.aboard = isSurfaceRoom(this.player.aboard) ? null : (this.player.aboard as import('./vehicles/interior').ShipInterior | null);
    ra.cameraInHull = this.cameraInHull();
    ra.playerPos = this.player.pos;
    ra.sun = this.world.sunInfo(this.fxSun);
    // The weather's overcast and dust, 0 to 1 (0 while the weather is off).
    const wfx = this.world.weather.state.enabled ? this.world.weather.fx : null;
    ra.overcast = wfx ? wfx.overcast : 0;
    ra.dust = wfx ? wfx.dust : 0;
    ra.bufferHeight = this.renderer.getDrawingBufferSize(this.roomAirBuffer).y;
    this.roomAir.update(ra);
    const info = this.renderer.info.render;
    // Every renderer.render() resets these, so sum them as the passes go by.
    const auto = this.renderer.info.autoReset;
    this.renderer.info.autoReset = false;
    info.calls = 0;
    info.triangles = 0;
    // With the effects on, the passes draw into their target and the picture goes out through them.
    const postfx = this.postfx;
    // Decided before the scene is drawn, so the lit water and the reflections pass never disagree
    // about who adds the water's environment term this frame.
    this.world.beginWaterFrame(cam, this.postfx?.passWanted('waterReflections') ?? false);
    postfx?.begin();
    this.portals.render(this.scene, cam, view, this.world.buildings);
    // The falling weather, into whatever the scene was drawn into; from inside, only through the exits.
    this.world.weather.draw(this.renderer, cam, view !== null);
    if (postfx) {
      const f = this.fxInput;
      f.camera = cam;
      f.dt = this.lastDt;
      f.sun = this.world.sunInfo(this.fxSun);
      f.portalView = view !== null;
      f.cameraInHull = this.cameraInHull();
      f.inside = this.world.inside;
      f.aboard = !!this.player.aboard;
      f.space = !!this.world.planet?.space;
      f.fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
      f.daylight = this.world.day.daylight;
      f.dayIndex = this.world.day.colorIndex;
      f.lighting = this.world.swgSky?.lighting ?? null;
      f.planetId = this.world.planet?.id ?? '';
      f.aiming = this.player.aiming;
      f.aimAmount = this.cam.aimAmount;
      f.firstPerson = this.cam.firstPerson;
      f.orbitDistance = this.cam.orbitDistance;
      f.waterInView = this.world.waterBodies.inView;
      // The lights the frame was just drawn with (the shadow matrices are this frame's): the world's
      // two sets, the flash pool on the actor layer, and the torch.
      const L = this.fxLights;
      this.world.fillFxLights(L);
      const pool = this.effects.lightPool;
      for (let i = 0; i < pool.length; i++) L.flashCount = addPointLight(L.flash, L.flashCount, pool[i]);
      setSpotLight(L.sky.torch, this.torchOn ? this.torch : null);
      f.lights = L;
      // The suns (in space, the stars) the sky drew this frame, its cloud sheets, and whether the camera is under water: the lens flare's sources.
      f.skyLightCount = this.world.skyLights(f.skyLights, flareLook.nightSuns);
      f.cloudCount = this.world.cloudLayers(f.clouds);
      f.cameraUnderwater = this.world.cameraUnderwater(cam.position);
      // The room this frame is drawn from inside (RoomAir ran above, before the scene): the light shafts' input.
      f.room = this.roomAir.frame;
      // The far side of what the camera follows: nothing nearer smears with the camera.
      f.followFar = this.followFar(cam);
      // The weather the effects fade by (the god rays and the flare in overcast), while it is on.
      f.weather = wfx;
      // The lit blades as drawn this frame (drawBlades and the fighters' step have run), and how
      // bright a surface near them can be from every other light; aboard, floors are the hull's.
      const blades = this.fxBlades;
      collectBlades(blades, this.player.saberBlades, this.world.npcs.npcs, cam.position, this.world.mobiles?.live);
      const lit = this.litSources;
      lit.torch = this.torchOn ? this.torch : null;
      lit.eye.copy(cam.position);
      blades.litCeiling = litCeiling(blades, lit);
      // Whatever the player is standing in, the hull's rooms or a surface in space: "up" is that room's.
      const standingIn = this.player.aboard;
      if (standingIn) blades.up.set(0, 1, 0).transformDirection(roomFrame(standingIn));
      else blades.up.set(0, 1, 0);
      postfx.end(f);
    }
    this.frameCalls = info.calls;
    this.frameTriangles = info.triangles;
    this.renderer.info.autoReset = auto;
  }

  /**
   * Everything that moves on its own, for the motion blur, once a frame: the player and what they
   * ride, fly or stand aboard (followed by the camera), other vehicles, the creatures, the fighters,
   * the catalogue's mobiles and the other players. A field, so it exists before the chain is built;
   * it reads the world only when called. Anything that moves and is not listed blurs with the camera only.
   */
  private readonly collectMovers = (out: FxMoverList): void => {
    const p = this.player;
    out.add(p.group, true, 'player');
    const carrier = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    // Its rooms are its children, so standing aboard is riding it.
    if (carrier) out.add(carrier.group, true, 'ridden');
    const w = this.world;
    for (const v of w.vehicles) {
      if (v === carrier) continue;
      // A separate room model is always visible, but from outside it only shows through the hull, where it fails the depth test.
      const rooms = v.interior && v.interior.group !== v.group ? v.interior.group : null;
      out.add(v.group, false, 'vehicle', null, rooms);
    }
    if (w.creatures) for (const c of w.creatures.creatures) out.add(c.group, false, 'creature');
    if (w.npcs) for (const n of w.npcs.npcs) out.add(n.group, false, 'npc');
    if (w.mobiles) for (const m of w.mobiles.live) out.add(m.group, false, 'creature');
    this.remotes.collectMovers(out);
  };

  /** The follow sphere of the vehicle followed now, and what it was measured from: dropped when nothing is followed. */
  private followRoot: THREE.Object3D | null = null;
  private readonly followSphere: LocalSphere = { centre: new THREE.Vector3(), radius: 0 };
  private followChildren = -1;
  private followRooms: THREE.Object3D | null = null;
  private followAge = 0;

  /** The view depth of the far side of what the camera follows: the figure, and what it rides, flies or stands aboard. Nothing nearer smears with the camera. */
  private followFar(cam: THREE.PerspectiveCamera): number {
    const p = this.player;
    p.group.updateWorldMatrix(true, false);
    let far = followDepth(cam.matrixWorldInverse, p.group.matrixWorld, FIGURE_SPHERE);
    const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    // Hidden in a cockpit with no frame: only the figure counts.
    if (!v) {
      // Nothing kept alive for a vehicle the player has left, which may be removed.
      this.followRoot = null;
      this.followRooms = null;
    }
    if (v && v.group.visible) {
      // With a tenth and a metre spare for wings that open past the box; measured again when the model
      // changes under it (rooms or attachments arriving after the first mount), and every 120 frames.
      const rooms = v.interior?.group ?? null;
      if (this.followRoot !== v.group || this.followChildren !== v.group.children.length || this.followRooms !== rooms || ++this.followAge >= 120) {
        this.followRoot = v.group;
        this.followChildren = v.group.children.length;
        this.followRooms = rooms;
        this.followAge = 0;
        measureLocalSphere(v.group, this.followSphere, 1.1, 1);
      }
      v.group.updateWorldMatrix(true, false);
      far = Math.max(far, followDepth(cam.matrixWorldInverse, v.group.matrixWorld, this.followSphere));
    }
    // The jump's tunnel goes with the hull the camera follows: nothing nearer than its far end smears with the camera.
    if (this.jumpTunnel.shown) far = Math.max(far, this.jumpTunnel.farDepth(cam.matrixWorldInverse));
    return far;
  }

  /** A new chain with every effect registered on it, ready to be warmed. */
  private makePostFX(): PostFX {
    const fx = new PostFX(this.renderer, this.settings);
    fx.debugMaskObjects = () => {
      const out = this.fxMaskObjects;
      out.length = 0;
      out.push(this.player.group);
      const ridden = this.player.mounted ?? this.player.aboard?.vehicle ?? null;
      if (ridden) out.push(ridden.group);
      return out;
    };
    installEffects(fx, { water: this.world.waterBodies, heat: this.heat, collectMovers: this.collectMovers, collectDofGlows: this.collectDofGlows });
    return fx;
  }

  /** A setting in the effects registry moved: take all of them in one go on the next microtask. */
  private queueEffects(): void {
    if (this.fxQueued) return;
    this.fxQueued = true;
    queueMicrotask(() => {
      this.fxQueued = false;
      void this.reconcileEffects();
    });
  }

  /**
   * Bring the effects in line with the settings. Strengths and toggles are immediate. The master
   * switch changes which variant of every material is drawn, so the other variant is compiled in
   * the background with the frames still drawing the old way, and the picture changes over only
   * when the programs are ready.
   */
  private async reconcileEffects(): Promise<void> {
    if (this.fxBusy) {
      this.fxAgain = true;
      return;
    }
    this.fxBusy = true;
    try {
      do {
        this.fxAgain = false;
        const S = this.settings;
        this.postfx?.configure(S);
        this.syncPreviewEffects();
        if (S.effects === !!this.postfx) continue;
        if (!this.inWorld) {
          // Nothing is being drawn: arriving compiles for whichever path is in force then.
          if (S.effects) this.postfx = this.makePostFX();
          else {
            this.postfx?.dispose();
            this.postfx = null;
          }
          continue;
        }
        const want = S.effects;
        const next = want ? this.makePostFX() : null;
        const label = want ? 'Effects on' : 'Effects off';
        this.notice.set(`${label}: preparing shaders`);
        // The notice has to be on the screen before the compiling starts: the chain's own shaders
        // are built in one burst that holds the page, and awaiting only yields to microtasks, never
        // to a paint. Two frames is one to draw the notice and one to know it was drawn; the timer
        // is there because a hidden tab is given no frames at all.
        await new Promise<void>((done) => {
          const late = setTimeout(done, 100);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            clearTimeout(late);
            done();
          }));
        });
        if (next) await next.warmUp();
        await this.world.compileAllAsync((done, total) => this.notice.set(`${label}: shaders for ${done} of ${total} objects`), { target: next ? next.compileTarget : null, waitReady: true, keepQueue: true });
        if (this.settings.effects !== want) {
          // It moved again while we compiled: throw this one away and look at the settings afresh.
          next?.dispose();
          continue;
        }
        const old = this.postfx;
        this.postfx = next;
        next?.setSize();
        next?.reset();
        old?.dispose();
      } while (this.fxAgain || this.settings.effects !== !!this.postfx);
    } finally {
      this.fxBusy = false;
      this.notice.set(null);
      this.lastPrograms = this.renderer.info.programs?.length ?? 0;
    }
  }

  /**
   * Death: the body falls where it stood and the camera stays on it, with the respawn a button
   * away rather than a fade. A death without a rig (the placeholder figure) fades as before.
   */
  private die(): void {
    this.hyperspace.abort('died');
    this.ultraCruise.abort();
    if (this.dying) return;
    this.dying = true;
    this.closePanels();
    this.map.hide();
    this.player.startRagdoll();
    if (!this.player.ragdoll) {
      void this.fadeAndRespawn();
      return;
    }
    this.death.classList.add('on');
    this.freeMouse(true);
  }

  private async fadeAndRespawn(): Promise<void> {
    this.fade.textContent = 'YOU HAVE BECOME ONE WITH THE FORCE';
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 1400));
    this.respawn();
    this.drawFrame();
    await new Promise((r) => setTimeout(r, 200));
    this.fade.classList.remove('on');
  }

  /** Back at the spawn, whole; the ragdoll is taken away. */
  private respawn(): void {
    this.death.classList.remove('on');
    this.player.endRagdoll();
    this.player.reset(this.spawn);
    this.dying = false;
    this.freeMouse(false);
  }

  /** The panels' open state moved to the tabs: closing one panel of a pair and opening the other keeps the mouse free. */
  private anyPanelOpen(): boolean {
    return this.backpack.open || this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open || this.vehiclesUi.open || this.shipEdit.open || this.npcUi.open || this.shipMenu.open || this.hyperspaceUi.open || this.liftMenu.open || this.menu.open;
  }

  private jediKit(): JediKit {
    return this.kitFor('jedi') as JediKit;
  }

  private hunterKit(): BountyHunterKit {
    return this.kitFor('bounty_hunter') as BountyHunterKit;
  }

  /** Put skills in a class's slots (the Jedi's powers, the Bounty Hunter's gadgets), the HUD following, and keep them with the character. */
  private setSkills(cls: ClassId, loadout: (string | null)[]): void {
    if (cls === 'jedi') this.jediKit().setLoadout(loadout);
    else this.hunterKit().setLoadout(loadout);
    if (this.kit.id === cls) this.hud.setKit(this.kit);
    if (this.current && !this.creating) {
      if (cls === 'jedi') this.current.powers = loadout.map((p) => p ?? '');
      else this.current.gadgets = loadout.map((p) => p ?? '');
      upsertCharacter(this.current);
    }
  }

  /** The Skills tab shown for the class in play: its skills on offer, and its slots. */
  private showSkills(): void {
    const jedi = this.kit.id === 'jedi';
    this.forceUi.defs = jedi ? POWERS : GADGETS;
    this.forceUi.loadout = [...(jedi ? this.jediKit().loadout : this.hunterKit().loadout)];
    this.forceUi.show();
  }

  private closePanels(): void {
    if (this.backpack.open) this.backpack.hide();
    if (this.wardrobe.open) this.wardrobe.hide();
    if (this.appearanceUi.open) this.appearanceUi.hide();
    if (this.weaponsUi.open) this.weaponsUi.hide();
    if (this.forceUi.open) this.forceUi.hide();
    if (this.vehiclesUi.open) this.vehiclesUi.hide();
    // Closing the edit page writes the fits, refits the spawned ships of that id and tells the others.
    if (this.shipEdit.open) this.shipEdit.hide();
    if (this.npcUi.open) this.npcUi.hide();
    if (this.shipMenu.open) this.shipMenu.hide();
    if (this.hyperspaceUi.open) this.hyperspaceUi.hide();
    if (this.liftMenu.open) this.liftMenu.hide();
  }

  /** P: the ship menu, for whoever is in a ship (at its controls, riding it, or aboard as a passenger). */
  private toggleShipMenu(): void {
    // From the jump's enter stage until control returns, P does nothing but say so.
    if (this.hyperspace.locksControls) {
      this.hud.setPrompt('jumping');
      return;
    }
    // The System Map is a page of the ship menu: the same key closes it.
    if (this.hyperspaceUi.open) {
      this.hyperspaceUi.hide();
      this.freeMouse(false);
      return;
    }
    if (this.shipMenu.open) {
      this.shipMenu.hide();
      this.freeMouse(false);
      return;
    }
    if (!this.shipStatus()) return;
    this.closePanels();
    this.map.hide();
    this.shipMenu.show();
    this.freeMouse(true);
  }

  /** The ship the player is in and their standing with it, for the ship menu; null on foot or on a ground vehicle. */
  private shipStatus(): ShipStatus | null {
    const p = this.player;
    const ship = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    if (!ship?.spec.ship) return null;
    const inSpace = !!this.world.planet.space;
    const role = ship === p.mounted || ship === p.piloting ? 'pilot' : 'passenger';
    const hs = this.hyperspace;
    const counting = hs.phase === 'countdown';
    return {
      ship: ship.spec.label,
      role,
      inSpace,
      flying: ship.airborne,
      altitude: inSpace ? null : ship.pos.y - this.world.terrain.heightAt(ship.pos.x, ship.pos.z),
      gateHeight: SPACE_GATE_HEIGHT,
      spaceName: spaceZoneOf(this.world.planet)?.name ?? null,
      // A system that is no planet's orbit (Kessel, Ord Mantell, Deep Space) has no planet below and is named for itself.
      planetName: inSpace ? (planetBelow(this.world.planet)?.name ?? null) : null,
      zoneName: inSpace ? (this.world.spaceData?.title && this.world.spaceData.title !== this.world.planet.id ? this.world.spaceData.title : this.world.planet.name) : null,
      jump: {
        // A ship at a dock or on a lane cannot jump: it is not the pilot's to fly until it is clear.
        canJump: !inSpace ? 'only in space' : (this.dockRefusal(ship) ?? (role !== 'pilot' || !ship.def ? "the pilot's call" : null)),
        counting: counting ? (hs.prompt ?? 'counting down') : null,
        busy: hs.phase !== 'idle' && !counting,
      },
      dock: this.docking.menuRow(ship, role, inSpace),
      cruise: this.cruiseControl?.available(),
      speed: Math.round(Math.abs(ship.speed) * 3.6),
    };
  }

  /**
   * Why the flown ship cannot be taken anywhere just now, or null. A ship at a dock is held in the
   * station's own frame and the station is putting it right; one on a lane is being flown by the
   * station's autopilot. Either way the jump and both crossings must refuse, or two owners would write
   * a pose onto the same hull and the ship would be carried off the dock mid-repair.
   */
  private dockRefusal(of?: Vehicle | null): string | null {
    const ship = of ?? this.pilotedShip();
    if (this.docking.docked(ship)) return this.docking.clamp.carries(ship) ? 'let the other ship go first' : 'undock first';
    if (this.docking.flying(ship)) return "on the station's lane";
    return null;
  }

  /** The same refusal, said in the head-up display, for a row that has no words of its own. */
  private refuseWhileDocked(): boolean {
    const why = this.dockRefusal();
    if (why) this.hud.setPrompt(why);
    return why !== null;
  }

  /** The ship menu's docking row: ask for a lane, leave the dock, or break off, whichever it offers. */
  private dockButton(): void {
    const p = this.player;
    // Only whoever is at the controls: a passenger's row is dead, and nothing else may press it.
    const ship = p.mounted ?? p.piloting ?? null;
    if (!ship?.spec.ship) return;
    const said = this.docking.act(ship);
    if (said) this.hud.setPrompt(said);
  }

  private freeMouse(free: boolean): void {
    this.input.captured = free;
    if (free) this.input.releaseLock();
    else this.input.requestLock();
  }

  /** B: the spawner, the garage or the NPCs tab; the key toggles the last tab used, a tab click swaps. */
  private toggleSpawner(tab?: 'garage' | 'npcs'): void {
    const want = tab ?? this.spawnerTab;
    const wasOpen = tab === undefined && (this.vehiclesUi.open || this.npcUi.open || this.shipEdit.open);
    this.closePanels();
    this.audio.ui.play(wasOpen ? 'panelClose' : tab !== undefined ? 'select' : 'panelOpen');
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.spawnerTab = want;
    if (want === 'garage') {
      this.vehiclesUi.show();
      if (!this.garage) void this.loadGarage().then((g) => this.vehiclesUi.attach(g));
      else this.vehiclesUi.attach(this.garage);
    } else {
      this.npcUi.attach(this.spawnerDeps());
      this.npcUi.show();
    }
    this.freeMouse(true);
  }

  /**
   * What the NPC tab spawns from and counts: the whole creature and NPC catalogue through the
   * mobiles (a getter, since it may land after the tab is first opened), and the machines above it.
   * Everything stands ahead of the player, on the floor when inside a building.
   */
  private spawnerDeps(): import('./ui/npcUi').SpawnerDeps {
    return {
      kinds: this.npcKinds(),
      catalogue: () => this.world.mobileCatalogue,
      counts: () => this.world.mobiles?.counts() ?? new Map(),
      live: () => this.world.mobiles?.spawnedOut ?? 0,
      cap: () => this.world.mobiles?.cap ?? this.settings.mobileCap,
      spawn: (entry, n = 1) => {
        const mobiles = this.world.mobiles;
        const cat = this.world.mobileCatalogue;
        if (!mobiles || !cat) return { spawned: 0, note: 'the creature and NPC catalogue has not loaded yet' };
        this.cam.forward(tmp);
        const bounds = lookBounds(entry, cat.file.appearances);
        const scale = entry.size?.scale?.[1] ?? 1;
        const inside = this.world.inside;
        // Indoors it stands a few metres off (a cantina is small), on the floor under that spot.
        const distance = inside ? Math.min(4, spawnDistance(bounds, scale)) : spawnDistance(bounds, scale);
        let r = mobiles.spawnAhead(entry, this.player.pos, tmp, Math.max(1, n), distance, inside);
        // A wall nearer than that (a room's floor ends at its walls): nearer, then at the player's feet.
        for (const d of inside ? [1.5, 0.5] : []) {
          if (r.spawned) break;
          r = mobiles.spawnAhead(entry, this.player.pos, tmp, Math.max(1, n), d, inside);
        }
        return { spawned: r.spawned, note: r.note };
      },
      clear: (filter) => this.world.mobiles?.clear((m) => filter(m.entry)) ?? 0,
      clearAll: () => (this.world.mobiles?.clear() ?? 0) + this.world.npcs.removeAll() + this.world.turrets.removeAll() + (this.world.npcShips?.clear() ?? 0),
      ships: this.shipSpawner(),
      missing: `No creature and NPC catalogue yet. It loads at start; if it never does, convert it with ${CATALOGUE_COMMAND}.`,
    };
  }

  /**
   * The NPC tab's starships: the combat file's families by faction, stood 700 m ahead of the view (from the flown
   * ship, else the player), facing back; on a planet at least 150 m over the ground (the manager raises them).
   * Built when the tab opens; every call reads the world's manager then, so a travel between is followed.
   */
  private shipSpawner(): ShipSpawner {
    const labels: Record<ShipFaction, string> = { imperial: 'Imperial starships', rebel: 'Rebel starships', blacksun: 'Black Sun starships', pirate: 'Pirate starships', neutral: 'Other starships', player: 'Other starships' };
    const order: ShipFaction[] = ['imperial', 'rebel', 'blacksun', 'pirate', 'neutral'];
    const data = this.world.ships.data;
    return {
      missing: data ? null : "The ships pack has no combat.json (NPC ships and space combat): convert the ships again with npm run swg -- ships '@SWG' assets-private --retail-only",
      families: () => {
        const fams = this.world.ships.data?.families() ?? [];
        return order.map((f) => ({ faction: f, label: labels[f], rows: fams.filter((x) => (x.faction as ShipFaction) === f).map((x) => ({ family: x.family, label: x.name, tiers: x.tiers })) })).filter((g) => g.rows.length);
      },
      // The zone's tier in space (the roster's invented table), 3 on a planet.
      defaultTier: () => (this.world.planet.space ? (ZONE_TIER[this.world.planet.id] ?? 3) : 3),
      spawn: async (family, tier, count) => {
        const mgr = this.world.npcShips;
        if (!mgr) return 'no world to stand them in';
        const p = this.player;
        const flown = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const from = (flown ? flown.pos : p.worldPos).clone();
        const dir = this.cam.camera.getWorldDirection(new THREE.Vector3());
        return mgr.spawnFamily(family, tier, count, from, dir);
      },
      clear: (family) => this.world.npcShips?.clear(family ? (s) => s.type.family === family : undefined) ?? 0,
      count: (family) => this.world.npcShips?.count(family) ?? 0,
    };
  }

  /**
   * The HUD's "nearby": the nearest living thing's name within 40 m (a creature, a person, a
   * fighter), else the planet's own species. Read from the world's kept list of the living, which
   * is only rebuilt when something is added or taken away, so this walks a short array a frame.
   */
  private nearbyLabel(at: THREE.Vector3): string {
    let best = 40 * 40;
    let label: string | null = null;
    for (const t of this.world.targets()) {
      if (t.dead || t === this.world.playerTarget) continue;
      const dx = t.pos.x - at.x;
      const dz = t.pos.z - at.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        label = t.label;
      }
    }
    return label ?? this.world.planet.creatures.name;
  }

  /**
   * This planet's creature on the NPC tab: the catalogue's own (its model, clips and brain, with the
   * planet's health, blow and temper) when the catalogue has the species, else the old creature.
   */
  private planetCreatureKind(ahead: (distance: number) => { x: number; z: number; facing: number }): import('./ui/npcUi').NpcKind {
    const def = this.world.planet.creatures;
    const cat = this.world.mobileCatalogue;
    const entry = cat?.resolve(def.name);
    const temper = `${def.aggressive ? 'attacks on sight' : 'wanders, fights back when hit'}; ${def.hp} health`;
    if (cat && entry && cat.ready(entry).ok && this.world.mobiles) {
      return {
        id: 'creature',
        label: `${def.name} (this planet)`,
        blurb: `${temper}; the catalogue's ${entry.id}`,
        count: () => this.world.mobiles?.count(entry.id) ?? 0,
        spawn: () => {
          this.cam.forward(tmp);
          tmp.y = 0;
          tmp.normalize();
          const inside = this.world.inside;
          const distance = spawnDistance(lookBounds(entry, cat.file.appearances), entry.size?.scale?.[1] ?? 1);
          const spot = this.world.spawnSpot(this.player.pos, tmp, inside ? Math.min(4, distance) : distance, inside);
          if (!spot) return inside ? 'there is no floor under that spot' : 'no ground there';
          const heading = Math.atan2(this.player.pos.x - spot.x, this.player.pos.z - spot.z);
          // The planet's own health, blow and temper, as its wildlife has them; still one stood by hand.
          const got = this.world.mobiles.spawn(entry, { x: spot.x, y: spot.y, z: spot.z, heading }, { inside, overrides: ambientOverrides(def) });
          return typeof got === 'string' ? got : `a ${def.name} ahead (${this.world.mobiles.count(entry.id)} out)`;
        },
        clear: () => this.world.mobiles?.clear((m) => m.entry.id === entry.id) ?? 0,
      };
    }
    return {
      id: 'creature',
      label: def.name,
      blurb: temper,
      count: () => this.world.creatures.creatures.length,
      spawn: () => {
        const p = ahead(12);
        this.world.creatures.spawnAt(p.x, p.z);
        return `a ${def.name} 12 m ahead (${this.world.creatures.creatures.length} out)`;
      },
      clear: () => this.world.creatures.removeAll(),
    };
  }

  /** What the NPC tab can stand in front of the player: a blaster turret, a fighter, and the planet's creature. */
  private npcKinds(): import('./ui/npcUi').NpcKind[] {
    const ahead = (distance: number) => {
      this.cam.forward(tmp);
      return { x: this.player.pos.x + tmp.x * distance, z: this.player.pos.z + tmp.z * distance, facing: Math.atan2(-tmp.x, -tmp.z) };
    };
    return [
      {
        id: 'turret',
        label: 'Blaster turret',
        blurb: 'turns to face you within 45 m and fires; 120 health, stands again 25 s after it is destroyed',
        count: () => this.world.turrets.turrets.length,
        spawn: () => {
          const p = ahead(20);
          this.world.turrets.place(p.x, p.z, p.facing);
          return `a turret 20 m ahead (${this.world.turrets.turrets.length} out)`;
        },
        clear: () => this.world.turrets.removeAll(),
      },
      this.planetCreatureKind(ahead),
      {
        id: 'fighter',
        label: 'Fighter',
        blurb: 'a humanoid of a random species with a random look and a lightsaber, sword or gun off the rack; fights you and the other fighters; 160 health',
        count: () => this.world.npcs.npcs.filter((n) => !n.dead).length,
        spawn: () => {
          const inside = this.world.inside;
          let x = 0;
          let z = 0;
          let spot: THREE.Vector3 | null = null;
          if (inside) {
            // Inside a building it stands on the floor a few metres ahead, or nearer when a wall is
            // closer than that (a room's floor ends at its walls), in the room it is in.
            for (const d of [3, 1.5, 0.5]) {
              const p = ahead(d);
              spot = this.world.spawnSpot(tmp.set(p.x, this.player.pos.y, p.z), tmp2.set(0, 0, 0), 0, true);
              if (spot) break;
            }
            if (!spot) return 'there is no floor under that spot';
            x = spot.x;
            z = spot.z;
          } else {
            const p = ahead(8 + Math.random() * 4);
            x = p.x + (Math.random() - 0.5) * 4;
            z = p.z + (Math.random() - 0.5) * 4;
          }
          const n = this.world.npcs.spawnAt(x, z, undefined, spot ? { y: spot.y, inside: true } : {});
          return `a ${n.name} ahead (${this.world.npcs.npcs.length} out)`;
        },
        clear: () => this.world.npcs.removeAll(),
      },
    ];
  }

  /** Spawn a vehicle from the garage in front of the player, as its own kind or one chosen for the test. */
  async spawnVehicle(def: VehicleDef, kind?: VehicleKind): Promise<string> {
    // One ship at a time per garage id: it is prepared (and painted) before it stands, which can take a moment.
    // Creatures and speeders spawn as many as are asked for, as before.
    const guard = def.kind === 'ship';
    if (guard && this.spawning.has(def.id)) return `already preparing the ${def.label}`;
    if (guard) this.spawning.add(def.id);
    this.hud.setPrompt(`preparing the ${def.label}…`);
    // The fit the edit page kept in the last few hundred milliseconds is written before it is read.
    this.flushFits();
    try {
      const v = await this.world.spawnVehicle(def, this.player.pos, this.player.heading, kind, false, this.fitFor(def));
      // A fitted ship stood out is the one the others are told of while none is flown.
      if (v.spec.ship && def.fit) this.lastShipDef = def;
      const b = v.spec.bounds;
      const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((n) => n.toFixed(1)).join('×');
      this.hud.setPrompt(`${def.label}: a ${v.spec.kind}, ${size} m (E to ride)`);
      return `${def.id} spawned as a ${v.spec.kind}: ${size} m at ${v.pos.toArray().map((n) => n.toFixed(1)).join(',')}, ${v.pos.distanceTo(this.player.pos).toFixed(1)} m away, seat ${v.spec.seat.map((n) => n.toFixed(2)).join(',')}, hardpoints: ${v.hardpoints.join(' ') || 'none'}, seated from ${v.seatFrom ?? 'its kind'}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`spawn: ${def.id}:`, err);
      this.hud.setPrompt(msg);
      return msg;
    } finally {
      if (guard) this.spawning.delete(def.id);
    }
  }

  /** The garage, loaded once whichever asks first (the panel, the edit page, the world or the console), and the world given the same one. */
  private loadGarage(): Promise<Garage> {
    const have = this.garage ?? this.world.garage;
    if (have) {
      this.garage = have;
      this.world.garage = have;
      return Promise.resolve(have);
    }
    this.garageLoading ??= Garage.load(import.meta.env.BASE_URL).then((g) => {
      // Something else may have loaded one meanwhile (a peer's ride, the world's own spawn): the first stays.
      const keep = this.garage ?? this.world.garage ?? g;
      this.garage = keep;
      this.world.garage = keep;
      this.garageLoading = null;
      return keep;
    });
    return this.garageLoading;
  }

  /** The fit kept with the character for a garage id, or null (stock). Outside the world there is no record. */
  private savedFit(id: string): ShipFit | null {
    return this.current?.ships?.[id] ?? null;
  }

  /** Keep a ship's fit with the character (a stock one is dropped: absent is stock), written on a 300 ms debounce. */
  private saveFit(id: string, fit: ShipFit): void {
    const c = this.current;
    if (!c || this.creating) return;
    const packed = packFit(fit);
    const ships = { ...(c.ships ?? {}) };
    if (!Object.keys(packed.components).length && !Object.keys(packed.paint).length && !packed.droid) delete ships[id];
    else ships[id] = packed;
    c.ships = ships;
    window.clearTimeout(this.fitSaveTimer);
    this.fitSaveTimer = window.setTimeout(() => this.flushFits(), 300);
  }

  /** Write a fit still waiting on the debounce now (closing the page, a spawn, leaving the page). */
  private flushFits(): void {
    if (!this.fitSaveTimer) return;
    window.clearTimeout(this.fitSaveTimer);
    this.fitSaveTimer = 0;
    if (this.current && !this.creating) upsertCharacter(this.current);
  }

  /** A ship's fit as the character keeps it, resolved against its chassis (null for anything without a fit). */
  private fitFor(def: VehicleDef): ResolvedFit | null {
    if (!def.fit) return null;
    const g = this.world.garage ?? this.garage;
    return g?.resolve(def, this.savedFit(def.id)) ?? null;
  }

  /** The garage's edit button: the page, over the world, with the mouse free. */
  private openShipEdit(def: VehicleDef): void {
    this.closePanels();
    void this.shipEdit.show(def).catch((err) => console.warn(`ship edit: ${def.id}`, err));
    this.freeMouse(true);
  }

  /**
   * The edit page closed: the fit written, every spawned ship of that id refitted in place (parts
   * staged, compiled and painted before one swap), and the others told once (the hello's debounce)
   * when it is the ship this player is known by.
   */
  private async refitSpawned(def: VehicleDef): Promise<void> {
    this.flushFits();
    const next = this.fitFor(def);
    // Leaving the world refits nothing: its vehicles are about to go. A character switch closes the panels
    // first and leaves the world in the same step, so the check waits that step out.
    await Promise.resolve();
    if (next && this.inWorld && !this.traveling) {
      const key = fitKey(next);
      for (const v of [...this.world.vehicles]) {
        // An NPC ship's def is a copy of the garage hull's: it keeps its own tier fit, never the player's.
        if (v.autopilot || v.def?.id !== def.id || !v.fit || fitKey(v.fit) === key || !this.world.vehicles.includes(v)) continue;
        try {
          // After any refit of this ship still in flight, to the fit kept when its turn comes.
          await this.queueRefit(v, async () => {
            const now = this.fitFor(def);
            if (!now || !v.fit || fitKey(v.fit) === fitKey(now) || !this.world.vehicles.includes(v)) return;
            const r = await this.world.refitVehicle(v, now);
            if (r.waiting.length) console.info(`ship edit: ${def.id}: waiting for a mount: ${r.waiting.join('; ')}`);
          });
        } catch (err) {
          console.warn(`ship edit: ${def.id}: the spawned ship could not be refitted`, err);
        }
      }
    }
    if (def.id === this.helloShipId) this.queueHello();
  }

  /**
   * Run a refit of one spawned ship after any still in flight for it. `Garage.refit` stages from the ship's
   * fit as it stands and only sets the new one at the swap, so two staged from the same fit could leave the
   * model showing one part and `v.fit` naming another; one after the other, each starts from the last.
   */
  private queueRefit<T>(v: Vehicle, work: () => Promise<T>): Promise<T> {
    const before = this.refitting.get(v) ?? Promise.resolve();
    const run = before.catch(() => {}).then(work);
    this.refitting.set(v, run);
    void run
      .catch(() => {})
      .finally(() => {
        if (this.refitting.get(v) === run) this.refitting.delete(v);
      });
    return run;
  }

  /** The ship this player is known by on the relay: the one ridden, flown or aboard, else the last fitted one stood out or flown, with its fit. */
  private helloShip(): { id: string; fit: ShipFit } | undefined {
    const p = this.player;
    const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    const def = v?.def?.fit ? v.def : this.lastShipDef?.fit ? this.lastShipDef : null;
    if (!def) return undefined;
    return { id: def.id, fit: packFit(this.savedFit(def.id) ?? stockFit()) };
  }

  /** The ship ridden, flown or boarded, else the nearest ship spawned, for the console. */
  private nearShip(): Vehicle | null {
    const p = this.player;
    const own = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    if (own?.spec.ship) return own;
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.world.vehicles) {
      if (!v.spec.ship || v.autopilot) continue;
      const d = v.pos.distanceTo(p.worldPos);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** Up to `n` drawn frames (a hidden tab draws none: the wait ends after `timeoutMs`); how many were seen. */
  private waitFrames(n: number, timeoutMs = 2000): Promise<number> {
    return new Promise((resolve) => {
      let seen = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(seen);
      };
      const step = () => {
        if (done) return;
        if (++seen >= n) finish();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      window.setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Run a refit or repaint of a ship and count the programs made by its swap over the two frames after it.
   * `compiledOnSwap` counts only the new programs that belong to what the ship draws (its model, parts,
   * glows and trails): a change of gun also warms the new bolt's fire and hit effects far below the world
   * (`World.warmShipFx`), which compile on those same frames and are the warm-up doing its work, not the
   * swap; they are in `programsAfter - programsBefore` and `warmed` says a warm-up was started.
   */
  private async measureSwap<T>(v: Vehicle, work: () => Promise<T>): Promise<{ report: T; programsBefore: number; programsAfter: number; compiledOnSwap: number; warmed: boolean; frames: number }> {
    const report = await work();
    const r = this.renderer;
    const programsBefore = r.info.programs?.length ?? 0;
    const known = new Set(r.info.programs ?? []);
    const frames = await this.waitFrames(2);
    const programsAfter = r.info.programs?.length ?? 0;
    // The ship's materials now (the swap's parts, the paint's copies, the glows and the trails' ribbons).
    const mats = new Set<THREE.Material>();
    const collect = (o: THREE.Object3D) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
    };
    v.group.traverse(collect);
    for (const t of v.trails) t.mesh.traverse(collect);
    const made = new Set<unknown>();
    for (const m of mats) {
      if (!r.properties.has(m)) continue;
      const programs = (r.properties.get(m) as { programs?: Map<string, unknown> }).programs;
      for (const p of programs?.values() ?? []) if (!known.has(p as THREE.WebGLProgram)) made.add(p);
    }
    const warmed = !!(report as { weaponsChanged?: boolean } | null)?.weaponsChanged;
    return { report, programsBefore, programsAfter, compiledOnSwap: made.size, warmed, frames };
  }

  /** The console's refit: a slot's component ('' empties it) or the droid, kept with the character, on the ship ridden (else the nearest). */
  private async debugRefit(slot: string, component: string): Promise<unknown> {
    const v = this.nearShip();
    const def = v?.def;
    if (!v || !def?.fit || !v.fit) return v ? `${v.spec.id} has no fit (a pack converted before ship customization)` : "no ship: spawn one (spawn('xwing')) or board one";
    const s = slot === 'droid' ? null : def.fit.slots.find((x) => x.slot === slot);
    if (slot !== 'droid' && (!s || s.fixed)) return `${def.id} has no slot ${slot} to fit; its slots: ${def.fit.slots.filter((x) => !x.fixed).map((x) => x.slot).join(', ')}, droid`;
    const fit = copyShipFit(this.savedFit(def.id) ?? stockFit());
    if (slot === 'droid') {
      if (component) fit.droid = component;
      else delete fit.droid;
    } else if (component === (s!.stock ?? '')) delete fit.components[slot];
    else fit.components[slot] = component;
    this.saveFit(def.id, fit);
    this.flushFits();
    const next = this.fitFor(def);
    if (!next) return 'the garage is not loaded';
    // After any refit of this ship still in flight (the page's close, an earlier call).
    const out = await this.queueRefit(v, () => this.measureSwap(v, () => this.world.refitVehicle(v, this.fitFor(def) ?? next)));
    // The other spawned ships of that id follow, and the others are told.
    void this.refitSpawned(def);
    return { ...out, fitted: slot === 'droid' ? next.droid : (next.components[slot] ?? null), notes: next.notes };
  }

  /** The console's repaint: paint values kept with the character (a repaint in place), or each shader's own texture ('static') and back ('custom'). */
  private async debugPaint(values: Record<string, number> | 'static' | 'custom'): Promise<unknown> {
    const v = this.nearShip();
    const def = v?.def;
    if (!v || !def?.fit || !v.fit) return v ? `${v.spec.id} has no fit (a pack converted before ship customization)` : "no ship: spawn one (spawn('xwing')) or board one";
    if (!v.paint || !def.fit.paint) return `${def.id}'s paint is fixed in the game: its shaders take no colours`;
    const paint = v.paint;
    if (values === 'static' || values === 'custom') return this.queueRefit(v, () => this.measureSwap(v, () => paint.showStatic(values === 'static')));
    const fit = copyShipFit(this.savedFit(def.id) ?? stockFit());
    for (const [k, n] of Object.entries(values)) fit.paint[k] = n;
    this.saveFit(def.id, fit);
    this.flushFits();
    const next = this.fitFor(def);
    if (!next) return 'the garage is not loaded';
    const out = await this.queueRefit(v, () => this.measureSwap(v, () => this.world.refitVehicle(v, this.fitFor(def) ?? next)));
    void this.refitSpawned(def);
    return { ...out, paint: next.paint, painted: next.painted, custom: paint.custom };
  }

  /** The console's view of a fit: a spawned ship's as it stands (parts hung, waiting, guns), or a garage id's stock. */
  private async shipFitReport(id?: string): Promise<unknown> {
    const g = await this.loadGarage();
    const describe = (def: VehicleDef, fit: ResolvedFit) => {
      const fd = def.fit!;
      const labelOf = (name: string | null | undefined) => (name ? (g.components[g.componentByName.get(name) ?? -1]?.label ?? name) : null);
      return {
        chassis: fd.chassis,
        slots: fd.slots.filter((s) => !s.fixed).map((s) => ({ slot: s.slot, label: slotLabel(s), component: fit.components[s.slot] ?? null, name: labelOf(fit.components[s.slot]), look: fit.looks[s.slot] ?? -1, looks: s.looks.length, stock: s.stock })),
        fixed: fd.slots.filter((s) => s.fixed).length,
        droid: fit.droid,
        socket: fd.droid,
        paint: fit.paint,
        painted: fit.painted,
        notes: fit.notes,
      };
    };
    if (id) {
      const def = g.find(id);
      if (!def) return `no vehicle matches ${id}`;
      if (!def.fit) return `${def.id} has no fit in this pack (converted before ship customization): npm run swg -- ships @SWG assets-private --retail-only`;
      const stock = g.resolve(def, null);
      if (!stock) return `${def.id}: the garage could not resolve its fit`;
      const parts = partsOf(def.fit, def.id, stock, g.droids);
      return { ship: def.id, fit: 'stock', ...describe(def, stock), parts: parts.map((p) => `${p.slot}: ${p.path.replace(/^.*\//, '')} on ${p.hardpoint || 'the origin'}`), partCount: parts.length, kept: this.savedFit(def.id) };
    }
    const v = this.nearShip();
    if (!v) return "no ship: spawn one, board one, or give a garage id (shipFit('xwing'))";
    const def = v.def;
    if (!def?.fit || !v.fit) return `${v.spec.id} has no fit (a pack converted before ship customization)`;
    const parts: string[] = [];
    for (const [slot, roots] of v.build?.fitParts ?? []) for (const r of roots) parts.push(`${slot}: ${r.name || r.userData.name || '(part)'}`);
    return {
      ship: def.id,
      fit: 'spawned',
      ...describe(def, v.fit),
      parts,
      partCount: parts.length,
      pending: (v.build?.pending ?? []).map((p) => `${p.slot}: ${p.label} waits for hardpoint ${p.hardpoint}`),
      custom: v.paint?.custom ?? false,
      guns: v.guns.map((gun) => ({ slot: gun.slot ?? null, hardpoint: gun.hardpoint ?? null, weapon: (gun.weapon ?? v.weapon)?.name ?? null, projectile: (gun.weapon ?? v.weapon)?.projectile ?? null, live: !!gun.node?.parent })),
      kept: this.savedFit(def.id),
    };
  }

  /** Put a weapon from the rack in a hand (null empties it), switching to the kit that fights with it. */
  async equip(def: WeaponDef | null, hand: 'right' | 'left'): Promise<string> {
    if (!def) return this.equipment.stow(hand);
    if (!this.weapons) return 'no weapons converted';
    // Through the equipment: the hands' rules, the model compiled before it is in hand, and the weapon given.
    const r = await this.equipment.hold(def, hand, { give: true });
    if (r.wants && r.wants !== this.kit.id) this.setClass(r.wants);
    if (r.note !== 'dropped') this.hud.setPrompt(r.wants ? `${r.note} (${def.class}, ${this.player.saber.style})` : r.note);
    return r.note;
  }

  /** I: the inventory (the backpack, the appearance, the skills and the give tabs); the key toggles the last tab used, a tab click swaps. */
  private toggleInventory(tab?: InventoryTab): void {
    if (this.creating) {
      if (tab === 'appearance' || tab === 'wardrobe') this.showCreatorTab(tab);
      return;
    }
    const want = tab ?? this.inventoryTab;
    const wasOpen = tab === undefined && (this.backpack.open || this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open);
    this.closePanels();
    // The backpack's own open and close, from the game's interface table.
    this.audio.ui.play(wasOpen ? 'panelClose' : tab !== undefined ? 'select' : 'panelOpen');
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.inventoryTab = want;
    const character = this.player.rig?.character ?? null;
    if (want === 'backpack') {
      this.backpack.show();
      void this.refreshBackpack();
    } else if (want === 'wardrobe') {
      // In the world the Clothes tab is a developer's give tool.
      this.wardrobe.developer = true;
      this.wardrobe.show();
      if (character) void this.wardrobe.attach(character, import.meta.env.BASE_URL).catch((err) => console.warn('wardrobe', err));
      else this.wardrobe.explain('This character is a single model, not a set of parts, so there is nothing to change. Convert it with <code>npm run swg -- parts</code>.');
    } else if (want === 'appearance') {
      this.appearanceUi.show();
      if (character) this.appearanceUi.attach(character, import.meta.env.BASE_URL);
      else this.appearanceUi.explain('This character is a single model, not a set of parts, so there is nothing to shape. Convert it with <code>npm run swg -- species</code>.');
    } else if (want === 'force') this.showSkills();
    else {
      this.weaponsUi.held = { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null };
      this.weaponsUi.show();
    }
    this.freeMouse(true);
  }


  private toggleMap(): void {
    if (this.map.open) {
      this.map.hide();
      this.input.captured = false;
      this.input.requestLock();
    } else {
      this.map.show();
      this.input.captured = true;
      this.input.releaseLock();
    }
  }

  /**
   * E in a lift shaft (a room the building or ship names for its elevator): the lift menu, the
   * levels the shaft reaches by the rooms they open into; at an elevator terminal: up for an up
   * terminal, down for a down one, up then down for a plain one; beside a building that cannot
   * be walked into: inside it.
   */
  private handleElevator(): boolean {
    const p = this.player;
    const lift = this.liftHere();
    if (lift) {
      this.liftNow = lift;
      this.closePanels();
      this.map.hide();
      this.liftMenu.show(lift.title, lift.stops.map((s, i) => ({ label: stopLabel(lift.stops, i), current: i === lift.current })));
      this.freeMouse(true);
      return true;
    }
    if (p.aboard) return false;
    const near = this.world.elevatorsNear(p.pos, MOUNT_RANGE);
    if (near.length) {
      const kind = near[0].kind;
      const tryDir = (up: boolean) => {
        const next = this.world.useElevator(p.pos, up);
        if (!next) return false;
        p.reset(next);
        this.physics.world.step();
        return true;
      };
      if (kind === 'up') tryDir(true);
      else if (kind === 'down') tryDir(false);
      else if (!tryDir(true)) tryDir(false);
      return true;
    }
    if (this.world.doorlessNear(p.pos)) {
      const at = this.world.enterDoorless(p.pos);
      if (at) {
        p.pos.copy(at);
        p.vel.set(0, 0, 0);
        this.physics.world.step();
      }
      return true;
    }
    return false;
  }

  /** The lift shaft the player stands in, in a building or aboard a ship, with its stops. */
  private liftHere(): { stops: LiftStop[]; current: number; title: string } | null {
    const p = this.player;
    return p.aboard ? p.aboard.liftHere(p.pos) : this.world.liftHere(p.pos);
  }

  /** The lift the menu was opened for. */
  private liftNow: { stops: LiftStop[]; current: number; title: string } | null = null;

  /** A stop picked in the lift menu: the player steps out through that level's doorway. */
  private rideLift(index: number): void {
    const lift = this.liftNow;
    const p = this.player;
    const stop = lift?.stops[index];
    this.liftMenu.hide();
    this.freeMouse(false);
    if (!stop) return;
    const next = p.aboard ? p.aboard.rideLift(stop) : this.world.rideLift(stop);
    if (!next) return;
    p.pos.copy(next);
    p.vel.set(0, 0, 0);
    if (!p.aboard) this.physics.world.step();
  }

  private handleMount(): void {
    const p = this.player;
    if (isSurfaceRoom(p.aboard)) {
      // Standing on a surface: E climbs into a ship within arm's reach, and takes the boots off otherwise.
      const near = this.reachFromBoots();
      this.leaveShip(false);
      if (near?.interior) this.boardShip(near);
      else if (near) {
        p.mount(near);
        if (near.spec.ship && near.def) this.lastShipDef = near.def;
        this.cam.distance = Math.max(this.cam.distance, 9.5);
      }
      return;
    }
    if (p.aboard) {
      const room = p.aboard;
      const v = room.vehicle;
      if (p.piloting) {
        // Letting go of the controls, in flight too: the ship carries on as it was (there is no
        // landing place in space), and the room stays a still room around whoever is aboard.
        p.piloting = null;
        this.hud.setPrompt('');
        return;
      }
      if (room.pilotSpot && p.pos.distanceTo(room.pilotSpot) < CONTROLS_RANGE) {
        p.piloting = v;
        this.cam.zoomTarget = Math.max(this.cam.zoomTarget, 6);
        this.hud.setPrompt(`at the controls of the ${v.spec.label} · <b>W</b>/<b>S</b> throttle · mouse steers · <b>E</b> lets go`);
        return;
      }
      // The two hulls are clamped together and this walker stands at the room's own way in: E crosses
      // into the other ship's rooms rather than stepping out of a door that opens onto the hull it
      // rides. Anywhere else in the room E steps out as it always did.
      const across = this.docking.clamp.crossing(v, p.pos);
      if (across) {
        this.crossToShip(room, across.to);
        return;
      }
      this.leaveShip(false);
      return;
    }
    if (p.mounted) {
      this.dismountBeside(p.mounted);
      return;
    }
    let best = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      const d = this.vehicleReach(sp);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    if (best?.interior) {
      this.boardShip(best);
      return;
    }
    if (best?.upsideDown) {
      // On its back: E turns it over rather than climbing on.
      best.rightSelf();
      this.physics.world.step();
      return;
    }
    if (best) {
      p.mount(best);
      if (best.spec.ship && best.def) this.lastShipDef = best.def;
      this.cam.distance = Math.max(this.cam.distance, 9.5);
      return;
    }
    // Nothing to climb into, and out in space: the gravity boots take hold of whatever is within reach.
    if (this.world.planet.space && p.eva) this.bootsTake(null);
  }

  /** A note the boots left (why they would not take hold), shown in the prompt for a moment. */
  private bootsNote = '';
  private bootsNoteAt = 0;

  /** The vehicle within arm's reach of someone standing on a surface, measured in the world, since `pos` is the room's there. */
  private reachFromBoots(): Vehicle | null {
    const at = this.player.worldPos;
    let best: Vehicle | null = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      if (sp.autopilot) continue;
      const d = at.distanceTo(sp.pos) - sp.radius;
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  /**
   * Switch the gravity boots on: whatever is nearest along the ways looked (what `toward` says first, then
   * where the camera points, then the six ways out of the figure itself) becomes the ground, and the figure
   * stands on it with that face's own up. It holds to anything solid, a rock, a station or a hull, and to one
   * that moves as readily as to one that does not, since the room is read from what it stands on every step.
   */
  private bootsTake(toward: THREE.Vector3 | null, from?: THREE.Vector3): boolean {
    const p = this.player;
    if (p.aboard || p.mounted || p.noclip || this.dying) return false;
    const note = (why: string): false => {
      this.bootsNote = why;
      this.bootsNoteAt = performance.now();
      return false;
    };
    if (!this.world.planet.space) return note('the boots only hold where there is no gravity');
    // The room is a room of a hull's: the ship stood beside, or the nearest one in the zone.
    const ship = this.reachFromBoots() ?? [...this.world.vehicles].filter((v) => !v.autopilot).sort((a, b) => a.pos.distanceToSquared(p.worldPos) - b.pos.distanceToSquared(p.worldPos))[0];
    if (!ship) return note('no ship out here to boot from');
    // The look starts at the waist, away from the face being looked for, so a ray never starts inside it.
    const at = bootAt.copy(from ?? p.worldPos);
    if (toward) at.addScaledVector(bootScratch[0].copy(toward).normalize(), -SURFACE_ROOM.waist);
    else at.addScaledVector(bootScratch[0].set(0, 1, 0).applyQuaternion(p.group.quaternion), SURFACE_ROOM.waist);
    let best: { d: number } | null = null;
    bootDir.length = 0;
    if (toward) bootDir.push(bootScratch[1].copy(toward));
    this.cam.camera.getWorldDirection(bootScratch[8]);
    bootDir.push(bootScratch[8]);
    for (let i = 0; i < 6; i++) {
      const v = bootScratch[i + 2].set(i === 0 ? 1 : i === 1 ? -1 : 0, i === 2 ? 1 : i === 3 ? -1 : 0, i === 4 ? 1 : i === 5 ? -1 : 0);
      bootDir.push(v.applyQuaternion(p.group.quaternion));
    }
    for (let i = 0; i < bootDir.length; i++) {
      const dir = bootDir[i];
      const hit = probeSurface(this.physics, at, dir, SURFACE_ROOM.reach, p.body);
      if (!hit || (best && hit.distance >= best.d)) continue;
      best = { d: hit.distance };
      bootPoint.copy(hit.point);
      bootUp.copy(hit.normal);
      bootBody = hit.body;
      // The way that was asked for wins outright rather than only by being nearest: a pilot climbing out is
      // looking along their hull's own down, and what the ship stands on is what they should stand on, even
      // though the hull they just left is nearer to them than the rock under it.
      if (i === 0 && toward) break;
    }
    if (!best) return note(`nothing within ${Math.round(SURFACE_ROOM.reach)} m to stand on`);
    const gravity = -this.physics.world.gravity.y;
    const room = SurfaceRoom.take(this.physics, bootPoint, bootUp, bootBody, ship, gravity, ship.body.isValid() ? ship.body : null);
    if (!room) return note('nothing there the boots can hold to (no surface was found in it)');
    this.postfx?.reset();
    p.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, SURFACE_ROOM.zoom);
    this.bootsNote = '';
    return true;
  }

  /** Off the vehicle onto the floor beside it (in space, adrift beside it with its motion). */
  private dismountBeside(sp: Vehicle): void {
    // A frameless hull hidden by the cockpit or the flight chase must not stay hidden once no one is in it.
    sp.group.visible = true;
    const p = this.player;
    sp.quaternion(tmpQ);
    tmp.set(-(sp.spec.bounds.max[0] - sp.spec.bounds.min[0]) / 2 - 1.0, 0, 0).applyQuaternion(tmpQ).add(sp.pos);
    // A machine on its back has its side vector pointing down: beside it along the ground instead.
    if (sp.upsideDown) tmp.set(sp.pos.x + Math.cos(sp.heading) * (sp.radius + 1), sp.pos.y, sp.pos.z - Math.sin(sp.heading) * (sp.radius + 1));
    // The floor beside the vehicle, by a ray from its own height: in a hangar that is the
    // hangar's floor, not the terrain under the building, which put the rider outside it.
    const from = sp.pos.y + 0.5;
    if (this.world.planet.space) {
      // Out into space: beside the hull where it is, carrying its motion, adrift.
      tmp.y = sp.pos.y;
      p.dismount(tmp);
      const lv = sp.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      // Out of a ship set down on something: the boots take hold of it, so the pilot stands on it rather
      // than floating off the moment they climb out. The hull's own down is the way to look first.
      if (sp.landed) {
        sp.quaternion(tmpQ);
        this.bootsTake(tmp2.set(0, -1, 0).applyQuaternion(tmpQ), tmp);
      }
      return;
    }
    const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 12, sp.body);
    tmp.y = hit !== null ? from - hit + 0.15 : Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
    p.dismount(tmp);
  }

  /**
   * Out of one clamped ship's rooms and into the other's, at its way in. The body leaves the room it
   * was in before it is put in the next (`Player.board` does that itself), so it is never left in a
   * physics world nothing steps; a flame held in the old hull's frame goes out with it.
   */
  private crossToShip(from: import('./vehicles/surfaceRoom').WalkableRoom, to: Vehicle): void {
    const room = to.interior;
    if (!room) return;
    // The camera steps from one hull's frame into another's: the effects have no history across it.
    this.postfx?.reset();
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    from.reveal(false);
    room.reveal(true);
    this.player.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.hud.setPrompt(`across in the ${to.spec.label} · <b>E</b> at the way in crosses back · <b>E</b> anywhere else steps out`);
  }

  /** Step into a ship's room, at its entry. The seat inside is not there yet: E again steps out. */
  private boardShip(v: Vehicle): void {
    const room = v.interior;
    if (!room) return;
    // The camera jumps into the rooms: the effects have no history across it, and the grade takes
    // the rooms' share of the planet's look at once rather than easing into it. Below the guard,
    // so E at a ship with no rooms does not throw a frame of history away for nothing.
    this.postfx?.reset();
    room.reveal(true);
    this.player.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.hud.setPrompt(`aboard: <b>E</b> steps out · the room has physics of its own · <b>__debug.shipDrift(2, 0.4)</b> sets the hull adrift to test it`);
  }

  /**
   * The ship the player was aboard is gone (blown up, or removed): out of its rooms into the world where
   * the hull was, with the hull's motion, adrift in space or falling on a planet. Also the guard for any
   * path that removes a hull with someone still in it, so the body is never left in a freed room.
   */
  private thrownOutOfShip(v: Vehicle): void {
    const p = this.player;
    const room = p.aboard;
    if (!room || room.vehicle !== v) return;
    // Standing on a surface when a ship went. The boots hold to what is under the feet, not to the ship that
    // brought you: only a walker standing on that very hull is let go (adrift where they stood on the next
    // look, nothing thrown and nothing hurt). Standing on a rock beside it, the rock is untouched and the
    // room is merely pointed at a live hull, since it names one for the aboard path's sake.
    if (isSurfaceRoom(room)) {
      if (room.standsOn(v.body)) room.release();
      else room.renameTo(this.reachFromBoots() ?? this.world.vehicles.find((o) => o !== v && !o.autopilot) ?? null);
      return;
    }
    room.toWorld(p.pos, tmp);
    const lv = v.body.linvel();
    p.leave();
    // A flame held in the room lived in the hull's frame, which may be gone: its heat and its effect stop.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    p.fling(tmp, tmp2.set(lv.x, lv.y, lv.z));
    p.takeDamage(20);
    this.hud.hurt();
    this.hud.setPrompt('');
    this.cam.setFrame(null);
  }

  /** Out of a ship's room: beside the hull on the floor found there, or, having fallen out, where the hull's frame put the figure, with the hull's motion. */
  private leaveShip(fell: boolean): void {
    const p = this.player;
    const room = p.aboard;
    if (!room) return;
    // The figure is stood beside the hull, so this is a camera cut too. Below the guard: a call
    // made with nobody aboard changes nothing and should cut nothing.
    this.postfx?.reset();
    const v = room.vehicle;
    // The boots: the figure is left adrift exactly where it stood, carrying what it was doing in the room
    // and what the room itself was doing, and the room goes with it (nothing else holds a surface).
    const surface = isSurfaceRoom(room) ? room : null;
    room.toWorld(p.pos, tmp);
    if (surface) surface.worldVelocity(p.vel, tmp2);
    // Dying in the boots builds the ragdoll in the surface's own physics world, and that world is freed a few
    // lines below: the corpse goes first, or the next frame's ragdoll step reads bodies that are gone.
    if (surface && p.ragdoll) p.endRagdoll();
    p.leave();
    // A flame held in the room lived in the hull's frame: it stops, and a trigger still held places it again outside.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    room.reveal(false);
    if (surface) {
      p.stand(tmp);
      p.vel.copy(tmp2);
      p.grounded = false;
      surface.dispose();
      this.hud.setPrompt('');
      return;
    }
    if (!fell) {
      v.quaternion(tmpQ);
      tmp.set(-(v.spec.bounds.max[0] - v.spec.bounds.min[0]) / 2 - 1.2, 0, 0).applyQuaternion(tmpQ).add(v.pos);
      const from = v.pos.y + 0.5;
      // In space there is no ground under the hull: the spot beside it is where the figure goes, boots and all.
      if (!this.world.planet.space) {
        const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 20, v.body);
        tmp.y = hit !== null ? from - hit + 0.15 : this.world.terrain.heightAt(tmp.x, tmp.z) + 0.3;
      }
    }
    p.stand(tmp);
    if (fell) {
      const lv = v.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      p.grounded = false;
    }
    // Out of a ship set down on something in space: the boots take hold of what it is standing on.
    if (!fell && this.world.planet.space && v.landed) {
      const lv = v.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      p.grounded = false;
      v.quaternion(tmpQ);
      this.bootsTake(tmp2.set(0, -1, 0).applyQuaternion(tmpQ), tmp);
    }
    this.hud.setPrompt('');
  }

  /** Whether the nearest vehicle in reach has a room to step into. */
  private nearestHasRoom(): boolean {
    let best: Vehicle | null = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      const d = this.vehicleReach(sp);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return !!best?.interior;
  }

  private nearestSpeederDistance(): number {
    let d = Infinity;
    for (const sp of this.world.vehicles) d = Math.min(d, this.vehicleReach(sp));
    return d;
  }

  private nearestVehicle(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.vehicles) {
      const d = this.vehicleReach(sp);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  /** How far a vehicle's side is from the player across the ground, or far when it is well above or below them (a flyer overhead, a bike up a cliff). */
  private vehicleReach(v: Vehicle): number {
    // An NPC ship is never mounted or boarded: this one test feeds E, the prompts and every "nearest".
    if (v.autopilot) return Infinity;
    const p = this.player.pos;
    const dy = Math.abs(v.pos.y - p.y);
    if (dy > 4) return Infinity;
    return Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.radius;
  }

  run(): void {
    // A frame that throws is logged (once per distinct error every few seconds, so the console
    // stays readable) and the next one runs as usual, with nothing left half-applied from the
    // input: the game keeps going, and the message says what failed and where.
    const seen = new Map<string, number>();
    const frame = () => {
      requestAnimationFrame(frame);
      try {
        step();
      } catch (err) {
        const key = String((err as Error)?.message ?? err);
        const now = performance.now();
        if ((seen.get(key) ?? -Infinity) < now - 5000) {
          seen.set(key, now);
          console.error('frame failed (the game carries on):', err);
        }
        this.input.endFrame();
      }
    };
    const step = () => {
      const tFrame = performance.now();
      this.timer.update();
      const rawDt = this.timer.getDelta();
      const dt = Math.min(0.05, rawDt);
      this.lastDt = dt;
      const input = this.input;
      const player = this.player;
      // On the select screen and in the creator there is no world: nothing streams, nothing draws
      // but the panels, and the frame costs nothing.
      if (!this.inWorld) {
        // The mixer still steps: the select screen and the creator have their own clicks, and the
        // bank's slices and the loops' clocks must go on whether a world is up or not.
        this.stepAudio(dt);
        input.endFrame();
        return;
      }
      const active = this.started && !this.traveling && !this.dying && !this.menu.open;
      if (active) this.savePlace();
      // The jump's countdown (held still while the Escape menu is open) and its phases; during a crossing's travel it waits.
      if (!this.traveling) this.hyperspace.update(dt, rawDt, this.menu.open);
      // The lift menu takes the number keys while it is up, before the kit's slots see them.
      if (this.liftMenu.open) for (let n = 1; n <= 9; n++) if (input.consumeKey(`Digit${n}`)) this.liftMenu.pickKey(n);

      if (active) {
        // Not while a jump flies the ship: the map's teleport would abort it half way into another system's load.
        if (input.pressedAction('map') && !this.hyperspace.locksControls) this.toggleMap();
        // I and B wait out a jump from its countdown until control returns: closing the ship edit page refits the hull,
        // which would build parts (and maybe programs) on a live frame and could hand the ghosted hull live colliders.
        const jumpBusy = this.hyperspace.phase === 'countdown' || this.hyperspace.locksControls;
        if (input.pressedAction('inventory') && !jumpBusy) this.toggleInventory();
        if (input.pressedAction('spawner') && !jumpBusy) this.toggleSpawner();
        if (input.pressedAction('ship')) this.toggleShipMenu();
        if (input.pressedAction('help')) this.hud.toggleHelp();
        if (!this.map.open && !this.anyPanelOpen()) {
          if (input.pressedAction('saberToggle') && this.kit.id === 'jedi' && !player.mounted) player.toggleSaber();
          if (input.pressedAction('switchClass')) this.setClass(this.kit.id === 'jedi' ? 'bounty_hunter' : 'jedi');
          // Locked from the jump's enter stage until control returns, but for the crew in the tunnel (`pressJumpE`); the key only:
          // leaving for the select screen and the map's teleport abort the jump first.
          if (input.pressedAction('mount') && !player.noclip) {
            if (!this.hyperspace.locksControls) {
              if (!this.handleElevator()) this.handleMount();
            } else this.pressJumpE();
          }
          if (input.pressedAction('noclip') && !player.mounted && !this.hyperspace.locksControls) player.toggleNoclip();
          if (player.noclip && input.pressedAction('noclipFaster')) player.noclipSpeed = Math.min(2000, player.noclipSpeed * 1.5);
          if (player.noclip && input.pressedAction('noclipSlower')) player.noclipSpeed = Math.max(2, player.noclipSpeed / 1.5);
          if (input.pressedAction('flashlight')) this.torchOn = !this.torchOn;
          // The wings key: the pilot of a ship whose wings open picks open or closed over the flight rule, held until the key
          // is pressed again or the seat is left (a ship nobody flies goes back to the rule). Locked while a jump flies the ship.
          const wingsOf = player.mounted ?? player.piloting;
          if (input.pressedAction('wings') && wingsOf?.spec.ship && wingsOf.wings.length && !this.hyperspace.locksControls) wingsOf.wings.toggle();
          // Cut the engines: nothing holds the ship up, and it comes down and settles on the ground.
          // Not while a jump flies it, and not on the ground, where the throttle is what lifts it off.
          if (input.justPressed(CUT_ENGINES_KEY) && wingsOf?.spec.ship && !this.hyperspace.locksControls && !this.world.planet.space) {
            if (wingsOf.powered) wingsOf.cutEngines();
            else wingsOf.enginesOn();
          }
          // The same key out in space, where there is nothing to cut the engines over: set the hull down on
          // whatever is under it, and, once it is down, lift it off along that face's own up.
          if (input.justPressed(CUT_ENGINES_KEY) && wingsOf?.spec.ship && !this.hyperspace.locksControls && this.world.planet.space) wingsOf.askSetDown();
          // The ultra cruise: the same key starts a run and lets go of one. It says for itself where
          // it may run at all, so the only thing asked here is that a jump is not flying the hull.
          if (input.justPressed(CRUISE_KEY) && !this.hyperspace.locksControls) this.ultraCruise.toggle();
          dropPilotChoices(this.world.vehicles, wingsOf);
          // The emote wheel: held open, the mouse picks, the key's release plays; the arrows play the first four outright.
          if (input.pressedAction('emoteWheel') && !player.mounted) this.emoteWheel.show(this.emotes);
          this.stepEmoteKeys();
        }
      }
      if (this.emoteWheel.open) {
        this.emoteWheel.move(input.mouseDX, input.mouseDY);
        input.mouseDX = 0;
        input.mouseDY = 0;
        if (!input.held('emoteWheel') || !active) {
          const clip = this.emoteWheel.selected();
          this.emoteWheel.hide();
          if (active) this.playEmote(clip);
        }
      }
      this.stepEmoteEnd();

      const simulate = active && !this.map.open && !this.anyPanelOpen();
      // Nothing aims while the player is not simulated (dead, a panel, the map, the menu, travel):
      // player.update, which reads the mouse, does not run, so the shoulder view and the lens would
      // otherwise hold on under the death card. The next simulated frame reads the button afresh.
      if (!simulate && (player.aiming || this.cam.aim)) {
        player.aiming = false;
        this.cam.aim = false;
      }
      // Dead: the body keeps falling and settling under the camera while the respawn waits.
      if (this.dying && player.ragdoll) player.ragdollStep();
      if (simulate) {
        player.update(dt, input, this.cam, this.world);
        // The thrown and orbiting sabers and the hilt glow from the pooled flash lights (so no light comes
        // or goes with them), unless the effects light what is around the blades.
        if (!this.bladeGlowOwnsLight()) for (const spot of player.lightSpots()) this.effects.flash(spot.pos, player.saberColor, spot.intensity, spot.distance, 0.08);
        this.scorch(dt);
        this.stepCombat(dt);
      }

      // Before the hulls step: a run writes its hull's pose, and the hull's own update writes the
      // same pose again on the same frame, so nothing ever lags a step.
      this.ultraCruise.update(dt);
      this.stepVehicles(dt, simulate);
      this.stepNet(dt);

      const fast = simulate && input.held('fastForward');
      for (const m of this.shown) m.update(dt);
      // Where the player stands, whether it may be attacked at all, and what a blow does: the one
      // record everything alive fights over. Mounted stays targetable, as it always has -- the
      // creatures chase a rider -- and the damage is dropped by the callback.
      const hurt = (dmg: number) => {
        if (!simulate || player.mounted || player.noclip || player.aboard) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      };
      // The weather's view of the player: aboard rooms nothing falls; a ridden ship's box keeps rain out of its canopy.
      this.world.aboard = !!player.aboard;
      this.world.weatherHull = player.mounted?.spec.ship ? player.mounted : null;
      this.world.weatherRidden = player.mounted;
      this.hud.setWeatherNote(this.world.weather.heldNote());
      this.world.setPlayerTarget(player.worldPos, simulate && !player.noclip && !player.aboard && !this.dying && player.hp > 0, hurt);
      this.world.update(dt, player.worldPos, this.cam.camera.position, fast, hurt, simulate && !player.mounted && !player.noclip && !player.aboard ? player : null);
      // The pool serves the latest request first when it is full (flashes age only in effects.update),
      // so the room lights go last and always keep their lights; the fighters' glows just before them,
      // farthest first, so the nearest win; this frame's shots, powers and muzzle flashes came earlier
      // and give way. Here the hull is where stepVehicles left it and the fighters where they moved to.
      if (simulate) {
        if (!this.bladeGlowOwnsLight()) {
          const glows = this.world.npcs.lightSpots(npcGlow, this.cam.camera.position, FIGHTER_GLOW_RANGE);
          // The catalogue's people's blades, merged into the same two nearest (keepNearestGlow keeps the list sorted).
          const all = this.world.mobiles ? this.world.mobiles.lightSpots(npcGlow, this.cam.camera.position, FIGHTER_GLOW_RANGE, glows) : glows;
          for (let i = all - 1; i >= 0; i--) this.effects.flash(npcGlow[i].pos, npcGlow[i].color, 2, 5, 0.08);
        }
        // Aboard, the room's own lights, the nearest few, through the same pool (no new lights, so nothing recompiles).
        if (player.aboard) for (const l of player.aboard.roomLights(player.pos, 3, roomLightSpots)) this.effects.flash(l.pos, l.color, l.intensity, l.distance, 0.08);
      }
      const tPhys = performance.now();
      this.physics.step(dt);
      stats.physicsMs = performance.now() - tPhys;
      this.effects.update(dt);

      if (simulate && player.hp <= 0) void this.die();

      player.inside = this.world.inside || !!player.aboard;
      const room = player.aboard;
      this.updateCamera(player.noclip ? null : room ? (from, to) => room.cameraBlock(from, to) : (from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside), dt);
      // The ear sits at the camera, set after the frame's last camera move: aboard a ship, in the
      // cockpit or on foot, what is heard is what the picture is drawn from.
      this.stepAudio(dt);
      this.torch.intensity = this.torchOn ? 260 : 0;
      if (this.torchOn) {
        this.torch.position.copy(this.cam.camera.position);
        this.cam.camera.getWorldDirection(torchDir);
        this.torch.target.position.copy(this.cam.camera.position).addScaledVector(torchDir, 12);
      }
      // Out of the eyes the body stays in the picture and the head, hair and headwear draw into the shadows only (headHide.ts).
      if (player.rig) {
        player.group.visible = true;
        player.rig.setHeadHidden(this.fpHeadForce ?? this.cam.firstPerson);
      } else player.group.visible = !this.cam.firstPerson; // the primitive placeholder body, before any rig
      // Seated in a ship without a cockpit frame the game drew no pilot: the whole figure, shadow included, is hidden.
      if (player.mounted?.riderHidden) player.group.visible = false;
      // After the physics step and the camera: the falling weather around this frame's camera.
      this.world.updateWeatherView(dt);
      this.world.updateShadows(performance.now());

      // The ship menu is where space is gone to and come back from; the prompt says when the ship is high enough.
      const shipKey = keyName(input.bindings.ship[0] ?? '');
      const shipHint = this.spaceGate === 'up' ? ` · <b>at altitude for space: ${shipKey}</b> ship menu` : this.world.planet.space ? ` · <b>${shipKey}</b> ship menu` : '';
      let prompt = '';
      let lift: ReturnType<App['liftHere']> = null;
      let doorless: { label: string } | null = null;
      if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl</b> down · <b>Shift</b> fast · <b>+</b>/<b>-</b> speed · <b>N</b> off`;
      else if (player.mounted) prompt = mountPrompt(player.mounted, input.bindings.wings[0] ?? WINGS_KEY) + (player.mounted.spec.ship ? shipHint : '');
      else if ((lift = this.liftHere())) prompt = `<b>E</b> lift: ${lift.stops.length} levels`;
      else if (!player.aboard && this.world.elevatorsNear(player.pos, MOUNT_RANGE).length) prompt = `<b>E</b> elevator ${this.world.elevatorsNear(player.pos, MOUNT_RANGE)[0].kind === 'down' ? 'down' : 'up'}`;
      else if (!player.aboard && (doorless = this.world.doorlessNear(player.pos))) prompt = `<b>E</b> enter ${doorless.label} (no way in on foot)`;
      else if (player.piloting) prompt = `at the controls of the ${player.piloting.spec.label} · ${player.piloting.landed ? `landed · <b>W</b> or <b>Space</b> lifts off` : `<b>W</b>/<b>S</b> throttle · mouse steers${player.piloting.spec.ship && SHIP_GROUND.rule === 'landing' ? ` · hold <b>Ctrl</b> to set down · <b>${keyName(CUT_ENGINES_KEY)}</b> cuts the engines` : ''}`} · <b>Alt</b> looks around · <b>E</b> lets go · ${Math.round(Math.abs(player.piloting.speed) * 3.6)} km/h${shipHint}${player.piloting.landNote ? ` · ${player.piloting.landNote}` : ''}`;
      // Standing on something out in space: the boots hold, a jump lets go, and E climbs into a ship beside you.
      else if (isSurfaceRoom(player.aboard)) prompt = `<b>gravity boots</b> on ${this.reachFromBoots() ? 'a surface · <b>E</b> climbs into the ship' : 'a surface · <b>E</b> takes them off'} · <b>jump</b> lets go${player.aboard.atEdge ? ' · <b>the surface underfoot runs out near here</b>' : ''} · <b>${shipKey}</b> ship menu`;
      else if (player.aboard) prompt = (player.aboard.pilotSpot && player.pos.distanceTo(player.aboard.pilotSpot) < CONTROLS_RANGE ? `<b>E</b> take the controls` : `aboard ${player.aboard.vehicle.spec.label} · <b>E</b> step out`) + (this.world.planet.space ? ` · <b>${shipKey}</b> ship menu` : '');
      else if (player.eva) prompt = `adrift · <b>W/S</b> thrust ahead and back · <b>A/D</b> sideways · <b>Space/Ctrl</b> up and down · mouse turns · <b>Z/V</b> roll · <b>${keyName(input.bindings.brake[0] ?? '')}</b> brake · ${Math.round(player.vel.length() * 3.6)} km/h${this.nearestSpeederDistance() < MOUNT_RANGE ? (this.nearestHasRoom() ? ' · <b>E</b> board' : ' · <b>E</b> mount') : ' · <b>E</b> gravity boots'}${performance.now() - this.bootsNoteAt < SURFACE_ROOM.note * 1000 && this.bootsNote ? ` · ${this.bootsNote}` : ''}`;
      else if (this.nearestSpeederDistance() < MOUNT_RANGE) prompt = this.nearestHasRoom() ? '<b>E</b> board' : this.nearestVehicle()?.upsideDown ? '<b>E</b> flip it upright' : '<b>E</b> mount';
      // A jump's countdown, then "jumping", over whatever the prompt would say; in the tunnel, the crew's lifts and controls.
      prompt = this.jumpPrompt(lift !== null) ?? prompt;
      this.hud.setPrompt(prompt);
      // Mouse flight's display (seated or at a bridge's controls, in flight, Alt not held): the aim circle, the ring and the
      // cursor, in pixels, at this frame's field of view. The cursor is the hull's (about its nose, from the pilot's eye), so
      // the circle is drawn where the boresight lands on this camera's screen at the guns' range, and the cursor where its
      // own direction lands: in the cockpit that is the middle; in the chase view it drifts off the middle while the view
      // catches a turn up, and sits a little under it (the view looks under the hull). Unsimulated (a panel, the map,
      // death), nothing is on the lead. Allocates nothing.
      const flownShip = player.mounted ?? player.piloting;
      // Nothing flown: the cursor's hull is let go (a disposed hull is not kept), and the next one starts in the middle.
      if (!flownShip) this.flightCursorOf = null;
      const flying = !!flownShip?.spec.ship && flownShip.airborne && !input.held('freeLook') && !this.hyperspace.drives(flownShip);
      if (flying && flownShip) {
        const cam = this.cam.camera;
        cam.updateMatrixWorld();
        const halfW = window.innerWidth / 2;
        const half = window.innerHeight / 2;
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        const fv = this.flightView;
        const q = flownShip.group.quaternion;
        const eye = this.shipEyeWorld(flownShip, this.flightShowEye) ?? this.flightShowEye.copy(flownShip.pos);
        const range = this.flightRange > 0 ? this.flightRange : MOUSE_FLIGHT.convergeM;
        // The boresight at the guns' range; the circle's scale is the eye's distance over the camera's (the chase view
        // sits behind the eye, so the circle there shows a little smaller).
        const p = this.flightShow.set(0, 0, 1).applyQuaternion(q).multiplyScalar(range).add(eye);
        const scale = range / Math.max(1e-3, cam.position.distanceTo(p));
        p.project(cam);
        const centred = p.z > 1 || !Number.isFinite(p.x);
        fv.ox = centred ? 0 : p.x * halfW;
        fv.oy = centred ? 0 : -p.y * half;
        const s = centred ? 1 : scale;
        fv.circle = circleRadius(tanHalf) * half * s;
        fv.ring = ringRadius(tanHalf) * half * s;
        hullRay(this.flightCursor, tanHalf, p).applyQuaternion(q).multiplyScalar(range).add(eye).project(cam);
        if (centred || p.z > 1 || !Number.isFinite(p.x)) {
          fv.cx = this.flightCursor.x * half * s;
          fv.cy = this.flightCursor.y * half * s;
        } else {
          fv.cx = p.x * halfW - fv.ox;
          fv.cy = -p.y * half - fv.oy;
        }
        fv.inside = insideCircle(this.flightCursor, tanHalf);
        fv.turn = this.flightStick.turn;
        fv.onLead = this.flightOnLead && this.world.simulating;
      }
      this.hud.setFlight(flying ? this.flightView : null);
      const aimed = player.mounted ?? player.piloting;
      const showTarget = aimed?.spec.ship && aimed.airborne && !input.held('freeLook') && !this.hyperspace.drives(aimed);
      this.hud.setTarget(showTarget ? this.targetHud(aimed) : null);
      // The target effects stand on the target while it is shown, and follow it; out of the ship they go.
      if (!aimed?.spec.ship) this.targetFx.select(null, false, null);
      this.targetFx.update();
      // The flown ship's shields, armour, hull, boost and what is down; the comms fading.
      this.shipHud.setStatus(aimed?.combat ? aimed.combat.status() : null, aimed?.combat?.stats);
      this.shipHud.update(dt);
      const at = player.worldPos;
      this.hud.update(dt, at.x, at.y, at.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.nearbyLabel(at), player.saberOn);

      if (this.breakFrames) throw new Error('debug: the frame is broken on purpose');
      // The blades are drawn from where the hands ended up this frame, so they never trail the pose.
      player.drawBlades(dt, this.cam.camera);
      const tRender = performance.now();
      this.drawFrame();
      stats.renderMs = performance.now() - tRender;
      stats.frameMs = performance.now() - tFrame;
      // A shader compiled on a live frame is a stall: say which frame, and how many, so the cause can be found.
      const programs = this.renderer.info.programs?.length ?? 0;
      // While the effects are switching over, programs are made on purpose and on frames that are not stalls.
      // Under the jump's white, the destination's programs are made on purpose (World.readyAround), unseen.
      if (programs > this.lastPrograms && this.lastPrograms > 0 && !this.traveling && !this.fxBusy && !this.hyperspace.covered) console.info(`shaders: ${programs - this.lastPrograms} compiled during play (${stats.frameMs.toFixed(0)} ms frame, ${programs} programs in all)`);
      this.lastPrograms = programs;
      stats.rawDt = rawDt;
      stats.grounded = player.grounded;
      stats.vel = [player.vel.x, player.vel.y, player.vel.z];
      stats.calls = this.frameCalls;
      stats.triangles = this.frameTriangles;
      stats.pack = this.world.packStatus;
      stats.terrain = this.world.terrain.swg ? `${this.world.terrain.swg.template.name}: ${this.world.terrain.swg.syncGenerations} sync grids` : 'procedural';
      stats.chunks = this.world.chunkCount;
      input.endFrame();
    };
    frame();
  }
}

async function boot(): Promise<void> {
  const physics = await Physics.create();
  new App(physics).run();
}

void boot();
