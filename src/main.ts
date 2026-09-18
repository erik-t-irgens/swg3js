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
import { PLANETS, packIdOf, planetById, spaceZoneOf, type PlanetDef } from './data/planets';
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
import { heatTuning, type HeatProduct } from './core/fx/heat';
import { HeatSources, plumeNoiseFrequency } from './world/heatSources';
import { vehiclePlumes } from './vehicles/enginePlumes';
import { Notice } from './ui/notice';
import { VehiclesUi } from './ui/vehiclesUi';
import { NpcUi } from './ui/npcUi';
import { AppearanceUi } from './ui/appearanceUi';
import { CharacterSelect } from './ui/characterSelect';
import { CreatorBar } from './ui/creatorBar';
import { Menu, keyName } from './ui/menu';
import { ShipMenu, type ShipStatus } from './ui/shipMenu';
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
import type { Vehicle, VehicleKind } from './vehicles/vehicle';
import { World } from './world/world';
import { RANGE } from './world/gallery';

/** The keys for the vehicle ridden, by its kind. */
function mountPrompt(v: import('./vehicles/vehicle').Vehicle): string {
  const k = v.spec.kind;
  const bar = (f: number) => '▮'.repeat(Math.round(f * 8)) + '▯'.repeat(8 - Math.round(f * 8));
  const boost = v.spec.boost === 'heat' ? ` · <b>Shift</b> boost · heat ${bar(v.meter)}${v.overheated > 0 ? ' BURNT OUT' : ''}` : v.spec.boost === 'burst' ? ` · <b>Shift</b> boost ${bar(v.meter)}` : '';
  const hop = v.spec.hop ? ' · <b>Space</b> hop' : '';
  const fly = v.spec.fly ? ' · look up/down or <b>Space</b>/<b>X</b> to climb and sink' : '';
  if (k === 'ship') {
    // Hovering, the ship is a VTOL: it holds still until the throttle opens, rises and sinks on the keys, slides sideways. In flight the mouse flies it.
    const hover = `<b>W</b> throttle up into flight · mouse turns · <b>Space</b>/<b>Ctrl</b> rise and sink · <b>A/D</b> slide`;
    const flight = `<b>W</b>/<b>S</b> throttle up and down · mouse pitches and turns (loops and rolls allowed) · <b>A/D</b> roll · <b>Space</b>/<b>X</b> pitch`;
    return `<b>E</b> leave · ${v.airborne ? flight : hover} · <b>wheel</b> zoom, all the way in for the cockpit · <b>Alt</b> look around${v.guns.length ? ' · <b>click</b> fires · <b>Tab</b> next target' : ''} · <b>Shift</b> burn · ${v.airborne ? 'flying' : 'hovering'} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h${v.hp < v.maxHp ? ` · hull ${Math.round((v.hp / v.maxHp) * 100)}%` : ''}`;
  }
  const turn = k === 'ground' ? 'mouse or <b>A/D</b> turn' : 'mouse or <b>A/D</b> steer';
  const hull = v.hp < v.maxHp ? ` · hull ${Math.round((v.hp / v.maxHp) * 100)}%${v.hp / v.maxHp < 0.34 ? ' LIMPING' : v.hp / v.maxHp < 0.67 ? ' smoking' : ''}` : '';
  return `<b>E</b> dismount · <b>W/S</b> throttle · ${turn} · <b>Alt</b> look around${boost}${hop}${fly} · ${k} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h${hull}`;
}

const MOUNT_RANGE = 3.6;
type InventoryTab = 'wardrobe' | 'appearance' | 'weapons' | 'force';
/** The camera pitch a flyer holds its height at: the default view, a little above level. */
const CAMERA_REST_PITCH = 0.32;

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0, triangles: 0, pack: '', terrain: '', chunks: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const roomLightSpots: import('./vehicles/interior').RoomLight[] = [];
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
}
const tmp2 = new THREE.Vector3();
const boltFrom = new THREE.Vector3();

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
  private kit!: Kit;
  private readonly hud: Hud;
  private readonly map: MapUi;
  private readonly wardrobe: WardrobeUi;
  private readonly weaponsUi: WeaponsUi;
  private readonly forceUi: ForceUi;
  private readonly vehiclesUi: VehiclesUi;
  private garage: Garage | null = null;
  private npcUi: NpcUi;
  private appearanceUi: AppearanceUi;
  private characterId = 'human_male';
  private speciesList: SpeciesEntry[] = [];
  private breakFrames = false;
  private inventoryTab: InventoryTab = 'wardrobe';
  private spawnerTab: 'garage' | 'npcs' = 'garage';
  private weapons: WeaponCatalogue | null = null;
  private readonly fade: HTMLElement;
  private readonly death: HTMLElement;
  private readonly select: CharacterSelect;
  private readonly creatorBar: CreatorBar;
  private readonly menu: Menu;
  private readonly shipMenu: ShipMenu;
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
  private readonly fxInput: FxFrameInput = { camera: null as unknown as THREE.PerspectiveCamera, dt: 1 / 60, sun: null, portalView: false, cameraInHull: false, inside: false, aboard: false, space: false, fog: null, daylight: 1, dayIndex: 0, lighting: null, planetId: '', aiming: false, aimAmount: 0, firstPerson: false, skyLights: createSkyLights(MAX_FLARE_SOURCES), skyLightCount: 0, clouds: createCloudLayers(MAX_CLOUD_LAYERS), cloudCount: 0, cameraUnderwater: false, waterInView: false, blades: this.fxBlades, lights: this.fxLights };
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

  constructor(private readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: true });
    // ?lowfx=1 is the cheap preset for this session; otherwise the settings kept in this browser.
    const lowfx = new URLSearchParams(location.search).get('lowfx') === '1';
    if (lowfx) Object.assign(this.settings, { renderScale: 0.5, shadows: false, effects: false });
    const S = this.settings;
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
    this.world.renderer = this.renderer;
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
    // Shaders are warmed for the target the frames are actually drawn into: with the effects on,
    // a program compiled with nothing bound is the wrong variant and is thrown away on first use.
    this.world.compileTarget = () => this.postfx?.compileTarget ?? null;
    this.world.userFog = S.fog;
    this.world.normalScale.set(S.normalStrength, -S.normalStrength);
    Character.normalScale.set(S.normalStrength, -S.normalStrength);
    this.world.setShadowLook(S.shadowSoftness, undefined, S.shadowMapSize);
    this.world.setShadows(S.shadowDistance, S.shadowCasterRadius);
    this.world.setReach(S.objectReach, S.terrainRadius, S.farRadius);
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
    this.litSources.world = this.world;
    this.litSources.effects = this.effects;
    this.scene.add(this.marks.mesh);
    this.hud = new Hud(this.ui);
    this.wardrobe = new WardrobeUi(this.ui, () => this.hud.setPrompt(''));
    this.wardrobe.setBaseUrl(import.meta.env.BASE_URL);
    this.weaponsUi = new WeaponsUi(this.ui, (def, hand) => void this.equip(def, hand));
    // The Skills tab: the Force powers or the gadgets in the number slots, given to the class's kit and kept with the character.
    this.forceUi = new ForceUi(this.ui);
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
    this.shipMenu = new ShipMenu(this.ui, { status: () => this.shipStatus(), goToSpace: () => void this.goToSpace(), land: () => void this.landShip(), eject: () => void this.eject() }, () => keyName(this.input.bindings.ship[0] ?? ''));
    this.shipMenu.onClose = () => this.toggleShipMenu();
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
    this.weaponsUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.forceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.vehiclesUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    this.npcUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    void WeaponCatalogue.load(import.meta.env.BASE_URL).then((c) => {
      this.weapons = c;
      this.weaponsUi.attach(c);
      this.world.npcDeps.weapons = c;
      this.world.npcDeps.effects = this.effects;
      this.world.npcDeps.compile = (objects) => this.world.compileReady(objects);
      this.world.npcs?.attach(this.world.npcDeps);
      if (c) console.info(`weapons: ${c.weapons.length} on the rack, ${c.skipped.length} left out`);
    });
    const galaxy = new GalaxyMap(
      this.ui,
      (p, zone) => void this.travel(p, zone),
      (p, poi, zone) => void this.teleport(p, poi, zone),
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
      objects: () =>
        this.world.placedObjects.map((o) => {
          const station = o.template.includes('spacestation');
          return { x: o.x, y: o.y, z: o.z, radius: o.radius, station, name: station ? this.world.stationNameAt(o.x, o.z) : undefined };
        }),
      ships: () => {
        const p = this.player;
        const mine = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
        const out = this.world.vehicles
          .filter((v) => v.spec.ship)
          .map((v) => ({ x: v.pos.x, y: v.pos.y, z: v.pos.z, quaternion: v.quaternion(new THREE.Quaternion()), mine: v === mine, label: v === mine ? 'your ship' : `a ship (${v.spec.label})` }))
          .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
        // On foot (adrift), the player is the mark the view centres on.
        if (!mine) {
          const at = p.worldPos;
          out.unshift({ x: at.x, y: at.y, z: at.z, quaternion: p.eva ? p.evaFrame.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading), mine: true, label: 'you' });
        }
        return out;
      },
      onTeleport: (poi) => void this.teleport(this.world.planet, poi, this.zone),
    });
    this.map.onClose = () => this.toggleMap();
    // Every panel moves by its header and stays put; the overlay round it is clear, so the world shows behind.
    draggable(this.map.root, '.map-panel', '.map-header', 'map');
    draggable(this.shipMenu.root, '.ship-panel', '.ship-header', 'ship');
    for (const [id, ui] of [['wardrobe', this.wardrobe], ['weapons', this.weaponsUi], ['garage', this.vehiclesUi], ['npcs', this.npcUi], ['appearance', this.appearanceUi]] as const) draggable(ui.root, '.wardrobe-panel', '.wardrobe-header', id);
    // Console hooks for driving the game from tests: window.__debug.teleport(x, z, yaw), .look(yaw, pitch), .cell().
    (window as unknown as { __debug: unknown }).__debug = {
      /** Put the player at x, z on the ground (or at `y`); a point inside a building's room, once that building's interior is built, counts as being in it. Returns the cell. */
      teleport: (x: number, z: number, yaw?: number, y?: number) => {
        const at = new THREE.Vector3(x, y ?? this.world.terrain.heightAt(x, z) + 0.3, z);
        this.player.reset(at);
        if (yaw !== undefined) this.cam.yaw = yaw;
        return { cell: this.world.enterCellAt(at) };
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
      /** Compile every pass and product material again and say how many programs that made; a second call should say 0. */
      fxWarm: async () => (this.postfx ? await this.postfx.warmUp() : 'the effects are off; turn Effects on in the menu'),
      /** What the card is holding: how the dispose is checked, since turning the effects off and on three times must leave the texture count where it was. */
      renderInfo: () => ({ memory: { ...this.renderer.info.memory }, programs: this.renderer.info.programs?.length ?? 0, effects: !!this.postfx }),
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
          gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets-private/${file}`);
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
            m.castShadow = true;
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
        for (let i = 0; i < Math.round(seconds / dt); i++) {
          this.stepEmoteKeys();
          this.stepEmoteEnd();
          this.player.update(dt, this.input, this.cam, this.world);
          this.scorch(dt);
          this.stepCombat(dt);
          this.stepVehicles(dt, true);
          if (!this.player.noclip && !this.player.mounted) this.world.turrets.update(dt, this.player, this.world.bolts);
          // Where the player stands first, then one step of everything alive: without the first,
          // the brains would all chase where the player was when the helper was called.
          this.world.setPlayerTarget(this.player.worldPos, !this.player.noclip && this.player.hp > 0, (dmg) => this.player.takeDamage(dmg));
          this.world.stepLiving(dt, this.player.worldPos, this.cam.camera);
          this.physics.step(dt);
          this.effects.update(dt);
          this.updateCamera(null);
          this.input.endFrame();
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
      /** Nudge the ridden vehicle's seat by metres in its own frame (right, up, forward) and report where it now is, with the pose playing and its root offset, for finding a seat by eye. */
      seat: (dx = 0, dy = 0, dz = 0) => {
        const v = this.player.mounted;
        if (!v) return 'not riding anything';
        v.seat.position.x += dx;
        v.seat.position.y += dy;
        v.seat.position.z += dz;
        const clip = this.player.rig?.currentClip ?? null;
        const root = clip ? this.player.rig?.rootOffset(clip, tmp) : null;
        return { vehicle: v.spec.id, seat: v.seat.position.toArray().map((n) => Number(n.toFixed(2))), seatIsPelvis: v.seatPelvis, riderPose: v.riderPose, clip, clipRoot: root ? root.toArray().map((n) => Number(n.toFixed(2))) : null };
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
        if (v?.cockpitFrame) v.cockpitFrame.position.add(new THREE.Vector3(dx, dy, dz));
        return `frame nudge ${FRAME_NUDGE.toArray().map((n) => n.toFixed(2)).join(', ')} (right, up, forward)`;
      },
      /** Shadow casting by every mesh of the ship you are aboard (or the nearest ship): off, to see whether its own geometry is what keeps the sun out of the rooms. */
      shipShadows: (on = true) => {
        const p = this.player;
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
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
        const v = p.aboard?.vehicle ?? this.world.vehicles.filter((x) => x.spec.ship).sort((a, b) => a.pos.distanceTo(p.worldPos) - b.pos.distanceTo(p.worldPos))[0];
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
        this.garage ??= await Garage.load(import.meta.env.BASE_URL);
        this.world.garage = this.garage;
        const def = this.garage.find(name);
        return def ? this.spawnVehicle(def, kind) : `no vehicle matches ${name}`;
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
        collectBlades(list, this.player.saberBlades, this.world.npcs.npcs, eye);
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
    this.net.onJoin = (peer) => this.remotes.add(peer.id, peer.hello);
    this.net.onHello = (peer) => this.remotes.hello(peer.id, peer.hello);
    this.net.onLeave = (id) => this.remotes.remove(id);
    this.net.onState = (id, state) => this.remotes.state(id, state);
    this.net.onEmote = (id, clip) => this.remotes.emote(id, clip);
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
    this.savePlace(true);
    this.menu.hide();
    this.closePanels();
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
      case 'sensitivity':
        this.cam.sensitivity = S.sensitivity;
        break;
      case 'invertY':
        this.cam.invertY = S.invertY;
        break;
      default:
        // Anything in the effects registry: the chain takes them all in one go on the next
        // microtask, so resetting the graphics is one reconcile rather than two dozen.
        if (isFxSettingKey(key)) this.queueEffects();
        break;
    }
  }

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
    return { name: c?.name ?? 'someone', species: this.characterId, class: this.kit?.id ?? 'jedi', planet: this.world.planet?.id ?? '', zone: this.zone, look: c ? packLook(c.appearance, c.outfit ?? []) : undefined };
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
    const v = p.mounted ?? p.piloting ?? p.aboard?.vehicle ?? null;
    const veh: PeerVehicle | undefined = v ? { id: v.def?.id ?? v.spec.id, p: [n2(v.pos.x), n2(v.pos.y), n2(v.pos.z)], q: v.quaternion(tmpQ).toArray().map(n3) as [number, number, number, number], role: p.mounted ? 'ride' : p.piloting ? 'pilot' : 'aboard', pose: v.riderPose ?? undefined } : undefined;
    const q = p.aboard || p.eva ? (p.group.quaternion.toArray().map(n3) as [number, number, number, number]) : undefined;
    this.net.sendState({ p: [n2(at.x), n2(at.y), n2(at.z)], h: n3(p.heading), s: p.mounted ? 'seated' : (rig?.describe().state ?? 'idle'), v: n2(Math.hypot(p.vel.x, p.vel.z)), m: !!p.mounted, sab: p.saberOn, q, veh });
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
  }

  private async finishCreation(name: string, cls: ClassId, planet: string): Promise<void> {
    const c = this.player.rig?.character;
    const record: SavedCharacter = {
      id: newCharacterId(),
      name,
      species: this.characterId,
      class: cls,
      appearance: c ? this.appearanceOf(c) : { morphs: {}, values: {}, height: 0.5 },
      outfit: c ? this.outfitOf(c) : [],
      planet,
      created: Date.now(),
      played: 0,
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
    this.traveling = true;
    this.input.captured = false;
    const planet = PLANETS.find((p) => p.id === c.planet) ?? PLANETS[0];
    this.loadingScreen.show(planet, planet.name, `${c.name} is on the way`);
    const character = await this.useSpecies(c.species);
    if (character) {
      this.applyAppearance(character, c.appearance);
      await this.dress(character, c.outfit ?? []);
    }
    // The character's Force powers and gadgets in the slots (the defaults for a character from before there was a choice).
    this.jediKit().setLoadout(c.powers?.length ? c.powers.map((p) => p || null) : [...DEFAULT_LOADOUT]);
    this.hunterKit().setLoadout(c.gadgets?.length ? c.gadgets.map((p) => p || null) : [...DEFAULT_GADGETS]);
    this.forceUi.loadout = [...this.jediKit().loadout];
    this.setClass(c.class);
    const bladeColor = c.saber?.color ?? DEFAULT_SABER_COLOR;
    this.player.setSaberColor(bladeColor);
    this.weaponsUi.saberColor = bladeColor;
    this.loadingScreen.setProgress(0.04);
    this.arrive(planet, c.zone, c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    if (c.heading !== undefined) {
      this.player.heading = c.heading;
      this.cam.yaw = c.heading + Math.PI;
    }
    // Space is never stood in: a character who was last there comes back flying a ship.
    if (planet.space) await this.arriveInSpace();
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
    while (performance.now() - t0 < timeoutMs) {
      if (this.world.settled(this.player.pos)) break;
      const { total, stage } = this.world.progress(this.player.pos);
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
   * space zone is always arrived at in a ship (the one last flown, else an X-wing).
   */
  private async travel(planet: PlanetDef, zoneId?: string, ship?: ShipCrossing): Promise<void> {
    if (this.traveling) return;
    this.traveling = true;
    this.map.hide();
    this.closePanels();
    this.input.captured = false;
    const zone = planet.zones?.find((z) => z.id === zoneId);
    console.info(`travel: to ${planet.name}${zone ? ` (${zone.name})` : ''}${ship ? ` flying the ${ship.def.id}${ship.crew ? ` from its rooms${ship.crew.piloting ? ' at the controls' : ''}` : ''}` : ''}`);
    this.loadingScreen.show(planet, zone ? `${planet.name}: ${zone.name}` : planet.name, 'travelling');
    await new Promise((r) => setTimeout(r, 400));
    const p = this.player;
    // Off the ship before the world it stands in goes: its room's physics world goes with it.
    if (p.aboard) {
      p.aboard.reveal(false);
      p.leave();
    }
    if (p.mounted) p.dismount(p.pos.clone());
    this.arrive(planet, zoneId);
    if (ship) await this.arriveInShip(ship.def, ship.speed, ship.height, ship.crew);
    else if (planet.space) await this.arriveInSpace();
    await this.settle();
    this.savePlace(true);
    await this.loadingScreen.hide();
    this.traveling = false;
    this.input.requestLock();
  }

  /** Arrive in space without a ship carried up: seated in the one last flown, else the default, moving off gently. */
  private async arriveInSpace(): Promise<void> {
    const def = this.lastShipDef ?? (await this.defaultShipDef());
    if (def) await this.arriveInShip(def, 40, 0);
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
   * they were there, else at its pilot's spot; a fighter is sat in.
   */
  private async arriveInShip(def: VehicleDef, speed: number, height: number, crew: ShipCrew | null = null): Promise<void> {
    const p = this.player;
    const at = this.spawn.clone();
    at.y += height;
    const v = await this.world.spawnVehicle(def, at, Math.PI, def.kind, true);
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

  /** The ship menu's way up: the flown ship, high enough over a planet with an orbit, goes into it with everyone aboard. */
  private async goToSpace(): Promise<void> {
    const ship = this.pilotedShip();
    const zone = spaceZoneOf(this.world.planet);
    if (!ship || !zone || this.traveling || this.spaceGate !== 'up') return;
    this.closePanels();
    await this.travel(zone, undefined, { def: ship.def!, speed: Math.max(60, ship.speed), height: 0, crew: this.crewRecord() });
  }

  /** The ship menu's way down: the flown ship leaves orbit for the planet below, with everyone aboard. */
  private async landShip(): Promise<void> {
    const ship = this.pilotedShip();
    const below = this.world.planet.space;
    if (!ship || !below || this.traveling) return;
    this.closePanels();
    await this.travel(planetById(below), undefined, { def: ship.def!, speed: 90, height: SPACE_ARRIVAL_HEIGHT, crew: this.crewRecord() });
  }

  /** The ship menu's way off: whoever is in a ship in space goes down to the planet on foot, the ship left behind. */
  private async eject(): Promise<void> {
    const p = this.player;
    const below = this.world.planet.space;
    if (!below || this.traveling || !(p.mounted || p.aboard)) return;
    this.closePanels();
    await this.travel(planetById(below));
  }

  /** Jump to a place on the map: travel first when it is on another planet. */
  private async teleport(planet: PlanetDef, poi: Poi, zoneId?: string): Promise<void> {
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

  /** The camera after everything has moved: chasing a ship in flight in its own frame, else orbiting the player. */
  private updateCamera(blocked: import('./core/camera').CameraBlocker | null, dt = 1 / 60): void {
    const { player, input } = this;
    const flown = player.mounted ?? player.piloting;
    const ship = flown?.spec.ship && flown.airborne && !input.held('freeLook') ? flown : null;
    if (flown?.spec.ship && flown.airborne && input.held('freeLook')) {
      // Alt in flight: looking around from the pilot's own head, in the ship's frame, and the
      // wheel zooms out from there, in steps sized to the ship.
      this.cam.release();
      this.cam.setFrame(flown.group.quaternion);
      const eye = player.piloting ? this.eyes() : flown.cockpitEye(tmp) ? flown.group.localToWorld(tmp.clone()) : null;
      const head = eye ?? flown.pos;
      // The orbit's centre is the standing eye height under the head, the way the figure's camera is placed.
      const under = head.clone().addScaledVector(tmp2.set(0, 1, 0).applyQuaternion(flown.group.quaternion), -1.5);
      this.cam.update(input, under, null, dt, eye ? head.clone() : null, Math.max(1, (6 + flown.radius * 2.2) / 6));
      flown.group.visible = true;
      return;
    }
    if (ship) {
      this.cam.chase(input, dt, ship.pos, ship.attitude, ship.heading, 6 + ship.radius * 2.2, ship.cockpitEye(tmp));
      // In the cockpit the hull would fill the view: it is hidden until the camera comes back out,
      // unless the ship has a cockpit frame, when the view is from inside it and the hull stays.
      ship.group.visible = !this.cam.firstPerson || !!ship.cockpitFrame;
    } else {
      this.cam.release();
      if (player.mounted?.spec.ship) player.mounted.group.visible = true;
      // Aboard a ship the view is upright in the hull's frame, as the body is; adrift in space, in the body's own.
      this.cam.setFrame(player.aboard ? player.aboard.vehicle.group.quaternion : player.eva ? player.evaFrame : null);
      this.cam.update(input, player.worldPos, blocked, dt, this.eyes(), 1, player.eyeHeight);
    }
  }

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
    // A hull removed with someone still in its rooms (the garage's clear, the console): out into the world first.
    if (player.aboard && !this.world.vehicles.includes(player.aboard.vehicle)) this.thrownOutOfShip(player.aboard.vehicle);
    let drive: DriveInput | null = null;
    const pilot = player.mounted ?? player.piloting;
    if (simulate && pilot) {
      // The mouse steers: the vehicle turns toward where the camera looks, and a flyer climbs or
      // sinks as the view tilts up or down past a dead band around level. Alt frees the camera
      // to look around without steering.
      const free = input.held('freeLook');
      const tilt = -(this.cam.pitch - CAMERA_REST_PITCH);
      const vertical = free ? 0 : Math.sign(tilt) * THREE.MathUtils.clamp((Math.abs(tilt) - 0.12) / 0.45, 0, 1);
      // A ship in flight takes the mouse itself (the camera chases it); Alt hands it back to the orbit.
      const shipFlying = !!pilot.spec.ship && pilot.airborne && !free && input.locked;
      const lookDX = shipFlying ? input.mouseDX : 0;
      const lookDY = shipFlying ? input.mouseDY : 0;
      if (shipFlying) {
        input.mouseDX = 0;
        input.mouseDY = 0;
      }
      // A ship not yet in flight hovers as a VTOL: the view's tilt does not lift it, Space and X
      // do, and A and D slide it sideways rather than turning it; in flight the keys roll it.
      const hovering = !!pilot.spec.ship && !pilot.airborne;
      const keys = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
      drive = {
        throttle: (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0),
        steer: hovering ? 0 : keys,
        strafe: hovering ? keys : 0,
        heading: free ? null : this.cam.yaw + Math.PI,
        boost: input.held('walk'),
        hop: input.pressedAction('jump'),
        up: input.held('jump'),
        down: input.held('crouch'),
        vertical: pilot.spec.ship ? 0 : vertical,
        lookDX,
        lookDY,
      };
    }
    // A ship's target and guns: the guns lead the target when it sits within their cone, else
    // fire along the nose; the bolts are the game's own and strike what a blaster's would, ships included.
    if (simulate && pilot?.spec.ship) this.aimShip(pilot, dt);
    else this.shipLeadValid = false;
    const terrain = this.world.terrain;
    for (const v of this.world.vehicles) {
      if (!v.drift) v.update(dt, this.physics, v === pilot ? drive : null, (x, z) => terrain.heightAt(x, z), (x, z) => terrain.waterHeightAt(x, z));
      else {
        const t = v.body.translation();
        v.pos.set(t.x, t.y, t.z);
        v.group.position.copy(v.pos);
        v.quaternion(v.group.quaternion);
      }
      v.interior?.physics.step(dt);
    }
    if (player.aboard) {
      // Fallen out of the room (through a door in flight): back into the world with the hull's motion.
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
        // Bolts in the hull: a jolt to whoever is at the controls, a little of it as hurt.
        if (v === player.mounted || v === player.piloting) {
          player.takeDamage(Math.round(Math.min(12, v.struck * 0.2)));
          this.hud.hurt();
        }
        v.struck = 0;
      }
      const condition = v.hp / v.maxHp;
      if (condition < 0.67 && condition > 0 && Math.random() < dt * (condition < 0.34 ? 9 : 3)) {
        tmp.copy(v.pos).y += (v.spec.bounds.max[1] - v.spec.bounds.min[1]) * 0.4;
        tmp.x += (Math.random() - 0.5) * v.radius;
        tmp.z += (Math.random() - 0.5) * v.radius;
        this.effects.burst(tmp, condition < 0.34 ? 0x303030 : 0x505050, 0.5 + Math.random() * 0.5, 0.9);
        if (condition < 0.34 && Math.random() < 0.3) this.effects.tracer(tmp, tmp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5)), 0xffd080, 0.12);
      }
      if (v.destroyed) {
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
        v.dispose(this.physics, this.scene);
        this.world.vehicles.splice(this.world.vehicles.indexOf(v), 1);
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
    if (this.shipTarget && (this.shipTarget.destroyed || this.shipTarget === pilot || !this.world.vehicles.includes(this.shipTarget))) this.shipTarget = null;
    const nose = tmp.set(0, 0, 1).applyQuaternion(pilot.group.quaternion);
    const ahead: { v: Vehicle; off: number }[] = [];
    for (const v of this.world.vehicles) {
      if (v === pilot || !v.spec.ship || v.destroyed) continue;
      tmp2.copy(v.pos).sub(pilot.pos);
      const d = tmp2.length();
      if (d > SHIP_TARGET_RANGE || d < 1) continue;
      const off = Math.acos(THREE.MathUtils.clamp(tmp2.dot(nose) / d, -1, 1));
      if (off < SHIP_TARGET_CONE) ahead.push({ v, off });
    }
    ahead.sort((a, b) => a.off - b.off);
    if (input.pressedAction('target') && ahead.length) {
      const i = this.shipTarget ? ahead.findIndex((a) => a.v === this.shipTarget) : -1;
      this.shipTarget = ahead[(i + 1) % ahead.length].v;
    } else if (!this.shipTarget && ahead.length) this.shipTarget = ahead[0].v;
    const speed = pilot.weapon?.speed ?? SHIP_BOLT_SPEED;
    const range = pilot.weapon?.range ?? SHIP_BOLT_RANGE;
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
    if (!pilot.guns.length) return;
    pilot.gunCooldown = Math.max(0, pilot.gunCooldown - dt);
    if (!(input.held('attack') && input.locked && pilot.gunCooldown <= 0)) return;
    const g = pilot.guns[pilot.gunNext % pilot.guns.length];
    pilot.gunNext++;
    pilot.gunCooldown = SHIP_GUN_INTERVAL / Math.max(1, Math.min(4, pilot.guns.length / 2));
    pilot.group.updateMatrixWorld(true);
    const from = pilot.group.localToWorld(g.pos.clone());
    const dir = g.dir.clone().applyQuaternion(pilot.group.quaternion).normalize();
    // Led onto the target when it sits within the guns' cone: the lead is what the ship's frame
    // sees, so the bolt's own velocity (the muzzle's plus the ship's) meets the target there.
    if (this.shipLeadValid && Math.acos(THREE.MathUtils.clamp(this.shipAim.dot(nose), -1, 1)) < SHIP_GUN_CONE) dir.copy(this.shipAim);
    from.addScaledVector(dir, 1.2);
    const projectile = pilot.weapon ? this.world.garage?.projectileFor(pilot.weapon.projectile) ?? null : null;
    this.world.bolts.fire(from, dir, { owner: 'player', damage: SHIP_GUN_DAMAGE, metresPerSecond: speed, inherit: new THREE.Vector3(own.x, own.y, own.z), life: range / speed + 0.05, color: pilot.boltColor, exclude: pilot.body, projectile });
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
    return { x: at.x, y: at.y, onScreen: at.on, leadX: lead.x, leadY: lead.y, leadOnScreen: lead.on, label: `${t.spec.label} · ${range} m · hull ${Math.round((t.hp / t.maxHp) * 100)}%` };
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

  private drawFrame(): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    const eye = this.player.pos.clone().setY(this.player.pos.y + 1.5);
    const view = this.portals.cameraBuilding(this.world.cellState, eye, cam.position, this.world.buildings);
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
      // The lit blades as drawn this frame (drawBlades and the fighters' step have run), and how
      // bright a surface near them can be from every other light; aboard, floors are the hull's.
      const blades = this.fxBlades;
      collectBlades(blades, this.player.saberBlades, this.world.npcs.npcs, cam.position);
      const lit = this.litSources;
      lit.torch = this.torchOn ? this.torch : null;
      lit.eye.copy(cam.position);
      blades.litCeiling = litCeiling(blades, lit);
      const hull = this.player.aboard?.vehicle.group;
      if (hull) blades.up.set(0, 1, 0).transformDirection(hull.matrixWorld);
      else blades.up.set(0, 1, 0);
      postfx.end(f);
    }
    this.frameCalls = info.calls;
    this.frameTriangles = info.triangles;
    this.renderer.info.autoReset = auto;
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
    installEffects(fx, { water: this.world.waterBodies, heat: this.heat });
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
    return this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open || this.vehiclesUi.open || this.npcUi.open || this.shipMenu.open || this.liftMenu.open || this.menu.open;
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
    if (this.wardrobe.open) this.wardrobe.hide();
    if (this.appearanceUi.open) this.appearanceUi.hide();
    if (this.weaponsUi.open) this.weaponsUi.hide();
    if (this.forceUi.open) this.forceUi.hide();
    if (this.vehiclesUi.open) this.vehiclesUi.hide();
    if (this.npcUi.open) this.npcUi.hide();
    if (this.shipMenu.open) this.shipMenu.hide();
    if (this.liftMenu.open) this.liftMenu.hide();
  }

  /** P: the ship menu, for whoever is in a ship (at its controls, riding it, or aboard as a passenger). */
  private toggleShipMenu(): void {
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
    return {
      ship: ship.spec.label,
      role: ship === p.mounted || ship === p.piloting ? 'pilot' : 'passenger',
      inSpace,
      flying: ship.airborne,
      altitude: inSpace ? null : ship.pos.y - this.world.terrain.heightAt(ship.pos.x, ship.pos.z),
      gateHeight: SPACE_GATE_HEIGHT,
      spaceName: spaceZoneOf(this.world.planet)?.name ?? null,
      planetName: inSpace ? planetById(this.world.planet.space!).name : null,
      speed: Math.round(Math.abs(ship.speed) * 3.6),
    };
  }

  private freeMouse(free: boolean): void {
    this.input.captured = free;
    if (free) this.input.releaseLock();
    else this.input.requestLock();
  }

  /** B: the spawner, the garage or the NPCs tab; the key toggles the last tab used, a tab click swaps. */
  private toggleSpawner(tab?: 'garage' | 'npcs'): void {
    const want = tab ?? this.spawnerTab;
    const wasOpen = tab === undefined && (this.vehiclesUi.open || this.npcUi.open);
    this.closePanels();
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.spawnerTab = want;
    if (want === 'garage') {
      this.vehiclesUi.show();
      if (!this.garage) {
        void Garage.load(import.meta.env.BASE_URL).then((g) => {
          this.garage = g;
          this.world.garage = g;
          this.vehiclesUi.attach(g);
        });
      } else this.vehiclesUi.attach(this.garage);
    } else {
      this.npcUi.attach(this.npcKinds());
      this.npcUi.show();
    }
    this.freeMouse(true);
  }

  /** What the NPC tab can stand in front of the player: a blaster turret, and the planet's creature. */
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
      {
        id: 'creature',
        label: this.world.planet.creatures.name,
        blurb: `${this.world.planet.creatures.aggressive ? 'attacks on sight' : 'wanders, fights back when hit'}; ${this.world.planet.creatures.hp} health`,
        count: () => this.world.creatures.creatures.length,
        spawn: () => {
          const p = ahead(12);
          this.world.creatures.spawnAt(p.x, p.z);
          return `a ${this.world.planet.creatures.name} 12 m ahead (${this.world.creatures.creatures.length} out)`;
        },
        clear: () => this.world.creatures.removeAll(),
      },
      {
        id: 'fighter',
        label: 'Fighter',
        blurb: 'a humanoid of a random species with a random look and a lightsaber, sword or gun off the rack; fights you and the other fighters; 160 health',
        count: () => this.world.npcs.npcs.filter((n) => !n.dead).length,
        spawn: () => {
          const p = ahead(8 + Math.random() * 4);
          const n = this.world.npcs.spawnAt(p.x + (Math.random() - 0.5) * 4, p.z + (Math.random() - 0.5) * 4);
          return `a ${n.name} ahead (${this.world.npcs.npcs.length} out)`;
        },
        clear: () => this.world.npcs.removeAll(),
      },
    ];
  }

  /** Spawn a vehicle from the garage in front of the player, as its own kind or one chosen for the test. */
  async spawnVehicle(def: VehicleDef, kind?: VehicleKind): Promise<string> {
    const v = await this.world.spawnVehicle(def, this.player.pos, this.player.heading, kind);
    const b = v.spec.bounds;
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((n) => n.toFixed(1)).join('×');
    this.hud.setPrompt(`${def.label}: a ${v.spec.kind}, ${size} m (E to ride)`);
    return `${def.id} spawned as a ${v.spec.kind}: ${size} m at ${v.pos.toArray().map((n) => n.toFixed(1)).join(',')}, ${v.pos.distanceTo(this.player.pos).toFixed(1)} m away, seat ${v.spec.seat.map((n) => n.toFixed(2)).join(',')}, hardpoints: ${v.hardpoints.join(' ') || 'none'}`;
  }

  /** Put a weapon from the rack in a hand (null empties it), switching to the kit that fights with it. */
  async equip(def: WeaponDef | null, hand: 'right' | 'left'): Promise<string> {
    if (!def) {
      this.player.unequip(hand);
      this.weaponsUi.held[hand] = null;
      return `${hand} hand empty`;
    }
    if (!this.weapons) return 'no weapons converted';
    const model = await this.weapons.model(def);
    const wants = this.player.equip(def, model, hand);
    this.weaponsUi.held = { right: this.player.equipped.right?.id ?? null, left: this.player.equipped.left?.id ?? null };
    if (wants !== this.kit.id) this.setClass(wants);
    this.hud.setPrompt(`${def.id} in the ${hand} hand (${def.class}, ${this.player.saber.style})`);
    return `${def.id} in the ${hand} hand`;
  }

  /** I: the inventory, the wardrobe or the weapons tab; the key toggles the last tab used, a tab click swaps. */
  private toggleInventory(tab?: InventoryTab): void {
    if (this.creating) {
      if (tab === 'appearance' || tab === 'wardrobe') this.showCreatorTab(tab);
      return;
    }
    const want = tab ?? this.inventoryTab;
    const wasOpen = tab === undefined && (this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.forceUi.open);
    this.closePanels();
    if (wasOpen) {
      this.freeMouse(false);
      return;
    }
    this.inventoryTab = want;
    const character = this.player.rig?.character ?? null;
    if (want === 'wardrobe') {
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
    }
  }

  /** Off the vehicle onto the floor beside it (in space, adrift beside it with its motion). */
  private dismountBeside(sp: Vehicle): void {
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
      return;
    }
    const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 12, sp.body);
    tmp.y = hit !== null ? from - hit + 0.15 : Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
    p.dismount(tmp);
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
    room.toWorld(p.pos, tmp);
    p.leave();
    // A flame held in the room lived in the hull's frame: it stops, and a trigger still held places it again outside.
    (this.kits.bounty_hunter as BountyHunterKit | undefined)?.coolDown();
    room.reveal(false);
    if (!fell) {
      v.quaternion(tmpQ);
      tmp.set(-(v.spec.bounds.max[0] - v.spec.bounds.min[0]) / 2 - 1.2, 0, 0).applyQuaternion(tmpQ).add(v.pos);
      const from = v.pos.y + 0.5;
      const hit = this.physics.groundDistance(tmp.x, from, tmp.z, 20, v.body);
      tmp.y = hit !== null ? from - hit + 0.15 : this.world.terrain.heightAt(tmp.x, tmp.z) + 0.3;
    }
    p.stand(tmp);
    if (fell) {
      const lv = v.body.linvel();
      p.vel.set(lv.x, lv.y, lv.z);
      p.grounded = false;
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
        input.endFrame();
        return;
      }
      const active = this.started && !this.traveling && !this.dying && !this.menu.open;
      if (active) this.savePlace();
      // The lift menu takes the number keys while it is up, before the kit's slots see them.
      if (this.liftMenu.open) for (let n = 1; n <= 9; n++) if (input.consumeKey(`Digit${n}`)) this.liftMenu.pickKey(n);

      if (active) {
        if (input.pressedAction('map')) this.toggleMap();
        if (input.pressedAction('inventory')) this.toggleInventory();
        if (input.pressedAction('spawner')) this.toggleSpawner();
        if (input.pressedAction('ship')) this.toggleShipMenu();
        if (input.pressedAction('help')) this.hud.toggleHelp();
        if (!this.map.open && !this.anyPanelOpen()) {
          if (input.pressedAction('saberToggle') && this.kit.id === 'jedi' && !player.mounted) player.toggleSaber();
          if (input.pressedAction('switchClass')) this.setClass(this.kit.id === 'jedi' ? 'bounty_hunter' : 'jedi');
          if (input.pressedAction('mount') && !player.noclip && !this.handleElevator()) this.handleMount();
          if (input.pressedAction('noclip') && !player.mounted) player.toggleNoclip();
          if (player.noclip && input.pressedAction('noclipFaster')) player.noclipSpeed = Math.min(2000, player.noclipSpeed * 1.5);
          if (player.noclip && input.pressedAction('noclipSlower')) player.noclipSpeed = Math.max(2, player.noclipSpeed / 1.5);
          if (input.pressedAction('flashlight')) this.torchOn = !this.torchOn;
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
      this.world.setPlayerTarget(player.worldPos, simulate && !player.noclip && !player.aboard && !this.dying && player.hp > 0, hurt);
      this.world.update(dt, player.worldPos, this.cam.camera.position, fast, hurt, simulate && !player.mounted && !player.noclip && !player.aboard ? player : null);
      // The pool serves the latest request first when it is full (flashes age only in effects.update),
      // so the room lights go last and always keep their lights; the fighters' glows just before them,
      // farthest first, so the nearest win; this frame's shots, powers and muzzle flashes came earlier
      // and give way. Here the hull is where stepVehicles left it and the fighters where they moved to.
      if (simulate) {
        if (!this.bladeGlowOwnsLight()) {
          const glows = this.world.npcs.lightSpots(npcGlow, this.cam.camera.position, FIGHTER_GLOW_RANGE);
          for (let i = glows - 1; i >= 0; i--) this.effects.flash(npcGlow[i].pos, npcGlow[i].color, 2, 5, 0.08);
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
      this.torch.intensity = this.torchOn ? 260 : 0;
      if (this.torchOn) {
        this.torch.position.copy(this.cam.camera.position);
        this.cam.camera.getWorldDirection(torchDir);
        this.torch.target.position.copy(this.cam.camera.position).addScaledVector(torchDir, 12);
      }
      // First person from a parts character keeps the body in the picture, headless; a single model hides whole.
      const parts = player.rig?.character;
      if (parts) {
        player.group.visible = true;
        parts.setHeadHidden(this.cam.firstPerson);
      } else player.group.visible = !this.cam.firstPerson;
      this.world.updateShadows(performance.now());

      // The ship menu is where space is gone to and come back from; the prompt says when the ship is high enough.
      const shipKey = keyName(input.bindings.ship[0] ?? '');
      const shipHint = this.spaceGate === 'up' ? ` · <b>at altitude for space: ${shipKey}</b> ship menu` : this.world.planet.space ? ` · <b>${shipKey}</b> ship menu` : '';
      let prompt = '';
      let lift: ReturnType<App['liftHere']> = null;
      let doorless: { label: string } | null = null;
      if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl</b> down · <b>Shift</b> fast · <b>+</b>/<b>-</b> speed · <b>N</b> off`;
      else if (player.mounted) prompt = mountPrompt(player.mounted) + (player.mounted.spec.ship ? shipHint : '');
      else if ((lift = this.liftHere())) prompt = `<b>E</b> lift: ${lift.stops.length} levels`;
      else if (!player.aboard && this.world.elevatorsNear(player.pos, MOUNT_RANGE).length) prompt = `<b>E</b> elevator ${this.world.elevatorsNear(player.pos, MOUNT_RANGE)[0].kind === 'down' ? 'down' : 'up'}`;
      else if (!player.aboard && (doorless = this.world.doorlessNear(player.pos))) prompt = `<b>E</b> enter ${doorless.label} (no way in on foot)`;
      else if (player.piloting) prompt = `at the controls of the ${player.piloting.spec.label} · <b>W</b>/<b>S</b> throttle · mouse steers · <b>Alt</b> looks around · <b>E</b> lets go · ${Math.round(Math.abs(player.piloting.speed) * 3.6)} km/h${shipHint}`;
      else if (player.aboard) prompt = (player.aboard.pilotSpot && player.pos.distanceTo(player.aboard.pilotSpot) < CONTROLS_RANGE ? `<b>E</b> take the controls` : `aboard ${player.aboard.vehicle.spec.label} · <b>E</b> step out`) + (this.world.planet.space ? ` · <b>${shipKey}</b> ship menu` : '');
      else if (player.eva) prompt = `adrift · <b>W/S</b> thrust ahead and back · <b>A/D</b> sideways · <b>Space/Ctrl</b> up and down · mouse turns · <b>Z/V</b> roll · <b>${keyName(input.bindings.brake[0] ?? '')}</b> brake · ${Math.round(player.vel.length() * 3.6)} km/h${this.nearestSpeederDistance() < MOUNT_RANGE ? (this.nearestHasRoom() ? ' · <b>E</b> board' : ' · <b>E</b> mount') : ''}`;
      else if (this.nearestSpeederDistance() < MOUNT_RANGE) prompt = this.nearestHasRoom() ? '<b>E</b> board' : this.nearestVehicle()?.upsideDown ? '<b>E</b> flip it upright' : '<b>E</b> mount';
      this.hud.setPrompt(prompt);
      const flying = player.mounted?.spec.ship && player.mounted.airborne && !input.held('freeLook') ? player.mounted : null;
      this.hud.setFlight(flying ? flying.stick : null);
      const aimed = player.mounted ?? player.piloting;
      this.hud.setTarget(aimed?.spec.ship && aimed.airborne && !input.held('freeLook') ? this.targetHud(aimed) : null);
      const at = player.worldPos;
      this.hud.update(dt, at.x, at.y, at.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.world.planet.creatures.name, player.saberOn);

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
      if (programs > this.lastPrograms && this.lastPrograms > 0 && !this.traveling && !this.fxBusy) console.info(`shaders: ${programs - this.lastPrograms} compiled during play (${stats.frameMs.toFixed(0)} ms frame, ${programs} programs in all)`);
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
