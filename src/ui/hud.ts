import type { PlanetDef } from '../data/planets';
import { POWERS, type ForcePowers } from '../force/powers';

export class Hud {
  private readonly root: HTMLElement;
  private readonly planetName: HTMLElement;
  private readonly planetTag: HTMLElement;
  private readonly loc: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly forceFill: HTMLElement;
  private readonly forceText: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly saber: HTMLElement;
  private readonly help: HTMLElement;
  private acc = 0;
  private frames = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="panel top-left">
        <div class="planet-name"></div>
        <div class="planet-tag"></div>
        <div class="loc"></div>
      </div>
      <div class="panel top-right">
        <div class="fps"></div>
        <div class="hint"><b>M</b> Galaxy map &nbsp; <b>H</b> Help</div>
      </div>
      <div class="bottom">
        <div class="force-bar"><div class="force-fill"></div><div class="force-text"></div></div>
        <div class="slots"></div>
      </div>
      <div class="panel help">
        <div><b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom</div>
        <div><b>Space</b> jump · <b>Shift</b> walk · <b>L</b> lightsaber</div>
        <div><b>1</b> Force Jump · <b>2</b> Force Speed · <b>3</b> Force Push · <b>4</b> Force Lightning (hold)</div>
        <div><b>M</b> galaxy map · <b>Esc</b> release mouse</div>
      </div>`;
    parent.appendChild(this.root);
    this.planetName = this.root.querySelector('.planet-name')!;
    this.planetTag = this.root.querySelector('.planet-tag')!;
    this.loc = this.root.querySelector('.loc')!;
    this.fps = this.root.querySelector('.fps')!;
    this.forceFill = this.root.querySelector('.force-fill')!;
    this.forceText = this.root.querySelector('.force-text')!;
    this.help = this.root.querySelector('.help')!;
    const slots = this.root.querySelector('.slots')!;
    for (const p of POWERS) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="key">${p.key}</span><span class="name">${p.name}</span><span class="cost">${p.cost}</span>`;
      slots.appendChild(el);
      this.slots.push(el);
    }
    this.saber = document.createElement('div');
    this.saber.className = 'slot saber';
    this.saber.innerHTML = `<span class="key">L</span><span class="name">Lightsaber</span><span class="cost">off</span>`;
    slots.appendChild(this.saber);
  }

  setPlanet(p: PlanetDef): void {
    this.planetName.textContent = p.name;
    this.planetTag.textContent = p.tagline;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  update(dt: number, x: number, y: number, z: number, powers: ForcePowers, saberOn: boolean, creatureName: string): void {
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.25) {
      this.fps.textContent = `${Math.round(this.frames / this.acc)} fps`;
      this.loc.textContent = `/loc ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)} · nearby: ${creatureName}`;
      this.acc = 0;
      this.frames = 0;
    }
    const f = powers.force / powers.maxForce;
    this.forceFill.style.width = `${(f * 100).toFixed(1)}%`;
    this.forceText.textContent = `Force ${Math.round(powers.force)}`;
    this.slots[1].classList.toggle('active', powers.speedActive);
    this.slots[3].classList.toggle('active', powers.lightningActive);
    this.saber.classList.toggle('active', saberOn);
    this.saber.querySelector('.cost')!.textContent = saberOn ? 'on' : 'off';
  }
}
