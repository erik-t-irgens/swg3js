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
import { Player } from './player/player';
import { loadPlayerRig } from './player/rig';
import { Character, loadSpeciesIndex, type SpeciesEntry } from './player/character';
import { GalaxyMap, type Poi } from './ui/galaxyMap';
import { MapUi } from './ui/mapUi';
import { WardrobeUi } from './ui/wardrobeUi';
import { WeaponsUi } from './ui/weaponsUi';
import { WeaponCatalogue, type WeaponDef } from './player/weapons';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Hud } from './ui/hud';
import { specFor, type DriveInput } from './vehicles/vehicle';
import { interceptTime, leadPoint } from './combat/intercept';
import { PostFX } from './core/postfx';
import { VehiclesUi } from './ui/vehiclesUi';
import { NpcUi } from './ui/npcUi';
import { AppearanceUi } from './ui/appearanceUi';
import { CharacterSelect } from './ui/characterSelect';
import { CreatorBar } from './ui/creatorBar';
import { Menu, keyName } from './ui/menu';
import { ShipMenu, type ShipStatus } from './ui/shipMenu';
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
type InventoryTab = 'wardrobe' | 'appearance' | 'weapons';
/** The camera pitch a flyer holds its height at: the default view, a little above level. */
const CAMERA_REST_PITCH = 0.32;

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0, triangles: 0, pack: '', terrain: '', chunks: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const roomLightSpots: import('./vehicles/interior').RoomLight[] = [];
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
  private kit!: Kit;
  private readonly hud: Hud;
  private readonly map: MapUi;
  private readonly wardrobe: WardrobeUi;
  private readonly weaponsUi: WeaponsUi;
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
  private readonly select: CharacterSelect;
  private readonly creatorBar: CreatorBar;
  private readonly menu: Menu;
  private readonly shipMenu: ShipMenu;
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
  /** The picture's effects (bloom, the speed blur), when the settings ask for them. */
  private postfx: PostFX | null = null;
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
    if (lowfx) Object.assign(this.settings, { renderScale: 0.5, shadows: false });
    const S = this.settings;
    this.renderer.setPixelRatio(S.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = S.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    World.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.toneMappingExposure = S.exposure;
    this.setPostFX();

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.cam.sensitivity = S.sensitivity;
    this.cam.invertY = S.invertY;
    this.cam.baseFov = S.fov;
    this.cam.camera.fov = S.fov;
    this.cam.camera.updateProjectionMatrix();
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, physics);
    this.world.renderer = this.renderer;
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
    this.hud = new Hud(this.ui);
    this.wardrobe = new WardrobeUi(this.ui, () => this.hud.setPrompt(''));
    this.wardrobe.setBaseUrl(import.meta.env.BASE_URL);
    this.weaponsUi = new WeaponsUi(this.ui, (def, hand) => void this.equip(def, hand));
    this.vehiclesUi = new VehiclesUi(this.ui, (def, kind) => void this.spawnVehicle(def, kind), () => this.world.removeVehicles(this.player.mounted ?? this.player.aboard?.vehicle ?? null));
    this.shipMenu = new ShipMenu(this.ui, { status: () => this.shipStatus(), goToSpace: () => void this.goToSpace(), land: () => void this.landShip(), eject: () => void this.eject() }, () => keyName(this.input.bindings.ship[0] ?? ''));
    this.shipMenu.onClose = () => this.toggleShipMenu();
    this.npcUi = new NpcUi(this.ui);
    this.appearanceUi = new AppearanceUi(this.ui, () => this.saveAppearance());
    this.appearanceUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    // The tabs: a click on the other tab of a panel swaps to it, the key toggles whichever was last open.
    this.wardrobe.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.weaponsUi.onTab = (id) => this.toggleInventory(id as InventoryTab);
    this.vehiclesUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    this.npcUi.onTab = (id) => this.toggleSpawner(id as 'garage' | 'npcs');
    void WeaponCatalogue.load(import.meta.env.BASE_URL).then((c) => {
      this.weapons = c;
      this.weaponsUi.attach(c);
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
      teleport: (x: number, z: number, yaw?: number) => {
        this.player.reset(new THREE.Vector3(x, this.world.terrain.heightAt(x, z) + 0.3, z));
        if (yaw !== undefined) this.cam.yaw = yaw;
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
          this.stepCombat(dt);
          this.stepVehicles(dt, true);
          if (!this.player.noclip && !this.player.mounted) this.world.turrets.update(dt, this.player, this.world.bolts);
          this.physics.step(dt);
          this.effects.update(dt);
          this.updateCamera(null);
          this.input.endFrame();
        }
        if (!hold) for (const k of keys) this.input.force(k, false);
      },
      /** With the effects on: scan the frame for pixels that are not numbers (what the bloom smears into a black box) and name the object under the first one. */
      blackBox: () => {
        if (!this.postfx) return 'the effects are off (turn bloom on): the scan reads their frame';
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
      /** Draw `n` frames back to back with the GPU waited on after each, and report the milliseconds one takes; `bench(30, false)` first turns bloom (the effects) off, `bench(30, true)` on. */
      bench: (n = 30, bloom?: boolean) => {
        if (bloom !== undefined && bloom !== this.settings.bloom) {
          this.settings.bloom = bloom;
          this.setPostFX();
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
      /** The blaster in hand, 'pistol' or 'rifle': which of the game's carries play. `gun('carbine', { aim: 30, aimKneel: 30, ready: 30 })` sets how far right, in degrees, that kind's torso turns while aiming standing or moving, aiming kneeling or crouched, and in the hip-fire carry, so the pose's arm points at the crosshair; pistol, carbine, rifle and heavy each have their own. */
      gun: (kind?: 'pistol' | 'carbine' | 'rifle' | 'heavy', tune?: { ready?: number; aim?: number; aimKneel?: number }) => {
        if (kind) {
          this.player.gunClass = kind;
          this.player.gunKind = kind === 'pistol' ? 'pistol' : 'rifle';
        }
        if (tune) {
          const t = this.player.gunTune[(kind as 'pistol' | 'carbine' | 'rifle' | 'heavy' | undefined) ?? this.player.gunClass];
          if (tune.ready !== undefined) t.ready = tune.ready;
          if (tune.aim !== undefined) t.aim = tune.aim;
          if (tune.aimKneel !== undefined) t.aimKneel = tune.aimKneel;
        }
        return { kind: this.player.gunKind, class: this.player.gunClass, tune: this.player.gunTune, aiming: this.player.aiming, ready: this.player.gunReady, sinceShot: Number(this.player.sinceShot.toFixed(1)), clips: this.player.rig?.clipsMatching(/pistol|rifle/) ?? [] };
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
      this.appearanceUi.setSpecies(list, this.characterId);
    });
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
      case 'bloom':
      case 'bloomStrength':
      case 'speedBlur':
      case 'motionBlur':
        this.setPostFX();
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
    this.setClass(c.class);
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
      this.cam.update(input, player.worldPos, blocked, dt, this.eyes());
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

  /** Drive the ridden vehicle from the keys (the mouse or A/D steer, Alt frees the look, W/S throttle, Shift boost, Space hop, the view's tilt or Space and X climb and sink), step every vehicle, and seat the rider. */
  private stepVehicles(dt: number, simulate: boolean): void {
    const { player, input } = this;
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
        }
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
    const ctx: KitContext = { dt, input: this.input, player, world: this.world, cam: this.cam, physics: this.physics, effects: this.effects, bolts: this.world.bolts };
    this.kit.update(ctx);
    this.world.bolts.update(dt, {
      physics: this.physics,
      effects: this.effects,
      hittableAt: (h) => this.world.hittableAt(h),
      player,
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
    this.postfx?.begin();
    this.portals.render(this.scene, cam, view, this.world.buildings);
    this.postfx?.end(cam, this.lastDt);
    this.frameCalls = info.calls;
    this.frameTriangles = info.triangles;
    this.renderer.info.autoReset = auto;
  }

  /** The effects the settings ask for, made or dropped as they change; a change of them recompiles every shader. */
  private setPostFX(): void {
    const S = this.settings;
    if (!S.bloom) {
      this.postfx?.dispose();
      this.postfx = null;
      return;
    }
    if (!this.postfx) this.postfx = new PostFX(this.renderer, { bloom: S.bloom, bloomStrength: S.bloomStrength, motionBlur: S.speedBlur, motionBlurStrength: S.motionBlur });
    else this.postfx.set({ bloom: S.bloom, bloomStrength: S.bloomStrength, motionBlur: S.speedBlur, motionBlurStrength: S.motionBlur });
  }

  private async die(): Promise<void> {
    this.dying = true;
    this.fade.textContent = 'YOU HAVE BECOME ONE WITH THE FORCE';
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 1400));
    this.player.reset(this.spawn);
    this.drawFrame();
    await new Promise((r) => setTimeout(r, 200));
    this.fade.classList.remove('on');
    this.dying = false;
  }

  /** The panels' open state moved to the tabs: closing one panel of a pair and opening the other keeps the mouse free. */
  private anyPanelOpen(): boolean {
    return this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.vehiclesUi.open || this.npcUi.open || this.shipMenu.open || this.menu.open;
  }

  private closePanels(): void {
    if (this.wardrobe.open) this.wardrobe.hide();
    if (this.appearanceUi.open) this.appearanceUi.hide();
    if (this.weaponsUi.open) this.weaponsUi.hide();
    if (this.vehiclesUi.open) this.vehiclesUi.hide();
    if (this.npcUi.open) this.npcUi.hide();
    if (this.shipMenu.open) this.shipMenu.hide();
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
    const wasOpen = tab === undefined && (this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open);
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
    } else {
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

  /** E at an elevator terminal: up for an up terminal, down for a down one, up then down for a plain one. */
  private handleElevator(): boolean {
    const p = this.player;
    const near = this.world.elevatorsNear(p.pos, MOUNT_RANGE);
    if (!near.length) return false;
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
    room.reveal(true);
    this.player.board(room, room.entry.clone());
    this.cam.zoomTarget = Math.min(this.cam.zoomTarget, 4);
    this.hud.setPrompt(`aboard: <b>E</b> steps out · the room has physics of its own · <b>__debug.shipDrift(2, 0.4)</b> sets the hull adrift to test it`);
  }

  /** Out of a ship's room: beside the hull on the floor found there, or, having fallen out, where the hull's frame put the figure, with the hull's motion. */
  private leaveShip(fell: boolean): void {
    const p = this.player;
    const room = p.aboard;
    if (!room) return;
    const v = room.vehicle;
    room.toWorld(p.pos, tmp);
    p.leave();
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
      if (simulate) {
        player.update(dt, input, this.cam, this.world);
        // The thrown and orbiting sabers glow from the pooled flash lights, so no light comes or goes with them.
        for (const spot of player.lightSpots()) this.effects.flash(spot.pos, 0x66c8ff, spot.intensity, spot.distance, 0.08);
        // Aboard, the room's own lights, the nearest few, through the same pool (no new lights, so nothing recompiles).
        if (player.aboard) for (const l of player.aboard.roomLights(player.pos, 3, roomLightSpots)) this.effects.flash(l.pos, l.color, l.intensity, l.distance, 0.08);
        this.stepCombat(dt);
      }

      this.stepVehicles(dt, simulate);
      this.stepNet(dt);

      const fast = simulate && input.held('fastForward');
      for (const m of this.shown) m.update(dt);
      this.world.update(dt, player.worldPos, this.cam.camera.position, fast, (dmg) => {
        if (!simulate || player.mounted || player.noclip || player.aboard) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      }, simulate && !player.mounted && !player.noclip && !player.aboard ? player : null);
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
      if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl</b> down · <b>Shift</b> fast · <b>+</b>/<b>-</b> speed · <b>N</b> off`;
      else if (player.mounted) prompt = mountPrompt(player.mounted) + (player.mounted.spec.ship ? shipHint : '');
      else if (this.world.elevatorsNear(player.pos, MOUNT_RANGE).length) prompt = `<b>E</b> elevator ${this.world.elevatorsNear(player.pos, MOUNT_RANGE)[0].kind === 'down' ? 'down' : 'up'}`;
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
      const tRender = performance.now();
      this.drawFrame();
      stats.renderMs = performance.now() - tRender;
      stats.frameMs = performance.now() - tFrame;
      // A shader compiled on a live frame is a stall: say which frame, and how many, so the cause can be found.
      const programs = this.renderer.info.programs?.length ?? 0;
      if (programs > this.lastPrograms && this.lastPrograms > 0 && !this.traveling) console.info(`shaders: ${programs - this.lastPrograms} compiled during play (${stats.frameMs.toFixed(0)} ms frame, ${programs} programs in all)`);
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
