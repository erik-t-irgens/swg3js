import type { Kit } from '../combat/kit';
import type { PlanetDef } from '../data/planets';

const COMMON_HELP = [
  '<b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom · <b>Space</b> jump · <b>Shift</b> walk',
  '<b>E</b> mount/dismount speeder · <b>C</b> switch class · <b>T</b> fast-forward time',
  '<b>M</b> galaxy map · <b>H</b> help · <b>N</b> noclip fly · <b>Esc</b> release mouse',
];

export class Hud {
  private readonly root: HTMLElement;
  private readonly planetName: HTMLElement;
  private readonly planetTag: HTMLElement;
  private readonly loc: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly className: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly resFill: HTMLElement;
  private readonly resText: HTMLElement;
  private readonly slotsEl: HTMLElement;
  private readonly help: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly hurtEl: HTMLElement;
  private slots: HTMLElement[] = [];
  private hurtLevel = 0;
  private lastFps = performance.now();
  private frames = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hurt"></div>
      <div class="panel top-left">
        <div class="planet-name"></div>
        <div class="planet-tag"></div>
        <div class="loc"></div>
      </div>
      <div class="panel help"></div>
      <div class="panel top-right">
        <div class="clock"></div>
        <div class="fps"></div>
        <div class="hint"><b>M</b> Galaxy map &nbsp; <b>H</b> Help</div>
      </div>
      <div class="crosshair"></div>
      <div class="prompt"></div>
      <div class="bottom">
        <div class="class-name"></div>
        <div class="bar hp"><div class="fill"></div><div class="text"></div></div>
        <div class="bar res"><div class="fill"></div><div class="text"></div></div>
        <div class="slots"></div>
      </div>`;
    parent.appendChild(this.root);
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    this.planetName = q('.planet-name');
    this.planetTag = q('.planet-tag');
    this.loc = q('.loc');
    this.fps = q('.fps');
    this.clock = q('.clock');
    this.className = q('.class-name');
    this.hpFill = q('.hp .fill');
    this.hpText = q('.hp .text');
    this.resFill = q('.res .fill');
    this.resText = q('.res .text');
    this.slotsEl = q('.slots');
    this.help = q('.help');
    this.crosshair = q('.crosshair');
    this.prompt = q('.prompt');
    this.hurtEl = q('.hurt');
  }

  setPlanet(p: PlanetDef): void {
    this.planetName.textContent = p.name;
    this.planetTag.textContent = p.tagline;
  }

  setKit(kit: Kit): void {
    this.className.textContent = kit.name;
    this.slotsEl.innerHTML = '';
    this.slots = [];
    for (const s of kit.slots) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="cd"></div><span class="key">${s.key}</span><span class="name">${s.name}</span><span class="cost">${s.cost}</span>`;
      this.slotsEl.appendChild(el);
      this.slots.push(el);
    }
    const saber = document.createElement('div');
    saber.className = 'slot saber';
    saber.innerHTML = `<div class="cd"></div><span class="key">L</span><span class="name">Lightsaber</span><span class="cost">off</span>`;
    saber.hidden = kit.id !== 'jedi';
    this.slotsEl.appendChild(saber);
    this.slots.push(saber);
    this.help.innerHTML = [...COMMON_HELP, ...kit.help].map((l) => `<div>${l}</div>`).join('');
    this.crosshair.hidden = kit.id !== 'bounty_hunter';
  }

  setPrompt(text: string): void {
    if (this.prompt.innerHTML !== text) this.prompt.innerHTML = text;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  hurt(): void {
    this.hurtLevel = 1;
  }

  update(dt: number, x: number, y: number, z: number, kit: Kit, hp: number, maxHp: number, clock: string, creatureName: string, saberOn: boolean): void {
    this.frames++;
    const now = performance.now();
    const acc = (now - this.lastFps) / 1000;
    if (acc >= 0.25) {
      this.lastFps = now;
      this.fps.textContent = `${Math.round(this.frames / acc)} fps`;
      this.loc.textContent = `/loc ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)} · nearby: ${creatureName}`;
      this.clock.textContent = clock;
      this.frames = 0;
    }
    this.hpFill.style.width = `${((hp / maxHp) * 100).toFixed(1)}%`;
    this.hpText.textContent = `Health ${Math.ceil(hp)}`;
    const r = kit.resource;
    this.resFill.style.width = `${((r.value / r.max) * 100).toFixed(1)}%`;
    this.resText.textContent = `${r.label} ${Math.round(r.value)}`;
    for (let i = 0; i < kit.slots.length; i++) {
      const el = this.slots[i];
      el.classList.toggle('active', kit.slotActive(i));
      (el.firstElementChild as HTMLElement).style.height = `${(kit.slotCooldown(i) * 100).toFixed(0)}%`;
    }
    const saber = this.slots[kit.slots.length];
    if (saber && !saber.hidden) {
      saber.classList.toggle('active', saberOn);
      saber.querySelector('.cost')!.textContent = saberOn ? 'on' : 'off';
    }
    if (this.hurtLevel > 0) {
      this.hurtLevel = Math.max(0, this.hurtLevel - dt * 2);
      this.hurtEl.style.opacity = this.hurtLevel.toFixed(2);
    }
  }
}
