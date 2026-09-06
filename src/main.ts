import * as THREE from 'three';
import { BountyHunterKit } from './combat/bountyHunter';
import { Effects } from './combat/effects';
import { JediKit } from './combat/jedi';
import type { ClassId, Kit, KitContext } from './combat/kit';
import { ThirdPersonCamera } from './core/camera';
import { Input } from './core/input';
import { Physics } from './core/physics';
import { PLANETS, planetById, type PlanetDef } from './data/planets';
import { Player } from './player/player';
import { CharacterRig } from './player/rig';
import { GalaxyMap } from './ui/galaxyMap';
import { Hud } from './ui/hud';
import type { DriveInput } from './vehicles/speeder';
import { World } from './world/world';

const MOUNT_RANGE = 3.6;

/** Debug counters, readable from the console as window.__stats. */
const stats = { frameMs: 0, physicsMs: 0, renderMs: 0, rawDt: 0, grounded: false, vel: [0, 0, 0] as number[], calls: 0 };
(window as unknown as { __stats: typeof stats }).__stats = stats;
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

class App {
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

  constructor(private readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    const lowfx = new URLSearchParams(location.search).get('lowfx') === '1';
    this.renderer.setPixelRatio(lowfx ? 0.5 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, physics);
    this.player = new Player(this.scene, physics);
    this.effects = new Effects(this.scene);
    this.hud = new Hud(this.ui);
    this.map = new GalaxyMap(this.ui, (p) => void this.travel(p));

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
          <div><b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom · <b>Space</b> jump · <b>Shift</b> walk</div>
          <div><b>LMB</b> attack · <b>E</b> mount speeder · <b>C</b> switch class · <b>T</b> fast-forward time</div>
          <div><b>M</b> galaxy map · <b>H</b> toggle help · <b>Esc</b> release mouse</div>
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
      CharacterRig.load(`${import.meta.env.BASE_URL}assets/characters/xbot.glb`)
        .then((rig) => this.player.attachRig(rig))
        .catch((err) => console.warn('Character rig failed to load, using primitives', err));
    }
    const initialClass = params.get('class') === 'bounty_hunter' ? 'bounty_hunter' : 'jedi';
    this.setClass(initialClass);
    const initial = params.get('planet');
    this.arrive(initial && PLANETS.some((p) => p.id === initial) ? planetById(initial) : PLANETS[0]);
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
    history.replaceState(null, '', `?planet=${this.world.planet.id}&class=${this.kit.id}`);
  }

  private enter(cls: ClassId | null): void {
    if (cls) this.setClass(cls);
    this.started = true;
    this.start.classList.add('hidden');
    this.input.requestLock();
  }

  private arrive(planet: PlanetDef): void {
    this.world.load(planet);
    this.spawn = this.world.spawnPoint();
    this.player.reset(this.spawn);
    this.world.warmUp(this.spawn);
    this.physics.world.step();
    this.cam.yaw = Math.PI;
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id);
    this.updateUrl();
  }

  private async travel(planet: PlanetDef): Promise<void> {
    if (this.traveling) return;
    this.traveling = true;
    this.map.hide();
    this.input.captured = false;
    this.fade.textContent = `TRAVELING TO ${planet.name.toUpperCase()}`;
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 500));
    this.arrive(planet);
    this.renderer.render(this.scene, this.cam.camera);
    await new Promise((r) => setTimeout(r, 150));
    this.fade.classList.remove('on');
    this.traveling = false;
    this.input.requestLock();
  }

  private async die(): Promise<void> {
    this.dying = true;
    this.fade.textContent = 'YOU HAVE BECOME ONE WITH THE FORCE';
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 1400));
    this.player.reset(this.spawn);
    this.renderer.render(this.scene, this.cam.camera);
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
          if (input.justPressed('KeyE')) this.handleMount();
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
      this.world.update(dt, player.pos, this.cam.camera.position, fast, (dmg) => {
        if (!simulate || player.mounted) return;
        player.takeDamage(dmg);
        this.hud.hurt();
      });
      const tPhys = performance.now();
      this.physics.step(dt);
      stats.physicsMs = performance.now() - tPhys;
      this.effects.update(dt);

      if (simulate && player.hp <= 0) void this.die();

      this.cam.update(
        input,
        player.pos,
        (x, z) => Math.max(this.world.terrain.heightAt(x, z), this.world.terrain.waterLevel),
        (x, z, r) => this.world.collidersNear(x, z, r),
      );

      let prompt = '';
      if (player.mounted) prompt = '<b>E</b> dismount · <b>W/S</b> throttle · <b>A/D</b> steer · <b>Shift</b> boost · <b>Space</b> hop';
      else if (this.nearestSpeederDistance() < MOUNT_RANGE) prompt = '<b>E</b> mount speeder';
      this.hud.setPrompt(prompt);
      this.hud.update(dt, player.pos.x, player.pos.y, player.pos.z, this.kit, player.hp, player.maxHp, this.world.day.clock(), this.world.planet.creatures.name, player.saberOn);

      const tRender = performance.now();
      this.renderer.render(this.scene, this.cam.camera);
      stats.renderMs = performance.now() - tRender;
      stats.frameMs = performance.now() - tFrame;
      stats.rawDt = rawDt;
      stats.grounded = player.grounded;
      stats.vel = [player.vel.x, player.vel.y, player.vel.z];
      stats.calls = this.renderer.info.render.calls;
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
