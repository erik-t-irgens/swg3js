import type { Kit } from '../combat/kit';
import type { PlanetDef } from '../data/planets';

const COMMON_HELP = [
  '<b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom · <b>Space</b> jump · <b>Shift</b> walk',
  '<b>E</b> mount/dismount speeder · <b>C</b> switch class · <b>T</b> fast-forward time',
  '<b>M</b> galaxy map · <b>I</b> inventory (wardrobe, appearance, weapons) · <b>B</b> spawner (garage, NPCs) · <b>H</b> help · <b>N</b> noclip fly · <b>Esc</b> free the mouse',
];

export class Hud {
  private readonly root: HTMLElement;
  private readonly planetName: HTMLElement;
  private readonly planetTag: HTMLElement;
  private readonly loc: HTMLElement;
  private readonly fps: HTMLElement;
  /** A quiet line under the frame rate while the weather is not the shared schedule's. */
  private readonly weatherNote: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly className: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly resFill: HTMLElement;
  private readonly resText: HTMLElement;
  private readonly slotsEl: HTMLElement;
  private readonly help: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly chargeEl: HTMLElement;
  private readonly flight: HTMLElement;
  private flying = false;
  private readonly flightCentre: HTMLElement;
  private readonly flightRing: HTMLElement;
  private readonly aimCircle: HTMLElement;
  private readonly stickLine: HTMLElement;
  private readonly stickHead: HTMLElement;
  private readonly pip: HTMLElement;
  /** What the flight display last wrote, so an attribute is set only when it changes. */
  private readonly flightDrawn = { w: -1, h: -1, ox: NaN, oy: NaN, circle: -1, ring: -1, onLead: false, inside: true, cx: NaN, cy: NaN, turn: -1 };
  /** The lead reticle's state as last written: on the cursor or not. */
  private leadOn = false;
  private readonly mouseFree: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly hurtEl: HTMLElement;
  private readonly targets: HTMLElement;
  private readonly tbox: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly leadLine: HTMLElement;
  private readonly leadCross: HTMLElement[];
  private readonly tlabel: HTMLElement;
  /** The target box's class as last written ('' before the first target), so it is set only on a change. */
  private targetKind = '';
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
      <div class="panel help hidden"></div>
      <div class="panel top-right">
        <div class="clock"></div>
        <div class="fps"></div>
        <div class="weather-note" style="font-size: 11px; opacity: 0.75" hidden></div>
        <div class="hint"><b>M</b> Map &nbsp; <b>I</b> Inventory &nbsp; <b>B</b> Spawner &nbsp; <b>H</b> Help</div>
      </div>
      <div class="crosshair"></div>
      <div class="charge" hidden><div class="fill"></div></div>
      <svg class="flight hidden" style="left: 0; top: 0; margin: 0; width: 100%; height: 100%; overflow: visible">
        <g class="flight-centre">
          <circle class="ring" r="0" />
          <circle class="aim-circle" r="0" style="fill: none; stroke: rgba(127,215,255,0.6); stroke-width: 1.5; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8))" />
          <line class="cross" x1="-9" y1="0" x2="-4" y2="0" /><line class="cross" x1="4" y1="0" x2="9" y2="0" />
          <line class="cross" x1="0" y1="-9" x2="0" y2="-4" /><line class="cross" x1="0" y1="4" x2="0" y2="9" />
          <line class="stick-line" x1="0" y1="0" x2="0" y2="0" style="display: none" />
          <polygon class="stick-head" points="0,0 0,0 0,0" style="display: none" />
          <g class="pip">
            <circle r="7" style="fill: none; stroke: #ffffff; stroke-width: 1.5; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8))" />
            <circle class="stick-dot" r="1.8" />
          </g>
        </g>
      </svg>
      <svg class="targets hidden">
        <rect class="tbox" width="34" height="34" rx="2" />
        <line class="lead-line" x1="0" y1="0" x2="0" y2="0" />
        <circle class="lead" r="7" />
        <line class="lead-cross" x1="0" y1="0" x2="0" y2="0" /><line class="lead-cross" x1="0" y1="0" x2="0" y2="0" />
        <text class="tlabel"></text>
      </svg>
      <div class="mouse-free hidden">Mouse free · <b>click</b> to look again</div>
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
    this.weatherNote = q('.weather-note');
    this.clock = q('.clock');
    this.className = q('.class-name');
    this.hpFill = q('.hp .fill');
    this.hpText = q('.hp .text');
    this.resFill = q('.res .fill');
    this.resText = q('.res .text');
    this.slotsEl = q('.slots');
    this.help = q('.help');
    this.crosshair = q('.crosshair');
    this.chargeEl = q('.charge');
    this.flight = q('.flight');
    this.flightCentre = q('.flight-centre');
    this.flightRing = q('.flight .ring');
    this.aimCircle = q('.aim-circle');
    this.stickLine = q('.stick-line');
    this.stickHead = q('.stick-head');
    this.pip = q('.pip');
    this.mouseFree = q('.mouse-free');
    this.prompt = q('.prompt');
    this.hurtEl = q('.hurt');
    this.targets = q('.targets');
    this.tbox = q('.tbox');
    this.lead = q('.lead');
    this.leadLine = q('.lead-line');
    this.leadCross = [...this.root.querySelectorAll<HTMLElement>('.lead-cross')];
    this.tlabel = q('.tlabel');
  }

  /** A quiet line when the weather is not the shared schedule's (held, swapped, forced); empty hides it. Cheap to call every frame. */
  setWeatherNote(text: string): void {
    if (this.weatherNote.textContent === text) return;
    this.weatherNote.textContent = text;
    this.weatherNote.hidden = text === '';
  }

  /**
   * The ship's target in flight: a box on the target where it shows on screen, its name, range
   * and hull under it, and the lead reticle where the guns must point for a bolt fired now to
   * meet it, joined to the box by a line (green while the guns' cursor is on it). Nothing while
   * there is no target.
   */
  setTarget(t: { x: number; y: number; onScreen: boolean; leadX: number; leadY: number; leadOnScreen: boolean; label: string; kind?: 'enemy' | 'friend' | 'neutral'; onLead?: boolean } | null): void {
    this.targets.classList.toggle('hidden', !t);
    if (!t) return;
    // The lead reticle lights while the guns' cursor sits on it (the bolts take the lead exactly).
    const on = !!t.onLead;
    if (on !== this.leadOn) {
      this.leadOn = on;
      const stroke = on ? '#7dff9a' : '';
      this.lead.style.stroke = stroke;
      for (const c of this.leadCross) c.style.stroke = stroke;
    }
    // The box's colour says what the target is to the pilot: red an enemy, green a friend, white neither.
    const kind = t.kind ?? 'neutral';
    if (kind !== this.targetKind) {
      this.targetKind = kind;
      this.tbox.setAttribute('class', `tbox ${kind}`);
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A target off the screen is kept at its edge, so the pilot knows which way to turn.
    const clampEdge = (x: number, y: number, on: boolean) => (on ? { x, y } : { x: Math.min(w - 20, Math.max(20, x)), y: Math.min(h - 20, Math.max(20, y)) });
    const box = clampEdge(t.x, t.y, t.onScreen);
    this.tbox.setAttribute('x', String(box.x - 17));
    this.tbox.setAttribute('y', String(box.y - 17));
    this.tbox.style.opacity = t.onScreen ? '1' : '0.45';
    this.tlabel.setAttribute('x', String(box.x));
    this.tlabel.setAttribute('y', String(box.y + 32));
    if (this.tlabel.textContent !== t.label) this.tlabel.textContent = t.label;
    const showLead = t.onScreen && t.leadOnScreen;
    this.lead.style.display = showLead ? '' : 'none';
    this.leadLine.style.display = showLead ? '' : 'none';
    for (const c of this.leadCross) c.style.display = showLead ? '' : 'none';
    if (!showLead) return;
    this.lead.setAttribute('cx', String(t.leadX));
    this.lead.setAttribute('cy', String(t.leadY));
    this.leadCross[0].setAttribute('x1', String(t.leadX - 11));
    this.leadCross[0].setAttribute('x2', String(t.leadX + 11));
    this.leadCross[0].setAttribute('y1', String(t.leadY));
    this.leadCross[0].setAttribute('y2', String(t.leadY));
    this.leadCross[1].setAttribute('x1', String(t.leadX));
    this.leadCross[1].setAttribute('x2', String(t.leadX));
    this.leadCross[1].setAttribute('y1', String(t.leadY - 11));
    this.leadCross[1].setAttribute('y2', String(t.leadY + 11));
    this.leadLine.setAttribute('x1', String(box.x));
    this.leadLine.setAttribute('y1', String(box.y));
    this.leadLine.setAttribute('x2', String(t.leadX));
    this.leadLine.setAttribute('y2', String(t.leadY));
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
    this.crosshair.hidden = kit.id !== 'bounty_hunter' || this.flying;
  }

  /**
   * The flight display, in a ship in flight only (the DOM, so nothing compiles): a small crosshair on the boresight, the
   * aim circle about it, a faint ring for the cursor's reach, and the cursor. Inside the circle the cursor is the guns'
   * pip, and the circle lights when it sits on the target's lead; outside it an arrow runs from the circle's rim to the
   * cursor, which stays where it was left, brighter the harder the ship turns. `ox`/`oy` is where the boresight shows, in
   * pixels from the middle of the window (0, 0 in the cockpit; off the middle while a chase view catches a turn up);
   * `cx`/`cy` the cursor in pixels from there, `circle` and `ring` radii in pixels, `inside` whether the cursor is in the
   * circle (the hull's own reckoning). An attribute is written only when it changes.
   */
  setFlight(view: { ox: number; oy: number; cx: number; cy: number; circle: number; ring: number; turn: number; onLead: boolean; inside: boolean } | null): void {
    this.flying = !!view;
    this.flight.classList.toggle('hidden', !view);
    if (!view) return;
    const d = this.flightDrawn;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ox = Math.round(view.ox * 2) / 2;
    const oy = Math.round(view.oy * 2) / 2;
    if (w !== d.w || h !== d.h || ox !== d.ox || oy !== d.oy) {
      d.w = w;
      d.h = h;
      d.ox = ox;
      d.oy = oy;
      this.flightCentre.setAttribute('transform', `translate(${w / 2 + ox} ${h / 2 + oy})`);
    }
    const circle = Math.round(view.circle * 2) / 2;
    if (circle !== d.circle) {
      d.circle = circle;
      this.aimCircle.setAttribute('r', String(circle));
      // The arrow's shaft starts at the rim: drawn again when the rim moves (a resize, a change of view or of the tune).
      d.cx = NaN;
    }
    const ring = Math.round(view.ring * 2) / 2;
    if (ring !== d.ring) {
      d.ring = ring;
      this.flightRing.setAttribute('r', String(ring));
    }
    if (view.onLead !== d.onLead) {
      d.onLead = view.onLead;
      this.aimCircle.style.stroke = view.onLead ? 'rgba(125,255,154,0.95)' : 'rgba(127,215,255,0.6)';
    }
    const x = Math.round(view.cx * 2) / 2;
    const y = Math.round(view.cy * 2) / 2;
    const turn = Math.round(view.turn * 20) / 20;
    const len = Math.hypot(x, y);
    // The pip while the hull reckons the cursor inside, and while it is drawn inside the rim (a near range's parallax), so
    // the arrow never points back into the circle.
    const inside = view.inside || len <= circle;
    if (inside !== d.inside) {
      d.inside = inside;
      d.cx = NaN;
      this.pip.style.display = inside ? '' : 'none';
      this.stickLine.style.display = inside ? 'none' : '';
      this.stickHead.style.display = inside ? 'none' : '';
    }
    if (x === d.cx && y === d.cy && turn === d.turn) return;
    d.cx = x;
    d.cy = y;
    d.turn = turn;
    if (inside) {
      this.pip.setAttribute('transform', `translate(${x} ${y})`);
      return;
    }
    const ux = x / len;
    const uy = y / len;
    // The shaft from just outside the rim to short of the head; the head a little triangle at the cursor, pointing on.
    const hx = x - ux * 10;
    const hy = y - uy * 10;
    const from = Math.min(circle + 3, len - 10);
    const sx = ux * from;
    const sy = uy * from;
    this.stickLine.setAttribute('x1', String(sx));
    this.stickLine.setAttribute('y1', String(sy));
    this.stickLine.setAttribute('x2', String(hx));
    this.stickLine.setAttribute('y2', String(hy));
    this.stickHead.setAttribute('points', `${x},${y} ${hx - uy * 6},${hy + ux * 6} ${hx + uy * 6},${hy - ux * 6}`);
    const o = (0.45 + 0.55 * turn).toFixed(2);
    this.stickLine.style.opacity = o;
    this.stickHead.style.opacity = o;
  }

  setPrompt(text: string): void {
    if (this.prompt.innerHTML !== text) this.prompt.innerHTML = text;
  }

  /** A quiet note that the pointer is loose, instead of a menu over the whole game. */
  setMouseFree(free: boolean): void {
    this.mouseFree.classList.toggle('hidden', !free);
    this.crosshair.classList.toggle('hidden', free);
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
    const bar = this.resFill.parentElement;
    if (bar) bar.hidden = !r;
    if (r) {
      this.resFill.style.width = `${((r.value / r.max) * 100).toFixed(1)}%`;
      this.resText.textContent = `${r.label} ${Math.round(r.value)}`;
    }
    for (let i = 0; i < kit.slots.length; i++) {
      const el = this.slots[i];
      el.classList.toggle('active', kit.slotActive(i));
      (el.firstElementChild as HTMLElement).style.height = `${(kit.slotCooldown(i) * 100).toFixed(0)}%`;
    }
    // A charging shot: a bar filling under the crosshair.
    const charge = kit.charge?.() ?? 0;
    this.chargeEl.hidden = charge <= 0;
    if (charge > 0) (this.chargeEl.firstElementChild as HTMLElement).style.width = `${(charge * 100).toFixed(0)}%`;
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
