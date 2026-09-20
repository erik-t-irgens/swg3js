import type { Kit } from '../combat/kit';
import type { PlanetDef } from '../data/planets';

const COMMON_HELP = [
  '<b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom · <b>Space</b> jump · <b>Shift</b> walk',
  '<b>E</b> mount/dismount speeder · <b>C</b> switch class · <b>T</b> fast-forward time',
  '<b>M</b> galaxy map · <b>I</b> inventory (wardrobe, appearance, weapons) · <b>B</b> spawner (garage, NPCs) · <b>H</b> help · <b>N</b> noclip fly · <b>Esc</b> free the mouse',
];

/**
 * How finely a value has to change before the display writes it to the DOM, and what a bar's fill is
 * measured in. Every number here is INVENTED; they are kept together so there is one place to look,
 * and they are live through `Hud.tune` so a value can be tried without a reload. None of them decides
 * what is drawn, only how often a write happens: the worst a wrong one can do is cost a write, or
 * hold a value one step longer than it might have.
 *
 * `barPixels` is the on-foot bars' own width, `.bar { width: 320px }` at `src/style.css:146`, so a
 * share is compared at the finest step the bar can actually show; if that rule's width changes, or
 * the bars move behind `--hud-scale` in `src/ui/hud.css`, this follows it. The rest are the steps the
 * display already rounded to before (`toFixed(0)` on a percentage is a step of 100, `toFixed(2)` on
 * the hurt fade a step of 100), so what reaches the screen is what reached it before.
 */
export const HUD_TUNE = {
  barPixels: 320,
  cooldownSteps: 100,
  chargeSteps: 100,
  hurtSteps: 100,
};

/**
 * The keys `tune` takes. A key that is not one of these is a mistake at the console, and saying so is
 * worth more than quietly accepting it: `Object.assign` took `{ barPixel: 1 }` without a word.
 */
const TUNE_KEYS = ['barPixels', 'cooldownSteps', 'chargeSteps', 'hurtSteps'] as const;

/** What `Hud.stats()` reports, filled in place so asking for it allocates nothing. */
export interface HudStats {
  /** DOM writes in the last full second that were not by design: 0 in a steady frame. */
  writes: number;
  /** DOM writes in the last full second that are meant to happen: the 4 Hz clock, /loc and frame rate, and a rebuild of the slot row. */
  byDesign: number;
  /** How far into the second now being counted. */
  seconds: number;
  /** The same two counts so far in the second now being counted. */
  writesNow: number;
  byDesignNow: number;
}

/**
 * The slow half of the head-up display: the planet block, the clock and the frame rate, the weather
 * note, the on-foot bars, the number slots, the crosshair and its charge, the prompt, the hurt fade,
 * the help block and the mouse-free line. The flight display -- the reticle, the aim circle and the
 * target's bracket -- is `ShipHud`'s, drawn on the overlay canvas; nothing here knows about flying.
 *
 * Every value is written to the DOM only when what it shows has changed, and what was last written is
 * held in a field here rather than read back off the element.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly planetName: HTMLElement;
  private readonly planetTag: HTMLElement;
  private readonly loc: HTMLElement;
  private readonly fps: HTMLElement;
  /** A quiet line under the frame rate while the weather is not the shared schedule's. */
  private readonly weatherNote: HTMLElement;
  /** What that line holds, kept here rather than read back off the element. */
  private weatherNoteText = '';
  private readonly clock: HTMLElement;
  private readonly className: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly resBar: HTMLElement;
  private readonly resFill: HTMLElement;
  private readonly resText: HTMLElement;
  private readonly slotsEl: HTMLElement;
  private readonly help: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly chargeEl: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly mouseFree: HTMLElement;
  private mouseFreeDrawn = false;
  private readonly prompt: HTMLElement;
  /** What the prompt holds, kept here rather than read back off the element: reading `innerHTML` serialises the whole subtree. */
  private promptText = '';
  private readonly hurtEl: HTMLElement;
  private slots: HTMLElement[] = [];
  /** Each slot's cooldown shade, its lit state and its shade's height as last written, beside the slot row itself. */
  private slotCds: HTMLElement[] = [];
  private slotLit: boolean[] = [];
  private slotShade: number[] = [];
  /** How many of the slot row's cells are the kit's own powers; the one after them is the saber. */
  private kitSlotCount = 0;
  private saberEl: HTMLElement | null = null;
  private saberCost: HTMLElement | null = null;
  private saberLit = false;
  private saberCostText = '';
  /**
   * The bars and the charge as last written, in the steps of `HUD_TUNE`. `NaN` is "nothing written
   * yet", because it is the one value that is never equal to itself: -1 is a number a health that
   * has gone below zero really rounds to, and that reading would then never be written.
   */
  private hpDrawn = NaN;
  private hpTextDrawn = NaN;
  private resShown = true;
  private resDrawn = NaN;
  private resTextDrawn = NaN;
  private resLabelDrawn = '';
  private chargeShown = false;
  private chargeDrawn = NaN;
  private hurtLevel = 0;
  private hurtDrawn = NaN;
  private lastFps = performance.now();
  private frames = 0;
  /** DOM writes counted for `__debug`: this second so far, and the last full second. */
  private writes = 0;
  private byDesign = 0;
  private windowStart = performance.now();
  private lastWrites = 0;
  private lastByDesign = 0;
  private readonly statsOut: HudStats = { writes: 0, byDesign: 0, seconds: 0, writesNow: 0, byDesignNow: 0 };
  /** What `tune` hands back: a copy, filled in place, so the console cannot hold the live table. */
  private readonly tuneOut: typeof HUD_TUNE = { ...HUD_TUNE };

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
    this.resBar = q('.bar.res');
    this.resFill = q('.res .fill');
    this.resText = q('.res .text');
    this.slotsEl = q('.slots');
    this.help = q('.help');
    this.crosshair = q('.crosshair');
    this.chargeEl = q('.charge');
    this.chargeFill = q('.charge .fill');
    this.mouseFree = q('.mouse-free');
    this.prompt = q('.prompt');
    this.hurtEl = q('.hurt');
    // A bar's fill grows by a transform rather than by its width: a width is laid out again every time
    // it changes, a scale is not. The fill is left at its full length and squeezed from the left, which
    // paints exactly what a part-width fill painted, gradient and all.
    for (const fill of [this.hpFill, this.resFill]) {
      fill.style.width = '100%';
      fill.style.transformOrigin = 'left center';
      fill.style.transform = 'scaleX(0)';
      fill.style.transition = 'transform 0.08s linear';
    }
  }

  /** A quiet line when the weather is not the shared schedule's (held, swapped, forced); empty hides it. Cheap to call every frame. */
  setWeatherNote(text: string): void {
    // Compared against what was written, not against the element: this is called every frame, and an
    // object that remembers what it put somewhere need never ask for it back.
    if (this.weatherNoteText === text) return;
    this.weatherNoteText = text;
    this.weatherNote.textContent = text;
    this.weatherNote.hidden = text === '';
    this.writes += 2;
  }

  setPlanet(p: PlanetDef): void {
    this.planetName.textContent = p.name;
    this.planetTag.textContent = p.tagline;
    this.byDesign += 2;
  }

  /**
   * The class in play: its name, its number slots, its help. A rebuild of the row, so every write
   * here is counted apart as one that is meant to happen -- counted where each one is made, so the
   * figure is the number and not an estimate of it.
   */
  setKit(kit: Kit): void {
    this.className.textContent = kit.name;
    this.slotsEl.innerHTML = '';
    this.byDesign += 2;
    this.slots = [];
    this.slotCds = [];
    this.slotLit = [];
    this.slotShade = [];
    for (const s of kit.slots) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="cd"></div><span class="key">${s.key}</span><span class="name">${s.name}</span><span class="cost">${s.cost}</span>`;
      this.slotsEl.appendChild(el);
      this.byDesign += 3;
      this.slots.push(el);
      this.slotCds.push(el.firstElementChild as HTMLElement);
      this.slotLit.push(false);
      this.slotShade.push(0);
    }
    this.kitSlotCount = this.slots.length;
    const saber = document.createElement('div');
    saber.className = 'slot saber';
    saber.innerHTML = `<div class="cd"></div><span class="key">L</span><span class="name">Lightsaber</span><span class="cost">off</span>`;
    saber.hidden = kit.id !== 'jedi';
    this.slotsEl.appendChild(saber);
    this.byDesign += 4;
    this.slots.push(saber);
    this.slotCds.push(saber.firstElementChild as HTMLElement);
    this.slotLit.push(false);
    this.slotShade.push(0);
    this.saberEl = saber;
    this.saberCost = saber.querySelector<HTMLElement>('.cost');
    this.saberLit = false;
    this.saberCostText = 'off';
    this.help.innerHTML = [...COMMON_HELP, ...kit.help].map((l) => `<div>${l}</div>`).join('');
    // The crosshair is the Bounty Hunter's. Whether it is wanted while a ship is flown is the flight
    // display's business, not this file's: nothing here knows that a ship is being flown.
    this.crosshair.hidden = kit.id !== 'bounty_hunter';
    this.byDesign += 2;
    // A new kit's bars and charge are written again whatever they held for the last one.
    this.hpDrawn = NaN;
    this.hpTextDrawn = NaN;
    this.resDrawn = NaN;
    this.resTextDrawn = NaN;
    this.resLabelDrawn = '';
    this.chargeDrawn = NaN;
  }

  setPrompt(text: string): void {
    // What the prompt holds is remembered here: reading it back off the element serialises the whole
    // subtree to a string, which is a good deal dearer than the comparison it was there to save.
    if (this.promptText === text) return;
    this.promptText = text;
    this.prompt.innerHTML = text;
    this.writes++;
  }

  /** A quiet note that the pointer is loose, instead of a menu over the whole game. */
  setMouseFree(free: boolean): void {
    if (free === this.mouseFreeDrawn) return;
    this.mouseFreeDrawn = free;
    this.mouseFree.classList.toggle('hidden', !free);
    this.crosshair.classList.toggle('hidden', free);
    this.writes += 2;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
    this.byDesign++;
  }

  hurt(): void {
    this.hurtLevel = 1;
  }

  /**
   * What the display wrote to the DOM in the last full second, for `__debug`: `writes` is what a
   * steady frame should not be doing at all and reads 0 when nothing on the screen has changed;
   * `byDesign` is the four-times-a-second clock, `/loc` and frame-rate lines and a rebuild of the
   * slot row, which are meant to happen. The object is filled in place and handed back, so asking
   * costs nothing.
   */
  stats(): HudStats {
    const s = this.statsOut;
    s.writes = this.lastWrites;
    s.byDesign = this.lastByDesign;
    s.seconds = (performance.now() - this.windowStart) / 1000;
    s.writesNow = this.writes;
    s.byDesignNow = this.byDesign;
    return s;
  }

  /**
   * Try one of the invented write steps live; with nothing given it only reports them. Only the
   * four names above are taken, and anything else is said out loud rather than swallowed; what comes
   * back is a copy, filled in place, so the console holds a reading and not the table itself.
   */
  tune(next?: Partial<typeof HUD_TUNE>): typeof HUD_TUNE {
    let took = false;
    if (next) {
      for (const key of Object.keys(next)) {
        const value = (next as Record<string, unknown>)[key];
        if (!(TUNE_KEYS as readonly string[]).includes(key)) {
          console.warn(`hud.tune: no step called ${key}; the steps are ${TUNE_KEYS.join(', ')}`);
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          console.warn(`hud.tune: ${key} wants a number above zero, not ${String(value)}`);
          continue;
        }
        HUD_TUNE[key as keyof typeof HUD_TUNE] = value;
        took = true;
      }
    }
    // Whatever was drawn at the old steps is written again at the new ones.
    if (took) {
      this.hpDrawn = NaN;
      this.resDrawn = NaN;
      this.chargeDrawn = NaN;
      this.hurtDrawn = NaN;
      for (let i = 0; i < this.slotShade.length; i++) this.slotShade[i] = NaN;
    }
    const out = this.tuneOut;
    for (const key of TUNE_KEYS) out[key] = HUD_TUNE[key];
    return out;
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
      this.byDesign += 3;
    }
    if (now - this.windowStart >= 1000) {
      this.lastWrites = this.writes;
      this.lastByDesign = this.byDesign;
      this.writes = 0;
      this.byDesign = 0;
      this.windowStart = now;
    }
    // A bar is written only when its share has moved by a pixel of the bar's own length, and its
    // number only when the number itself has changed.
    const px = HUD_TUNE.barPixels;
    // The share is held between none and all: a bar told a share outside that wrote a length the
    // browser threw away, which left the last one on the screen.
    const hpShare = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const hpSteps = Math.round(hpShare * px);
    if (hpSteps !== this.hpDrawn) {
      this.hpDrawn = hpSteps;
      this.hpFill.style.transform = `scaleX(${hpSteps / px})`;
      this.writes++;
    }
    const hpShown = Math.ceil(hp);
    if (hpShown !== this.hpTextDrawn) {
      this.hpTextDrawn = hpShown;
      this.hpText.textContent = `Health ${hpShown}`;
      this.writes++;
    }
    const r = kit.resource;
    if (!!r !== this.resShown) {
      this.resShown = !!r;
      this.resBar.hidden = !r;
      this.writes++;
    }
    if (r) {
      const share = r.max > 0 ? Math.max(0, Math.min(1, r.value / r.max)) : 0;
      const steps = Math.round(share * px);
      if (steps !== this.resDrawn) {
        this.resDrawn = steps;
        this.resFill.style.transform = `scaleX(${steps / px})`;
        this.writes++;
      }
      const shown = Math.round(r.value);
      if (shown !== this.resTextDrawn || r.label !== this.resLabelDrawn) {
        this.resTextDrawn = shown;
        this.resLabelDrawn = r.label;
        this.resText.textContent = `${r.label} ${shown}`;
        this.writes++;
      }
    }
    // The slot row: `kit.slots` is the kit's own array and is not rebuilt here, and the row's own
    // count is used rather than the kit's, so a loadout changed without the row being rebuilt cannot
    // reach past the end of it.
    const steps = HUD_TUNE.cooldownSteps;
    for (let i = 0; i < this.kitSlotCount; i++) {
      const lit = kit.slotActive(i);
      if (lit !== this.slotLit[i]) {
        this.slotLit[i] = lit;
        this.slots[i].classList.toggle('active', lit);
        this.writes++;
      }
      const shade = Math.round(kit.slotCooldown(i) * steps);
      if (shade !== this.slotShade[i]) {
        this.slotShade[i] = shade;
        this.slotCds[i].style.height = `${(shade / steps) * 100}%`;
        this.writes++;
      }
    }
    // A charging shot: a bar filling under the crosshair.
    const charge = kit.charge?.() ?? 0;
    const charging = charge > 0;
    if (charging !== this.chargeShown) {
      this.chargeShown = charging;
      this.chargeEl.hidden = charge <= 0;
      this.writes++;
    }
    if (charging) {
      const filled = Math.round(charge * HUD_TUNE.chargeSteps);
      if (filled !== this.chargeDrawn) {
        this.chargeDrawn = filled;
        this.chargeFill.style.width = `${(filled / HUD_TUNE.chargeSteps) * 100}%`;
        this.writes++;
      }
    }
    const saber = this.saberEl;
    if (saber && !saber.hidden) {
      if (saberOn !== this.saberLit) {
        this.saberLit = saberOn;
        saber.classList.toggle('active', saberOn);
        this.writes++;
      }
      const cost = saberOn ? 'on' : 'off';
      if (this.saberCost && cost !== this.saberCostText) {
        this.saberCostText = cost;
        this.saberCost.textContent = cost;
        this.writes++;
      }
    }
    if (this.hurtLevel > 0) {
      this.hurtLevel = Math.max(0, this.hurtLevel - dt * 2);
      const shown = Math.round(this.hurtLevel * HUD_TUNE.hurtSteps);
      if (shown !== this.hurtDrawn) {
        this.hurtDrawn = shown;
        this.hurtEl.style.opacity = `${shown / HUD_TUNE.hurtSteps}`;
        this.writes++;
      }
    }
  }
}
