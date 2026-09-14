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
import { PLANETS, packIdOf, planetById, type PlanetDef } from './data/planets';
import { Player } from './player/player';
import { loadPlayerRig } from './player/rig';
import { Character, loadSpeciesIndex, type SpeciesEntry } from './player/character';
import { GalaxyMap, type Poi } from './ui/galaxyMap';
import { WardrobeUi } from './ui/wardrobeUi';
import { WeaponsUi } from './ui/weaponsUi';
import { WeaponCatalogue, type WeaponDef } from './player/weapons';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Hud } from './ui/hud';
import { specFor, type DriveInput } from './vehicles/vehicle';
import { VehiclesUi } from './ui/vehiclesUi';
import { NpcUi } from './ui/npcUi';
import { AppearanceUi } from './ui/appearanceUi';
import { CharacterSelect } from './ui/characterSelect';
import { CreatorBar } from './ui/creatorBar';
import { deleteCharacter, loadCharacters, newCharacterId, upsertCharacter, type Appearance, type SavedCharacter } from './core/characters';
import { Garage, type VehicleDef } from './vehicles/garage';
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
  if (k === 'ship') return `<b>E</b> leave · <b>W</b>/<b>S</b> throttle up and down · mouse pitches and turns (loops and rolls allowed) · <b>A/D</b> roll · <b>Space</b>/<b>X</b> pitch · <b>wheel</b> zoom, all the way in for the cockpit · <b>Alt</b> look around · <b>Shift</b> burn · ${v.airborne ? 'flying' : 'landed'} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h`;
  const turn = k === 'ground' ? 'mouse or <b>A/D</b> turn' : 'mouse or <b>A/D</b> steer';
  return `<b>E</b> dismount · <b>W/S</b> throttle · ${turn} · <b>Alt</b> look around${boost}${hop}${fly} · ${k} · ${Math.round(Math.abs(v.speed) * 3.6)} km/h`;
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
const boltFrom = new THREE.Vector3();

class App {
  private torch!: THREE.SpotLight;
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
  private readonly map: GalaxyMap;
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
  private spawn = new THREE.Vector3();
  /** Animation mixers of models shown through the debug hook. */
  private readonly shown: THREE.AnimationMixer[] = [];
  private readonly portals: PortalRenderer;

  constructor(private readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: true });
    const lowfx = new URLSearchParams(location.search).get('lowfx') === '1';
    this.renderer.setPixelRatio(lowfx ? 0.5 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    World.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.toneMappingExposure = 1.0;

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, physics);
    this.world.renderer = this.renderer;
    // A hand torch: a spot light carried at the camera, pointing where it looks. F toggles it.
    this.torch = new THREE.SpotLight(0xfff1d6, 260, 70, 0.42, 0.45, 1.6);
    this.torch.visible = false;
    this.scene.add(this.torch, this.torch.target);
    this.portals = new PortalRenderer(this.renderer);
    this.world.attachCamera(this.cam.camera, !lowfx, this.portals);
    this.player = new Player(this.scene, physics);
    this.effects = new Effects(this.scene);
    this.hud = new Hud(this.ui);
    this.wardrobe = new WardrobeUi(this.ui, () => this.hud.setPrompt(''));
    this.wardrobe.setBaseUrl(import.meta.env.BASE_URL);
    this.weaponsUi = new WeaponsUi(this.ui, (def, hand) => void this.equip(def, hand));
    this.vehiclesUi = new VehiclesUi(this.ui, (def, kind) => void this.spawnVehicle(def, kind), () => this.world.removeVehicles(this.player.mounted));
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
    this.map = new GalaxyMap(
      this.ui,
      (p, zone) => void this.travel(p, zone),
      (p, poi, zone) => void this.teleport(p, poi, zone),
    );
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
      /** The normal maps' strength and way up, live: `normals(1, 1)` is the default, `normals(1, -1)` the other way up, `normals(0, 0)` none. */
      normals: (x = 1, y = 1) => {
        const c = this.player.rig?.character;
        if (!c?.customizer) return 'no live recipes on this character';
        return `${c.customizer.setNormalScale(x, y)} materials set to (${x}, ${y})`;
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
      /** Bolts in the air: whose, where, which way, and how many have flown and been blocked. */
      bolts: () => ({ fired: { ...this.world.bolts.fired }, blocked: this.player.blocks, inFlight: this.world.bolts.bolts.map((b) => ({ owner: b.owner, reflected: b.reflected, at: b.pos.toArray().map((v) => Number(v.toFixed(1))), dir: b.dir.toArray().map((v) => Number(v.toFixed(2))) })) }),
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
      vehicleState: () => this.world.vehicles.map((v) => {
        v.quaternion(tmpQ);
        const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ).y;
        const a = v.body.angvel();
        const e = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ');
        const com = v.body.localCom();
        return { id: v.spec.id, kind: v.spec.kind, com: [com.x, com.y, com.z].map((n) => Number(n.toFixed(2))), at: v.pos.toArray().map((n) => Number(n.toFixed(2))), level: Number(upY.toFixed(3)), pitch: Math.round((e.x * 180) / Math.PI), roll: Math.round((e.z * 180) / Math.PI), spin: Number(Math.hypot(a.x, a.y, a.z).toFixed(3)), speed: Number(v.speed.toFixed(2)), corners: v.groundedPoints, ridden: v === this.player.mounted };
      }),
      /** Remove every spawned vehicle except the one being ridden, as the garage's Remove all does. */
      unspawn: () => {
        this.world.removeVehicles(this.player.mounted);
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

    // Releasing the mouse leaves the game running and the world visible, so the wardrobe and the
    // map can be used with a cursor. Clicking the world takes the mouse back; the menu is only
    // for arriving and for dying, not for every Escape.
    document.addEventListener('pointerlockchange', () => {
      if (this.started && !this.traveling) this.hud.setMouseFree(!this.input.locked && !this.map.open && !this.anyPanelOpen());
    });
    this.canvas.addEventListener('click', () => {
      if (this.started && !this.input.locked && !this.map.open && !this.anyPanelOpen() && !this.traveling) this.input.requestLock();
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
    if (!a) return;
    for (const [name, v] of Object.entries(a.morphs ?? {})) c.setMorph(name, v);
    if (a.height !== undefined) c.setHeight(a.height);
    const changed = Object.fromEntries(Object.entries(a.values ?? {}).filter(([k, v]) => c.canCustomize(k) && (c.manifest.values?.[k] ?? c.manifest.values?.[k.replace(/^.*\//, '')]) !== v));
    if (Object.keys(changed).length) c.customizer?.setAll(changed);
  }

  /** Dress the character in a saved outfit: everything else comes off, each piece goes on by the name it was worn under. */
  private async dress(c: Character, outfit: string[]): Promise<void> {
    for (const p of c.status()) if (p.worn && !p.body) c.remove(p.name);
    for (const key of outfit) {
      const on = (await c.wear(key)) || (await c.wearItem(key, import.meta.env.BASE_URL).catch(() => false));
      if (!on) console.warn(`outfit: ${key} is not in the wardrobe any more`);
    }
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
    this.appearanceUi.setSpecies(this.speciesList, this.characterId);
    return rig.character;
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
    this.loading(`ENTERING AS ${c.name}`, 'the character');
    const character = await this.useSpecies(c.species);
    if (character) {
      this.applyAppearance(character, c.appearance);
      await this.dress(character, c.outfit ?? []);
    }
    this.setClass(c.class);
    const planet = PLANETS.find((p) => p.id === c.planet) ?? PLANETS[0];
    this.loading(`LOADING ${planet.name}`, 'the ground and the city');
    this.arrive(planet, c.zone, c.pos ? new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]) : undefined);
    if (c.heading !== undefined) {
      this.player.heading = c.heading;
      this.cam.yaw = c.heading + Math.PI;
    }
    this.inWorld = true;
    this.started = true;
    await this.settle();
    c.played = Date.now();
    upsertCharacter(c);
    this.savePlace(true);
    this.fade.classList.remove('on');
    this.traveling = false;
    this.input.requestLock();
  }

  /** The loading screen's words: what is being waited for. */
  private loading(title: string, what: string): void {
    this.fade.innerHTML = `${title.toUpperCase()}<small>loading ${what}…</small>`;
    this.fade.classList.add('on');
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
      await new Promise((r) => setTimeout(r, 100));
    }
    // A frame with everything in, so the first thing seen is the world and not the fade lifting off a blank.
    this.drawFrame();
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
    c.planet = this.world.planet?.id ?? c.planet;
    c.zone = this.zone;
    c.pos = [Number(p.pos.x.toFixed(2)), Number(p.pos.y.toFixed(2)), Number(p.pos.z.toFixed(2))];
    c.heading = Number(p.heading.toFixed(3));
    c.played = Date.now();
    upsertCharacter(c);
  }

  private setClass(id: ClassId): void {
    this.kit?.dispose();
    this.kit = id === 'jedi' ? new JediKit(this.scene) : new BountyHunterKit(this.scene);
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
    const arrivalSpawn = this.spawn.clone();
    void this.world.loadPack(stand).then((clearSpawn) => {
      const p = this.player;
      if (p.mounted || p.noclip) return;
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

  private async travel(planet: PlanetDef, zoneId?: string): Promise<void> {
    if (this.traveling) return;
    this.traveling = true;
    this.map.hide();
    this.input.captured = false;
    const zone = planet.zones?.find((z) => z.id === zoneId);
    this.loading(`TRAVELING TO ${zone ? `${planet.name}: ${zone.name}` : planet.name}`, 'the ground and the city');
    await new Promise((r) => setTimeout(r, 400));
    this.arrive(planet, zoneId);
    await this.settle();
    this.savePlace(true);
    this.fade.classList.remove('on');
    this.traveling = false;
    this.input.requestLock();
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
    this.loading(poi.name, 'the ground and the buildings');
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
    this.fade.classList.remove('on');
    this.traveling = false;
    this.input.requestLock();
  }

  /** The camera after everything has moved: chasing a ship in flight in its own frame, else orbiting the player. */
  private updateCamera(blocked: import('./core/camera').CameraBlocker | null, dt = 1 / 60): void {
    const { player, input } = this;
    const ship = player.mounted?.spec.ship && player.mounted.airborne && !input.held('freeLook') ? player.mounted : null;
    if (ship) {
      this.cam.chase(input, dt, ship.pos, ship.attitude, ship.heading, 6 + ship.radius * 2.2, ship.cockpit ? tmp.fromArray(ship.cockpit) : null);
      // In the cockpit the hull would fill the view: it is hidden until the camera comes back out.
      ship.group.visible = !this.cam.firstPerson;
    } else {
      this.cam.release();
      if (player.mounted?.spec.ship) player.mounted.group.visible = true;
      this.cam.update(input, player.pos, blocked, dt, this.eyes());
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
    if (simulate && player.mounted) {
      // The mouse steers: the vehicle turns toward where the camera looks, and a flyer climbs or
      // sinks as the view tilts up or down past a dead band around level. Alt frees the camera
      // to look around without steering.
      const free = input.held('freeLook');
      const tilt = -(this.cam.pitch - CAMERA_REST_PITCH);
      const vertical = free ? 0 : Math.sign(tilt) * THREE.MathUtils.clamp((Math.abs(tilt) - 0.12) / 0.45, 0, 1);
      // A ship in flight takes the mouse itself (the camera chases it); Alt hands it back to the orbit.
      const shipFlying = !!player.mounted.spec.ship && player.mounted.airborne && !free && input.locked;
      const lookDX = shipFlying ? input.mouseDX : 0;
      const lookDY = shipFlying ? input.mouseDY : 0;
      if (shipFlying) {
        input.mouseDX = 0;
        input.mouseDY = 0;
      }
      drive = {
        throttle: (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0),
        steer: (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0),
        heading: free ? null : this.cam.yaw + Math.PI,
        boost: input.held('walk'),
        hop: input.pressedAction('jump'),
        up: input.held('jump'),
        down: input.held('crouch'),
        vertical,
        lookDX,
        lookDY,
      };
    }
    const terrain = this.world.terrain;
    for (const v of this.world.vehicles) v.update(dt, this.physics, v === player.mounted ? drive : null, (x, z) => terrain.heightAt(x, z), (x, z) => terrain.waterHeightAt(x, z));
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
    this.portals.render(this.scene, cam, view, this.world.buildings);
    this.frameCalls = info.calls;
    this.frameTriangles = info.triangles;
    this.renderer.info.autoReset = auto;
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
    return this.wardrobe.open || this.appearanceUi.open || this.weaponsUi.open || this.vehiclesUi.open || this.npcUi.open;
  }

  private closePanels(): void {
    if (this.wardrobe.open) this.wardrobe.hide();
    if (this.appearanceUi.open) this.appearanceUi.hide();
    if (this.weaponsUi.open) this.weaponsUi.hide();
    if (this.vehiclesUi.open) this.vehiclesUi.hide();
    if (this.npcUi.open) this.npcUi.hide();
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
    if (p.mounted) {
      const sp = p.mounted;
      sp.quaternion(tmpQ);
      tmp.set(-(sp.spec.bounds.max[0] - sp.spec.bounds.min[0]) / 2 - 1.0, 0, 0).applyQuaternion(tmpQ).add(sp.pos);
      tmp.y = Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
      p.dismount(tmp);
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
    if (best) {
      p.mount(best);
      this.cam.distance = Math.max(this.cam.distance, 9.5);
    }
  }

  private nearestSpeederDistance(): number {
    let d = Infinity;
    for (const sp of this.world.vehicles) d = Math.min(d, this.vehicleReach(sp));
    return d;
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
      const input = this.input;
      const player = this.player;
      // On the select screen and in the creator there is no world: nothing streams, nothing draws
      // but the panels, and the frame costs nothing.
      if (!this.inWorld) {
        input.endFrame();
        return;
      }
      const active = this.started && !this.traveling && !this.dying;
      if (active) this.savePlace();

      if (active) {
        if (input.pressedAction('map')) this.toggleMap();
        if (input.pressedAction('inventory')) this.toggleInventory();
        if (input.pressedAction('spawner')) this.toggleSpawner();
        if (input.pressedAction('help')) this.hud.toggleHelp();
        if (!this.map.open && !this.anyPanelOpen()) {
          if (input.pressedAction('saberToggle') && this.kit.id === 'jedi' && !player.mounted) player.toggleSaber();
          if (input.pressedAction('switchClass')) this.setClass(this.kit.id === 'jedi' ? 'bounty_hunter' : 'jedi');
          if (input.pressedAction('mount') && !player.noclip && !this.handleElevator()) this.handleMount();
          if (input.pressedAction('noclip') && !player.mounted) player.toggleNoclip();
          if (player.noclip && input.pressedAction('noclipFaster')) player.noclipSpeed = Math.min(2000, player.noclipSpeed * 1.5);
          if (player.noclip && input.pressedAction('noclipSlower')) player.noclipSpeed = Math.max(2, player.noclipSpeed / 1.5);
          if (input.pressedAction('flashlight')) this.torch.visible = !this.torch.visible;
        }
      }

      const simulate = active && !this.map.open && !this.anyPanelOpen();
      if (simulate) {
        player.update(dt, input, this.cam, this.world);
        this.stepCombat(dt);
      }

      this.stepVehicles(dt, simulate);

      const fast = simulate && input.held('fastForward');
      for (const m of this.shown) m.update(dt);
      this.world.update(dt, player.pos, this.cam.camera.position, fast, (dmg) => {
        if (!simulate || player.mounted || player.noclip) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      }, simulate && !player.mounted && !player.noclip ? player : null);
      const tPhys = performance.now();
      this.physics.step(dt);
      stats.physicsMs = performance.now() - tPhys;
      this.effects.update(dt);

      if (simulate && player.hp <= 0) void this.die();

      player.inside = this.world.inside;
      this.updateCamera(player.noclip ? null : (from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside), dt);
      if (this.torch.visible) {
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

      let prompt = '';
      if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl</b> down · <b>Shift</b> fast · <b>+</b>/<b>-</b> speed · <b>N</b> off`;
      else if (player.mounted) prompt = mountPrompt(player.mounted);
      else if (this.world.elevatorsNear(player.pos, MOUNT_RANGE).length) prompt = `<b>E</b> elevator ${this.world.elevatorsNear(player.pos, MOUNT_RANGE)[0].kind === 'down' ? 'down' : 'up'}`;
      else if (this.nearestSpeederDistance() < MOUNT_RANGE) prompt = '<b>E</b> mount';
      this.hud.setPrompt(prompt);
      const flying = player.mounted?.spec.ship && player.mounted.airborne && !input.held('freeLook') ? player.mounted : null;
      this.hud.setFlight(flying ? flying.stick : null);
      this.hud.update(dt, player.pos.x, player.pos.y, player.pos.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.world.planet.creatures.name, player.saberOn);

      if (this.breakFrames) throw new Error('debug: the frame is broken on purpose');
      const tRender = performance.now();
      this.drawFrame();
      stats.renderMs = performance.now() - tRender;
      stats.frameMs = performance.now() - tFrame;
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
