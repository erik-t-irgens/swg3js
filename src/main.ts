import * as THREE from 'three';
import { ThirdPersonCamera } from './core/camera';
import { Input } from './core/input';
import { PLANETS, planetById, type PlanetDef } from './data/planets';
import { ForcePowers } from './force/powers';
import { Player } from './player/player';
import { GalaxyMap } from './ui/galaxyMap';
import { Hud } from './ui/hud';
import { World } from './world/world';

class App {
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly ui = document.getElementById('ui') as HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam: ThirdPersonCamera;
  private readonly input: Input;
  private readonly world: World;
  private readonly player: Player;
  private readonly powers: ForcePowers;
  private readonly hud: Hud;
  private readonly map: GalaxyMap;
  private readonly fade: HTMLElement;
  private readonly start: HTMLElement;
  private readonly timer = new THREE.Timer();
  private started = false;
  private traveling = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.input = new Input(this.canvas);
    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.powers = new ForcePowers(this.scene);
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
          <div><b>1</b> Force Jump · <b>2</b> Force Speed · <b>3</b> Force Push · <b>4</b> Force Lightning (hold)</div>
          <div><b>L</b> lightsaber · <b>M</b> galaxy map · <b>H</b> toggle help · <b>Esc</b> release mouse</div>
        </div>
        <button class="enter">Enter the galaxy</button>
      </div>`;
    this.ui.appendChild(this.start);
    this.start.querySelector('.enter')!.addEventListener('click', () => this.enter());

    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.started && !this.map.open && !this.traveling) {
        this.start.classList.remove('hidden');
        this.start.querySelector('.enter')!.textContent = 'Resume';
      }
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.camera.aspect = window.innerWidth / window.innerHeight;
      this.cam.camera.updateProjectionMatrix();
    });

    const initial = new URLSearchParams(location.search).get('planet');
    this.arrive(initial && PLANETS.some((p) => p.id === initial) ? planetById(initial) : PLANETS[0]);
  }

  private enter(): void {
    this.started = true;
    this.start.classList.add('hidden');
    this.input.requestLock();
  }

  private arrive(planet: PlanetDef): void {
    this.world.load(planet);
    const spawn = this.world.spawnPoint();
    this.player.reset(spawn);
    this.world.warmUp(spawn);
    this.cam.yaw = Math.PI;
    this.hud.setPlanet(planet);
    this.map.setCurrent(planet.id);
    history.replaceState(null, '', `?planet=${planet.id}`);
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

  run(): void {
    const frame = () => {
      requestAnimationFrame(frame);
      this.timer.update();
      const dt = Math.min(0.05, this.timer.getDelta());

      if (this.started && !this.traveling) {
        if (this.input.justPressed('KeyM')) this.toggleMap();
        if (this.input.justPressed('KeyH')) this.hud.toggleHelp();
        if (this.input.justPressed('KeyL') && !this.map.open) this.player.toggleSaber();

        if (!this.map.open) {
          this.player.update(dt, this.input, this.cam, this.world);
          this.powers.update(dt, this.input, this.player, this.world, this.cam);
        }
      }

      this.cam.update(
        this.input,
        this.player.pos,
        (x, z) => Math.max(this.world.terrain.heightAt(x, z), this.world.terrain.waterLevel),
        (x, z, r) => this.world.collidersNear(x, z, r),
      );
      this.world.update(dt, this.player.pos, this.cam.camera.position);
      this.hud.update(dt, this.player.pos.x, this.player.pos.y, this.player.pos.z, this.powers, this.player.saberOn, this.world.planet.creatures.name);
      this.renderer.render(this.scene, this.cam.camera);
      this.input.endFrame();
    };
    frame();
  }
}

new App().run();
