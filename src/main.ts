import * as THREE from 'three';
const torchDir = new THREE.Vector3();
import { BountyHunterKit } from './combat/bountyHunter';
import { Effects } from './combat/effects';
import { JediKit } from './combat/jedi';
import type { ClassId, Kit, KitContext } from './combat/kit';
import { ThirdPersonCamera } from './core/camera';
import { PortalRenderer } from './world/portalRender';
import { Input } from './core/input';
import { Physics } from './core/physics';
import { PLANETS, packIdOf, planetById, type PlanetDef } from './data/planets';
import { Player } from './player/player';
import { loadPlayerRig } from './player/rig';
import { GalaxyMap, type Poi } from './ui/galaxyMap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Hud } from './ui/hud';
import type { DriveInput } from './vehicles/speeder';
import { World } from './world/world';

const MOUNT_RANGE = 3.6;

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0, pack: '', terrain: '', chunks: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

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
  private readonly fade: HTMLElement;
  private readonly start: HTMLElement;
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
      look: (yaw: number, pitch: number) => {
        this.cam.yaw = yaw;
        this.cam.pitch = pitch;
      },
      zoom: (distance: number) => {
        this.cam.distance = distance;
      },
      cell: () => (this.world.cellState ? { model: this.world.cellState.building.model.def.id, cell: this.world.cellState.cell } : null),
      passes: () => this.portals.passes,
      flora: () => this.world.floraStatus,
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
      /** The saber system's state: style, current move, chain count, whether the rig has Jedi Academy's clips, the special jump in progress, and the thrown saber's flight. */
      saber: () => ({ style: this.player.saber.style, move: this.player.saber.move, chain: this.player.saber.chainCount, timer: Number(this.player.saber.timer.toFixed(2)), jkaClips: this.player.hasJkaClips, on: this.player.saberOn, special: this.player.jka.specialJump, thrown: this.player.thrown.inFlight ? { returning: this.player.thrown.returning, at: this.player.thrown.pos.toArray().map((v) => Number(v.toFixed(2))) } : null }),
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
      /** Simulate `seconds` of play at 60 Hz with the given keys held, without waiting on real frames. */
      advance: (seconds: number, keys: string[] = []) => {
        for (const k of keys) this.input.force(k, true);
        const dt = 1 / 60;
        for (let i = 0; i < Math.round(seconds / dt); i++) {
          this.cam.update(this.input, this.player.pos, null);
          this.player.update(dt, this.input, this.cam, this.world);
          this.physics.step(dt);
          this.input.endFrame();
        }
        for (const k of keys) this.input.force(k, false);
      },
      player: () => {
        const p = this.player;
        return { pos: p.pos.toArray().map((v) => Number(v.toFixed(2))), vel: p.vel.toArray().map((v) => Number(v.toFixed(2))), grounded: p.grounded, swimming: p.swimming, submerged: p.submerged, water: this.world.terrain.waterHeightAt(p.pos.x, p.pos.z), ground: this.world.terrain.heightAt(p.pos.x, p.pos.z), captured: this.input.captured };
      },
    };

    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    this.ui.appendChild(this.fade);

    this.start = document.createElement('div');
    this.start.id = 'start';
    this.start.className = 'overlay';
    this.start.innerHTML = `
      <div class="start-panel">
        <h1>SWG3JS</h1>
        <div class="sub">Star Wars Galaxies, rebuilt for the browser. Ten worlds, one very ambitious side project.</div>
        <div class="controls">
          <div><b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom · <b>Space</b> jump (hold to Force Jump higher) · <b>Ctrl</b> crouch (tap while moving to roll) · <b>Shift</b> walk · in water <b>Space</b>/<b>Ctrl</b> surface/dive, or look down and swim</div>
          <div><b>LMB</b> attack · <b>RMB</b> throw the saber (staff: kick) · <b>E</b> mount speeder · <b>C</b> switch class · <b>T</b> fast-forward time</div>
          <div><b>M</b> galaxy map · <b>H</b> toggle help · <b>N</b> noclip fly (<b>+</b>/<b>-</b> speed) · <b>F</b> flashlight · <b>Esc</b> release mouse</div>
        </div>
        <div class="class-pick">
          <button class="enter" data-class="jedi">Enter as Jedi<small>Lightsaber, Force powers</small></button>
          <button class="enter" data-class="bounty_hunter">Enter as Bounty Hunter<small>Blaster rifle, jetpack, detonators</small></button>
        </div>
        <button class="resume hidden">Resume</button>
      </div>`;
    this.ui.appendChild(this.start);
    this.start.querySelectorAll<HTMLElement>('.enter').forEach((b) => {
      b.addEventListener('click', () => this.enter(b.dataset.class as ClassId));
    });
    this.start.querySelector('.resume')!.addEventListener('click', () => this.enter(null));

    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.started && !this.map.open && !this.traveling) {
        this.start.classList.remove('hidden');
        this.start.querySelector('.class-pick')!.classList.add('hidden');
        this.start.querySelector('.resume')!.classList.remove('hidden');
      }
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.camera.aspect = window.innerWidth / window.innerHeight;
      this.cam.camera.updateProjectionMatrix();
    });

    const params = new URLSearchParams(location.search);
    if (params.get('rig') !== '0') {
      loadPlayerRig(import.meta.env.BASE_URL)
        .then((rig) => this.player.attachRig(rig))
        .catch((err) => console.warn('Character rig failed to load, using primitives', err));
    }
    const initialClass = params.get('class') === 'bounty_hunter' ? 'bounty_hunter' : 'jedi';
    this.setClass(initialClass);
    const initial = params.get('planet');
    this.arrive(initial && PLANETS.some((p) => p.id === initial) ? planetById(initial) : PLANETS[0], params.get('zone') ?? undefined);
  }

  private setClass(id: ClassId): void {
    this.kit?.dispose();
    this.kit = id === 'jedi' ? new JediKit(this.scene) : new BountyHunterKit(this.scene);
    this.player.setClass(id);
    this.player.speedMultiplier = 1;
    this.player.jetThrust = false;
    this.hud.setKit(this.kit);
    this.updateUrl();
  }

  private updateUrl(): void {
    if (!this.world.planet) return;
    const zone = this.zone ? `&zone=${this.zone}` : '';
    history.replaceState(null, '', `?planet=${this.world.planet.id}${zone}&class=${this.kit.id}`);
  }

  private enter(cls: ClassId | null): void {
    if (cls) this.setClass(cls);
    this.started = true;
    this.start.classList.add('hidden');
    this.input.requestLock();
  }

  /** The zone of a multi-terrain planet the player is in, when the planet has zones. */
  private zone: string | undefined;

  private arrive(planet: PlanetDef, zoneId?: string): void {
    this.zone = planet.zones?.length ? (planet.zones.find((z) => z.id === zoneId) ?? planet.zones[0]).id : undefined;
    this.world.load(planet, packIdOf(planet, this.zone));
    this.spawn = this.world.spawnPoint();
    this.player.reset(this.spawn);
    this.world.warmUp(this.spawn);
    this.physics.world.step();
    this.cam.yaw = Math.PI;
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id, this.zone);
    this.updateUrl();
    const arrivalSpawn = this.spawn.clone();
    void this.world.loadPack(this.spawn).then((clearSpawn) => {
      const p = this.player;
      if (p.mounted || p.noclip) return;
      // Still standing where we arrived: move to open ground now that the real city is in.
      if (clearSpawn && p.pos.distanceTo(arrivalSpawn) < 4) {
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
    this.fade.textContent = `TRAVELING TO ${(zone ? `${planet.name}: ${zone.name}` : planet.name).toUpperCase()}`;
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 500));
    this.arrive(planet, zoneId);
    this.drawFrame();
    await new Promise((r) => setTimeout(r, 150));
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
    this.fade.textContent = poi.name.toUpperCase();
    this.fade.classList.add('on');
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
    this.drawFrame();
    await new Promise((r) => setTimeout(r, 150));
    this.fade.classList.remove('on');
    this.traveling = false;
    this.input.requestLock();
  }

  /** One frame through the portal renderer: the camera's building in full, the world through its doors (or the reverse). */
  private drawFrame(): void {
    const cam = this.cam.camera;
    cam.updateMatrixWorld();
    const eye = this.player.pos.clone().setY(this.player.pos.y + 1.5);
    const view = this.portals.cameraBuilding(this.world.cellState, eye, cam.position, this.world.buildings);
    this.portals.render(this.scene, cam, view, this.world.buildings);
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
      tmp.set(-1.6, 0, 0).applyQuaternion(tmpQ).add(sp.pos);
      tmp.y = Math.max(this.world.terrain.heightAt(tmp.x, tmp.z), this.world.terrain.waterLevel - 1) + 0.3;
      p.dismount(tmp);
      return;
    }
    let best = null;
    let bestD = MOUNT_RANGE;
    for (const sp of this.world.speeders) {
      const d = sp.pos.distanceTo(p.pos);
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
    for (const sp of this.world.speeders) d = Math.min(d, sp.pos.distanceTo(this.player.pos));
    return d;
  }

  run(): void {
    const frame = () => {
      requestAnimationFrame(frame);
      const tFrame = performance.now();
      this.timer.update();
      const rawDt = this.timer.getDelta();
      const dt = Math.min(0.05, rawDt);
      const active = this.started && !this.traveling && !this.dying;
      const input = this.input;
      const player = this.player;

      if (active) {
        if (input.justPressed('KeyM')) this.toggleMap();
        if (input.justPressed('KeyH')) this.hud.toggleHelp();
        if (!this.map.open) {
          if (input.justPressed('KeyL') && this.kit.id === 'jedi' && !player.mounted) player.toggleSaber();
          if (input.justPressed('KeyC')) this.setClass(this.kit.id === 'jedi' ? 'bounty_hunter' : 'jedi');
          if (input.justPressed('KeyE') && !player.noclip && !this.handleElevator()) this.handleMount();
          if (input.justPressed('KeyN') && !player.mounted) player.toggleNoclip();
          if (player.noclip && (input.justPressed('Equal') || input.justPressed('NumpadAdd'))) player.noclipSpeed = Math.min(2000, player.noclipSpeed * 1.5);
          if (player.noclip && (input.justPressed('Minus') || input.justPressed('NumpadSubtract'))) player.noclipSpeed = Math.max(2, player.noclipSpeed / 1.5);
          if (input.justPressed('KeyF')) this.torch.visible = !this.torch.visible;
        }
      }

      const simulate = active && !this.map.open;
      if (simulate) {
        player.update(dt, input, this.cam, this.world);
        const ctx: KitContext = { dt, input, player, world: this.world, cam: this.cam, physics: this.physics, effects: this.effects };
        this.kit.update(ctx);
      }

      let drive: DriveInput | null = null;
      if (simulate && player.mounted) {
        drive = {
          throttle: (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0),
          steer: (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0),
          boost: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
          hop: input.justPressed('Space'),
        };
      }
      for (const sp of this.world.speeders) sp.update(dt, this.physics, sp === player.mounted ? drive : null);
      if (player.mounted) player.syncMount();

      const fast = simulate && input.isDown('KeyT');
      for (const m of this.shown) m.update(dt);
      this.world.update(dt, player.pos, this.cam.camera.position, fast, (dmg) => {
        if (!simulate || player.mounted || player.noclip) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      });
      const tPhys = performance.now();
      this.physics.step(dt);
      stats.physicsMs = performance.now() - tPhys;
      this.effects.update(dt);

      if (simulate && player.hp <= 0) void this.die();

      player.inside = this.world.inside;
      this.cam.update(input, player.pos, player.noclip ? null : (from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside));
      if (this.torch.visible) {
        this.torch.position.copy(this.cam.camera.position);
        this.cam.camera.getWorldDirection(torchDir);
        this.torch.target.position.copy(this.cam.camera.position).addScaledVector(torchDir, 12);
      }
      player.group.visible = !this.cam.firstPerson;
      this.world.updateShadows(performance.now());

      let prompt = '';
      if (player.noclip) prompt = `<b>NOCLIP</b> ${Math.round(player.noclipSpeed)} m/s · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl</b> down · <b>Shift</b> fast · <b>+</b>/<b>-</b> speed · <b>N</b> off`;
      else if (player.mounted) prompt = '<b>E</b> dismount · <b>W/S</b> throttle · <b>A/D</b> steer · <b>Shift</b> boost · <b>Space</b> hop';
      else if (this.world.elevatorsNear(player.pos, MOUNT_RANGE).length) prompt = `<b>E</b> elevator ${this.world.elevatorsNear(player.pos, MOUNT_RANGE)[0].kind === 'down' ? 'down' : 'up'}`;
      else if (this.nearestSpeederDistance() < MOUNT_RANGE) prompt = '<b>E</b> mount speeder';
      this.hud.setPrompt(prompt);
      this.hud.update(dt, player.pos.x, player.pos.y, player.pos.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.world.planet.creatures.name, player.saberOn);

      const tRender = performance.now();
      this.drawFrame();
      stats.renderMs = performance.now() - tRender;
      stats.frameMs = performance.now() - tFrame;
      stats.rawDt = rawDt;
      stats.grounded = player.grounded;
      stats.vel = [player.vel.x, player.vel.y, player.vel.z];
      stats.calls = this.renderer.info.render.calls;
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
