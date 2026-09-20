import type { Kit } from '../combat/kit';
import type { PlanetDef } from '../data/planets';
import { HUD_SIZES } from './hudMath.ts';
import { glyphFor, handGlyph, iconCount, installIcons } from './hudIcons.ts';

/**
 * The help block's common lines, as actions rather than letters. The block used to spell ten key
 * letters into its own text, which went wrong the moment any of them was rebound; now the words are
 * here and every letter comes from the bindings, so the block follows a rebind like the cells do.
 * `%s` takes the next action's key in turn.
 */
const HELP_LINES: readonly { text: string; actions: readonly string[]; move?: boolean }[] = [
  { text: 'move · mouse look · wheel zoom · %s jump · %s walk', actions: ['jump', 'walk'], move: true },
  { text: '%s mount and dismount · %s switch class · %s fast-forward time', actions: ['mount', 'switchClass', 'fastForward'] },
  { text: '%s galaxy map · %s inventory · %s spawner · %s help · %s noclip · Esc frees the mouse', actions: ['map', 'inventory', 'spawner', 'help', 'noclip'] },
  { text: 'Esc → Controls rebinds every one of these, and the display follows at once', actions: [] },
];

/**
 * The four words in the corner strip, as actions rather than letters. The strip used to spell M, I,
 * B and H into its own markup, which went wrong the moment any of the four was rebound — the same
 * fault the help block had, four lines above it in the same file.
 */
const HINT_ACTIONS: readonly { action: string; word: string }[] = [
  { action: 'map', word: 'Map' },
  { action: 'inventory', word: 'Inventory' },
  { action: 'spawner', word: 'Spawner' },
  { action: 'help', word: 'Help' },
];

/**
 * How finely a value has to change before the display writes it to the DOM, and what a bar's fill is
 * measured in. Every number here is INVENTED; they are kept together so there is one place to look,
 * and they are live through `Hud.tune` so a value can be tried without a reload. None of them decides
 * what is drawn, only how often a write happens, or how bright one stroke is: the worst a wrong one
 * can do is cost a write, or hold a value one step longer than it might have.
 *
 * `barPixels` is how finely a bar's share is compared. The on-foot bars are `HUD_SIZES.healthBarW`
 * wide (160 at scale 1), so 320 steps is half a pixel of the bar's own length; the step is kept at
 * what it was before this pass, so what reaches the screen is what reached it before. The rest are
 * the steps the display already rounded to (`toFixed(0)` on a percentage is a step of 100).
 *
 * `cooldownSteps` is the one that is also a look: the cell's wedge is drawn from a number written in
 * these steps, so 100 of them is a wedge that moves in 3.6-degree jumps and costs at most a hundred
 * writes over a whole cooldown, and nothing at all while no cooldown is running. A steady second is
 * still 0 writes; a second with a cooldown in it is not steady and is not meant to read as 0.
 *
 * The two alphas are the crosshair's ticks, at rest and while a shot is being aimed. They are here
 * rather than in `hudMath` because they are this file's own drawing and not a size anything else
 * measures against.
 */
export const HUD_TUNE = {
  barPixels: 320,
  cooldownSteps: 100,
  chargeSteps: 100,
  hurtSteps: 100,
  /**
   * Invented: the crosshair's ticks at rest, and while the right mouse holds a tighter aim. These
   * two are the only steps here that may be set to 0 — the overlay draws nothing at all at an alpha
   * of nothing, which is how to ask whether the ticks are wanted at all without an edit.
   */
  tickAlpha: 0.8,
  aimTickAlpha: 1,
};

/** The two steps above that a value of 0 is a real answer for; every other one wants a number above it. */
const ZERO_OK: readonly string[] = ['tickAlpha', 'aimTickAlpha'];

/**
 * The keys `tune` takes. A key that is not one of these is a mistake at the console, and saying so is
 * worth more than quietly accepting it: `Object.assign` took `{ barPixel: 1 }` without a word.
 */
const TUNE_KEYS = ['barPixels', 'cooldownSteps', 'chargeSteps', 'hurtSteps', 'tickAlpha', 'aimTickAlpha'] as const;

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

/** What this file draws on the overlay: the part of `HudCanvas` it needs, declared structurally. */
export interface HudOverlay {
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number): void;
  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, colour: number, alpha: number): void;
  ring(cx: number, cy: number, r: number, width: number, colour: number, alpha: number): void;
}

/** The palette indices this file draws in; the palette's own `COL` satisfies it. */
export interface HudColours {
  readonly ink: number;
  readonly accent: number;
  readonly muted: number;
  readonly void: number;
  readonly hot: number;
  readonly good: number;
}

/** Where the keys on the cells come from: the game's own `Input` satisfies it. */
export interface HudBindings {
  readonly bindings: Record<string, string[]>;
}

/** What a hand is holding, as the rack keeps it (`WeaponDef`), declared structurally. */
export interface HandItem {
  readonly id?: string;
  readonly name?: string | null;
  readonly class?: string;
  readonly icon?: string | null;
}

/** Where the hands read from: the live object the player keeps, and how an item becomes a picture. */
export interface HandSource {
  readonly equipped: { right: HandItem | null; left: HandItem | null };
  icon(item: HandItem): string | null;
}

/** Every live display, so a rebind in the Controls page reaches the cells at once. */
const LIVE: Hud[] = [];

/**
 * The bindings changed: every display puts the new keys on its cells and in its help. Called by
 * whoever rebinds — one line in the Controls page. Nothing breaks without it: the cells notice a
 * changed binding at the four-times-a-second tick anyway, and this only makes it immediate.
 */
export function hudBindingsChanged(): void {
  for (const hud of LIVE) hud.refreshKeys(true);
}

/** A cell in the number row: its key-cap, and what was last written to it. */
interface SlotCell {
  root: HTMLElement;
  cap: HTMLElement;
  /** The action whose key it shows, and the code that action was bound to when it was written. */
  action: string;
  code: string;
  lit: boolean;
  ready: boolean;
  /** How far through its cooldown it is, as the last frame read it, and as the cell last wore it. */
  cool: number;
  coolDrawn: number;
}

/** One of the two hands. */
interface HandCell {
  root: HTMLElement;
  pic: HTMLElement;
  name: HTMLElement;
  /** The item last shown, by identity, and the words and the picture written for it. */
  item: HandItem | null;
  label: string;
  glyph: string;
}

/**
 * One of the two on-foot bars. The ghost costs two writes a fall and nothing at all otherwise: while
 * it is not easing it carries `snap` — the stylesheet's "no transition" — and is written straight to
 * the fill's own value, where it sits behind the fill and is never seen; a fall takes `snap` off and
 * writes the new value, and the stylesheet walks it down from where the bar was over `ghostSeconds`.
 */
interface BodyBar {
  fill: HTMLElement;
  ghost: HTMLElement;
  /** The fill and the ghost as last written, in steps of `barPixels`; NaN is "nothing written yet". */
  cur: number;
  ghostAt: number;
  snap: boolean;
  ghostFor: number;
}

/**
 * The slow half of the head-up display: the planet block, the clock and the frame rate, the weather
 * note, the on-foot bars, the number slots with the keys you have bound, what is in each hand, the
 * crosshair and its charge, the prompt, the hurt fade, the help block and the mouse-free line. The
 * flight display -- the reticle, the aim circle and the target's bracket -- is `ShipHud`'s, drawn on
 * the same overlay canvas; nothing here knows about flying.
 *
 * Every value is written to the DOM only when what it shows has changed, and what was last written is
 * held in a field here rather than read back off the element. What moves every frame and is a shape
 * — the crosshair, the charge ring, a cooldown's sweep — is drawn on the overlay instead, where a
 * stroke costs nothing to repeat and no layout follows it.
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
  /** The corner strip: four words whose letters come from the bindings, like the help block's. */
  private readonly hint: HTMLElement;
  private hintText = '';
  private readonly className: HTMLElement;
  /** The body block, whose standing down is how this file knows the player is at a ship's controls. */
  private readonly bottom: HTMLElement;
  private readonly hp: BodyBar;
  private readonly hpText: HTMLElement;
  private readonly res: BodyBar;
  private readonly resRow: HTMLElement;
  private readonly resText: HTMLElement;
  private readonly slotsEl: HTMLElement;
  private readonly hands: HandCell[] = [];
  private readonly help: HTMLElement;
  /** The plain dot, which stands in for the drawn crosshair until the overlay is attached. */
  private readonly crosshair: HTMLElement;
  private readonly chargeEl: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly mouseFree: HTMLElement;
  private mouseFreeDrawn = false;
  private readonly prompt: HTMLElement;
  /** What the prompt holds, kept here rather than read back off the element: reading `innerHTML` serialises the whole subtree. */
  private promptText = '';
  private readonly hurtEl: HTMLElement;
  private readonly slots: SlotCell[] = [];
  /** How many of the slot row's cells are the kit's own powers; the one after them is the saber. */
  private kitSlotCount = 0;
  private saberEl: HTMLElement | null = null;
  private saberLit = false;
  /** The saber cell's own word, and what it says now: a cell that reads "off" with the blade out is worse than one that says nothing. */
  private saberCostEl: HTMLElement | null = null;
  private saberCostText = '';
  /** The class's own help lines, kept so the block can be written again when a key changes. */
  private kitHelp: readonly string[] = [];
  /**
   * What was last written, in the steps of `HUD_TUNE`. `NaN` is "nothing written yet", because it is
   * the one value that is never equal to itself: -1 is a number a health that has gone below zero
   * really rounds to, and that reading would then never be written.
   */
  private hpTextDrawn = NaN;
  private resShown = true;
  private resTextDrawn = NaN;
  private resLabelDrawn = '';
  private chargeShown = false;
  private chargeDrawn = NaN;
  private charge = 0;
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

  /** The overlay and the palette's indices, once they are attached; until then the plain dot shows. */
  private canvas: HudOverlay | null = null;
  private colours: HudColours | null = null;
  /** Where the keys on the cells come from, and what the hands read. */
  private input: HudBindings | null = null;
  private handSource: HandSource | null = null;
  private scale = 1;
  /** The ghost's ease as the page was last told it, so the stylesheet and `HUD_SIZES` cannot drift. */
  private ghostWritten = 0;
  /** Whether a crosshair is wanted at all, and whether the Jedi is one of the classes that gets one. */
  private crosshairWanted = true;
  private jediCrosshair = true;
  private jedi = false;
  /** The tighter, brighter crosshair while a shot is being aimed; set by whoever reads the input. */
  private aiming = false;
  /** What `report` hands back: one object, filled in place. */
  private readonly out = { ops: 0, icons: 0, keys: '', attached: false, crosshair: false, hands: '' };

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
        <div class="hint"></div>
      </div>
      <div class="crosshair"></div>
      <div class="charge" hidden><div class="fill"></div></div>
      <div class="mouse-free hidden">Mouse free · <b>click</b> to look again</div>
      <div class="prompt"></div>
      <div class="bottom">
        <div class="class-name"></div>
        <div class="hud-body">
          <div class="hud-brow hp-row">
            <div class="hud-bar hp"><div class="ghost snap"></div><div class="fill"></div></div>
            <div class="val hp-val"></div>
          </div>
          <div class="hud-brow res-row">
            <div class="hud-bar pool"><div class="ghost snap"></div><div class="fill"></div></div>
            <div class="val res-val"></div>
          </div>
        </div>
        <div class="hud-kit">
          <div class="slots"></div>
          <div class="hud-hands">
            <div class="hud-hand right"><span class="pic"></span><span class="name"></span></div>
            <div class="hud-hand left"><span class="pic"></span><span class="name"></span></div>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    this.planetName = q('.planet-name');
    this.planetTag = q('.planet-tag');
    this.loc = q('.loc');
    this.fps = q('.fps');
    this.weatherNote = q('.weather-note');
    this.clock = q('.clock');
    this.hint = q('.hint');
    this.className = q('.class-name');
    this.bottom = q('.bottom');
    this.hp = { fill: q('.hud-bar.hp > .fill'), ghost: q('.hud-bar.hp > .ghost'), cur: NaN, ghostAt: NaN, snap: true, ghostFor: 0 };
    this.hpText = q('.hp-val');
    this.res = { fill: q('.hud-bar.pool > .fill'), ghost: q('.hud-bar.pool > .ghost'), cur: NaN, ghostAt: NaN, snap: true, ghostFor: 0 };
    this.resRow = q('.res-row');
    this.resText = q('.res-val');
    this.slotsEl = q('.slots');
    this.help = q('.help');
    this.crosshair = q('.crosshair');
    this.chargeEl = q('.charge');
    this.chargeFill = q('.charge .fill');
    this.mouseFree = q('.mouse-free');
    this.prompt = q('.prompt');
    this.hurtEl = q('.hurt');
    for (const side of ['right', 'left'] as const) {
      const root = q(`.hud-hand.${side}`);
      root.hidden = true;
      this.hands.push({ root, pic: q(`.hud-hand.${side} .pic`), name: q(`.hud-hand.${side} .name`), item: null, label: '', glyph: '' });
    }
    LIVE.push(this);
    this.writeHint();
    // Everything the constructor puts on the page is the display's own markup and is not counted:
    // the two counts are about what it writes while the game is running, not about building itself.
    this.byDesign = 0;
    // The ghost's ease is one number (`HUD_SIZES.ghostSeconds`) and the stylesheet reads it, so the
    // timer this file runs and the walk the page draws can never say different things.
    this.syncGhost();
    // The glyphs, once. Nothing waits for them: a cell written before the sheet lands draws its mark
    // the moment it does, and a sheet that never lands costs the marks and nothing else.
    void installIcons();
  }

  // -------------------------------------------------------------------------------------------
  // What the game hands over once.

  /** The overlay to draw the shapes on, and the palette's indices. Until this the plain dot shows. */
  attach(canvas: HudOverlay, colours: HudColours): void {
    this.canvas = canvas;
    this.colours = colours;
    this.out.attached = true;
    // The plain dot and the charge bar are the unattached stand-ins; with a canvas the crosshair is
    // drawn instead, and the stylesheet takes those two elements off the screen for good.
    this.root.classList.toggle('drawn', true);
    this.byDesign++;
  }

  /** Where the keys on the cells come from. The cells and the help block take them at once. */
  setInput(input: HudBindings): void {
    this.input = input;
    this.refreshKeys(true);
  }

  /** What the hands read: the live object the player keeps, and how an item becomes a picture. */
  setHandSource(source: HandSource | null): void {
    this.handSource = source;
    for (const hand of this.hands) hand.item = null;
  }

  /** The HUD scale, for the shapes this file draws; the page's own sizes follow `--hud-scale`. */
  setScale(scale: number): void {
    const s = Math.max(HUD_SIZES.scaleMin, Math.min(HUD_SIZES.scaleMax, Number.isFinite(scale) ? scale : 1));
    if (s === this.scale) return;
    this.scale = s;
  }

  /** Whether a crosshair is drawn at all, and whether a Jedi gets one (the Bounty Hunter always has). */
  setCrosshair(on: boolean, forJedi = this.jediCrosshair): void {
    this.crosshairWanted = on;
    this.jediCrosshair = forJedi;
  }

  /** The tighter, brighter crosshair while a shot is being aimed (the right mouse held). */
  setAiming(on: boolean): void {
    this.aiming = on;
  }

  // -------------------------------------------------------------------------------------------
  // The slow DOM.

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
   * The class in play: its name, its number slots with the keys you have bound, its help. A rebuild
   * of the row, so every write here is counted apart as one that is meant to happen -- counted where
   * each one is made, so the figure is the number and not an estimate of it.
   */
  setKit(kit: Kit): void {
    this.className.textContent = kit.name;
    this.slotsEl.innerHTML = '';
    this.byDesign += 2;
    this.jedi = kit.id === 'jedi';
    this.slots.length = 0;
    for (const s of kit.slots) {
      // The number key an ability sits on is the slot's own (`KitSlot.key`), never its place in the
      // row: both classes drop an empty loadout entry, so the third cell of a loadout with a hole in
      // it is the fourth number key, and a cell that counted its own place would say 3.
      const action = `slot${s.key}`;
      const code = this.codeOf(action);
      const el = document.createElement('div');
      el.className = 'slot ready';
      // The ability's own name, for a mark that cannot be read at a glance: written once with the
      // cell and never again, and worth its one attribute whenever the mouse is free.
      el.setAttribute('title', s.name);
      // One write for the cell's whole inside: our own mark for the ability, the key you have bound,
      // and what it costs. The mark takes its colour from the cell, so it is never written again.
      el.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#${glyphFor(s.name)}"></use></svg><span class="key">${esc(keyLabel(code))}</span><span class="cost">${esc(s.cost)}</span>`;
      this.slotsEl.appendChild(el);
      this.byDesign += 4;
      this.slots.push({ root: el, cap: keyOf(el), action, code, lit: false, ready: true, cool: 0, coolDrawn: 0 });
    }
    this.kitSlotCount = this.slots.length;
    const saber = document.createElement('div');
    saber.className = 'slot saber ready';
    const saberCode = this.codeOf('saberToggle');
    saber.setAttribute('title', 'Lightsaber');
    saber.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-saber"></use></svg><span class="key">${esc(keyLabel(saberCode))}</span><span class="cost">off</span>`;
    saber.hidden = kit.id !== 'jedi';
    this.slotsEl.appendChild(saber);
    this.byDesign += 5;
    this.slots.push({ root: saber, cap: keyOf(saber), action: 'saberToggle', code: saberCode, lit: false, ready: true, cool: 0, coolDrawn: 0 });
    this.saberEl = saber;
    this.saberLit = false;
    // The cell's word is the blade's state, not a label: it said "off" with the blade lit before.
    this.saberCostEl = saber.querySelector<HTMLElement>('.cost');
    this.saberCostText = 'off';
    this.kitHelp = kit.help;
    this.writeHelp();
    // A new kit's bars and charge are written again whatever they held for the last one.
    this.hp.cur = NaN;
    this.hpTextDrawn = NaN;
    this.res.cur = NaN;
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

  /**
   * Something hurt the player: the red fade, which is this file's whole share of it. `from` is where
   * the blow came from in world metres, and nothing, or null, is a blow with no direction (a fall).
   *
   * The direction is taken and not used here on purpose. The arc on the side the blow came from is
   * the damage display's shape, and the game hands it the direction itself at the one place a blow
   * arrives, which is a shorter road than through this file; the argument stays so that a caller
   * holding only this display says where the blow came from rather than losing it, and so that the
   * fade and the arc can never be asked for in two different ways.
   */
  hurt(from?: { x: number; y: number; z: number } | null): void {
    void from;
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
   * What the on-foot half drew and what it is showing, for the console: a kept object. `keys` is the
   * row of key-caps as it stands, which is how a rebind is checked from a tab nobody can see;
   * `icons` is how many glyphs the page holds, which is 0 while the sheet is still on its way.
   */
  report(): { ops: number; icons: number; keys: string; attached: boolean; crosshair: boolean; hands: string } {
    const o = this.out;
    o.icons = iconCount();
    o.crosshair = this.crosshairShown();
    let keys = '';
    for (let i = 0; i < this.kitSlotCount; i++) keys += (keys ? ' ' : '') + keyLabel(this.slots[i].code);
    o.keys = keys;
    o.hands = `${this.hands[0].label || '—'} / ${this.hands[1].label || '—'}`;
    return o;
  }

  /**
   * Try one of the invented steps live; with nothing given it only reports them. Only the names
   * above are taken, and anything else is said out loud rather than swallowed; what comes back is a
   * copy, filled in place, so the console holds a reading and not the table itself.
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
        const floor = ZERO_OK.includes(key) ? 0 : 1e-9;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < floor) {
          console.warn(`hud.tune: ${key} wants a number ${floor > 0 ? 'above zero' : 'of zero or more'}, not ${String(value)}`);
          continue;
        }
        HUD_TUNE[key as keyof typeof HUD_TUNE] = value;
        took = true;
      }
    }
    // Whatever was drawn at the old steps is written again at the new ones.
    if (took) {
      this.hp.cur = NaN;
      this.res.cur = NaN;
      this.chargeDrawn = NaN;
      this.hurtDrawn = NaN;
    }
    const out = this.tuneOut;
    for (const key of TUNE_KEYS) out[key] = HUD_TUNE[key];
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // The keys on the cells.

  /** The first key bound to an action, or nothing. Allocates nothing. */
  private codeOf(action: string): string {
    const codes = this.input?.bindings[action];
    return codes && codes.length ? codes[0] : '';
  }

  /**
   * Put the keys that are bound now on the cells, and in the help block. Called when the bindings
   * change — at once through `hudBindingsChanged`, and in any case at the display's own
   * four-times-a-second tick, so a rebind reaches the cells whether or not whoever rebound said so.
   * `always` writes the help block even when no cap moved, which is what a fresh input wants.
   */
  refreshKeys(always = false): void {
    let moved = false;
    for (const cell of this.slots) {
      const code = this.codeOf(cell.action);
      if (code === cell.code) continue;
      cell.code = code;
      cell.cap.textContent = keyLabel(code);
      this.writes++;
      moved = true;
    }
    if (moved || always) {
      this.writeHelp();
      this.writeHint();
    }
  }

  /** The help block: the common lines with the keys that are bound now, then the class's own. */
  private writeHelp(): void {
    let html = '';
    for (const line of HELP_LINES) {
      let i = 0;
      const text = line.text.replace(/%s/g, () => `<b>${esc(keyLabel(this.codeOf(line.actions[i++] ?? '')))}</b>`);
      html += `<div>${line.move ? `<b>${esc(this.moveKeys())}</b> ` : ''}${text}</div>`;
    }
    for (const l of this.kitHelp) html += `<div>${l}</div>`;
    this.help.innerHTML = html;
    this.byDesign++;
  }

  /** The corner strip, with the keys that are bound now. Written with the help block and never in a frame. */
  private writeHint(): void {
    let html = '';
    for (const h of HINT_ACTIONS) {
      html += `${html ? ' &nbsp; ' : ''}<b>${esc(keyLabel(this.codeOf(h.action)))}</b> ${h.word}`;
    }
    if (html === this.hintText) return;
    this.hintText = html;
    this.hint.innerHTML = html;
    this.byDesign++;
  }

  /**
   * How long the bars' ghosts take to walk down, told to the page as a property the stylesheet's own
   * transition reads. One write at boot, and one more only if the number is changed live, so the
   * timer this file runs and the walk the page draws are always the same number.
   */
  private syncGhost(): void {
    const seconds = HUD_SIZES.ghostSeconds;
    if (seconds === this.ghostWritten) return;
    this.ghostWritten = seconds;
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root) setVar(root, '--hud-ghost', `${seconds}s`);
  }

  /** The four movement keys as one cap, "WASD" while they are still the defaults. */
  private moveKeys(): string {
    let s = '';
    for (const a of ['forward', 'left', 'back', 'right']) s += keyLabel(this.codeOf(a));
    return s;
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  update(dt: number, x: number, y: number, z: number, kit: Kit, hp: number, maxHp: number, clock: string, creatureName: string, saberOn: boolean): void {
    this.frames++;
    const now = performance.now();
    const acc = (now - this.lastFps) / 1000;
    if (acc >= 0.25) {
      this.lastFps = now;
      this.fps.textContent = `${Math.round(this.frames / acc)} fps`;
      // The nameplate over a creature's head says what you are looking at; with one, the corner says
      // where you are and nothing else. An empty name is how the game asks for that.
      this.loc.textContent = creatureName ? `/loc ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)} · nearby: ${creatureName}` : `/loc ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`;
      this.clock.textContent = clock;
      this.frames = 0;
      this.byDesign += 3;
      // A rebind nobody announced, what is in the hands, and the ghost's ease if it has been tried
      // at the console: none of the three is work for a frame, and four times a second is not one.
      this.refreshKeys();
      this.readHands();
      this.syncGhost();
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
    this.setBar(this.hp, maxHp > 0 ? hp / maxHp : 0, px);
    const hpShown = Math.ceil(hp);
    if (hpShown !== this.hpTextDrawn) {
      this.hpTextDrawn = hpShown;
      this.hpText.textContent = `Health ${hpShown}`;
      this.writes++;
    }
    const r = kit.resource;
    if (!!r !== this.resShown) {
      this.resShown = !!r;
      this.resRow.hidden = !r;
      this.writes++;
    }
    if (r) {
      this.setBar(this.res, r.max > 0 ? r.value / r.max : 0, px);
      const shown = Math.round(r.value);
      if (shown !== this.resTextDrawn || r.label !== this.resLabelDrawn) {
        this.resTextDrawn = shown;
        this.resLabelDrawn = r.label;
        this.resText.textContent = `${r.label} ${shown}`;
        this.writes++;
      }
    }
    // The ghosts' eases ending: once a frame, and nothing is written in a steady one.
    this.ageBars(dt);
    // The slot row: `kit.slots` is the kit's own array and is not rebuilt here, and the row's own
    // count is used rather than the kit's, so a loadout changed without the row being rebuilt cannot
    // reach past the end of it.
    for (let i = 0; i < this.kitSlotCount; i++) {
      const cell = this.slots[i];
      const lit = kit.slotActive(i);
      if (lit !== cell.lit) {
        cell.lit = lit;
        cell.root.classList.toggle('active', lit);
        this.writes++;
      }
      // How far through a cooldown a cell is, is one number on the cell, which the stylesheet draws
      // as a dark wedge turning clockwise from twelve. It is written only when it has moved by a
      // step, so a whole cooldown costs at most `cooldownSteps` writes and a cell with none costs
      // nothing at all. It is not drawn on the overlay: the overlay is the first child of the
      // interface layer, so every cell paints over it and the sweep would be under the cell.
      const steps = Math.max(1, HUD_TUNE.cooldownSteps);
      cell.cool = Math.round(Math.max(0, Math.min(1, kit.slotCooldown(i))) * steps) / steps;
      const ready = cell.cool <= 0;
      if (ready !== cell.ready) {
        cell.ready = ready;
        cell.root.classList.toggle('ready', ready);
        this.writes++;
      }
      if (cell.cool !== cell.coolDrawn) {
        cell.coolDrawn = cell.cool;
        setVar(cell.root, '--cool', `${cell.cool}`);
        this.writes++;
      }
    }
    // A charging shot: a ring round the crosshair, drawn on the overlay; with no overlay, the bar
    // the display has always had.
    this.charge = kit.charge?.() ?? 0;
    if (!this.canvas) this.writeChargeBar();
    const saber = this.saberEl;
    if (saber && !saber.hidden && saberOn !== this.saberLit) {
      this.saberLit = saberOn;
      saber.classList.toggle('active', saberOn);
      this.writes++;
      // And the word under the mark says which it is. One write a toggle, none otherwise.
      const word = saberOn ? 'on' : 'off';
      if (this.saberCostEl && word !== this.saberCostText) {
        this.saberCostText = word;
        this.saberCostEl.textContent = word;
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

  /**
   * One on-foot bar: the fill, and the ghost behind it. A fall leaves the ghost where the bar was
   * and lets the stylesheet walk it down; a rise, while no ease is running, takes the ghost with it
   * under the fill, where it cannot be seen. Nothing is written while nothing has moved.
   */
  private setBar(bar: BodyBar, share: number, px: number): void {
    const steps = Math.round(Math.max(0, Math.min(1, share)) * px);
    if (steps === bar.cur) return;
    const fell = bar.cur === bar.cur && steps < bar.cur;
    if (fell) {
      if (bar.snap) {
        bar.snap = false;
        bar.ghost.classList.toggle('snap', false);
        this.writes++;
      }
      bar.ghostFor = HUD_SIZES.ghostSeconds;
      this.writeGhost(bar, steps, px);
    } else if (bar.snap) {
      this.writeGhost(bar, steps, px);
    }
    bar.cur = steps;
    bar.fill.style.transform = `scaleX(${steps / px})`;
    this.writes++;
  }

  private writeGhost(bar: BodyBar, steps: number, px: number): void {
    if (steps === bar.ghostAt) return;
    bar.ghostAt = steps;
    bar.ghost.style.transform = `scaleX(${steps / px})`;
    this.writes++;
  }

  /** The two eases ending: the ghost is snapped back behind the fill, ready for the next fall. */
  private ageBars(dt: number): void {
    // The two are stepped by name rather than through a list: a list here would be a new array on
    // every frame the display runs, which is the one thing the frame path must never do.
    this.ageBar(this.hp, dt);
    this.ageBar(this.res, dt);
  }

  private ageBar(bar: BodyBar, dt: number): void {
    if (bar.ghostFor <= 0) return;
    bar.ghostFor -= dt;
    if (bar.ghostFor > 0 || bar.snap) return;
    bar.snap = true;
    bar.ghost.classList.toggle('snap', true);
    this.writes++;
    this.writeGhost(bar, bar.cur === bar.cur ? bar.cur : 0, HUD_TUNE.barPixels);
  }

  /** The charge bar under the crosshair, for as long as there is no overlay to draw the ring on. */
  private writeChargeBar(): void {
    const charging = this.charge > 0;
    if (charging !== this.chargeShown) {
      this.chargeShown = charging;
      this.chargeEl.hidden = !charging;
      this.writes++;
    }
    if (!charging) return;
    const filled = Math.round(this.charge * HUD_TUNE.chargeSteps);
    if (filled !== this.chargeDrawn) {
      this.chargeDrawn = filled;
      this.chargeFill.style.width = `${(filled / HUD_TUNE.chargeSteps) * 100}%`;
      this.writes++;
    }
  }

  /** What is in each hand: read by identity, so nothing is written while nothing has changed. */
  private readHands(): void {
    const src = this.handSource;
    if (!src) return;
    for (let i = 0; i < this.hands.length; i++) {
      const hand = this.hands[i];
      const item = i === 0 ? src.equipped.right : src.equipped.left;
      if (item === hand.item) continue;
      hand.item = item;
      if (!item) {
        if (!hand.root.hidden) {
          hand.root.hidden = true;
          this.writes++;
        }
        hand.label = '';
        hand.glyph = '';
        continue;
      }
      if (hand.root.hidden) {
        hand.root.hidden = false;
        this.writes++;
      }
      const label = item.name || wordsOf(item.id ?? '');
      if (label !== hand.label) {
        hand.label = label;
        hand.name.textContent = label;
        this.writes++;
      }
      // Its own picture where the rack has one, and one of our glyphs where it has none. One write
      // for either, and only when what is in the hand has changed.
      const url = src.icon(item);
      const glyph = url ? `img:${url}` : handGlyph(item.class, label);
      if (glyph !== hand.glyph) {
        hand.glyph = glyph;
        hand.pic.innerHTML = url ? `<img src="${esc(url)}" alt="">` : `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#${glyph}"></use></svg>`;
        this.writes++;
      }
    }
  }

  /**
   * The body block stands down while the player is at a ship's controls, and so does the crosshair.
   * The class is the one the game already toggles there, so this needs no second signal — and a
   * stand-in page in a test has no `contains`, where the answer is simply no.
   */
  private bodyHidden(): boolean {
    const list = this.bottom.classList as { contains?: (name: string) => boolean };
    return typeof list.contains === 'function' ? list.contains('hidden') : false;
  }

  private crosshairShown(): boolean {
    if (!this.crosshairWanted || this.mouseFreeDrawn) return false;
    if (this.bodyHidden()) return false;
    return this.jedi ? this.jediCrosshair : true;
  }

  /**
   * The shapes, on the overlay, after the world is drawn: the crosshair and its charge ring. One
   * call a frame, and none at all while the game is not simulating — the caller does not call it
   * then, and the canvas is cleared once instead. A cooldown is not here: the cells paint over the
   * overlay, so the sweep is the cell's own, one number written on it when it moves.
   *
   * Nothing is allocated: every call takes numbers and a colour index.
   */
  draw(): void {
    const c = this.canvas;
    const col = this.colours;
    this.out.ops = 0;
    if (!c || !col) return;
    const s = this.scale;
    const S = HUD_SIZES;
    if (this.crosshairShown()) {
      const cx = Math.round(window.innerWidth / 2);
      const cy = Math.round(window.innerHeight / 2);
      const aim = this.aiming;
      // Aiming draws the same crosshair tighter and brighter: the ticks come in and the dot narrows,
      // which reads as the shot closing up without a second shape to learn.
      // `dotRadius` is the dot's width on the screen, 3 px at scale 1. A circle stroked at half its
      // own radius is a filled disc, and the dark under-stroke round it is the ring the design asks
      // for; drawn as a hollow circle of that radius the middle was empty and it read as a doughnut
      // twice the size.
      const dot = S.dotRadius * s * (aim ? 0.8 : 1);
      const from = S.footTickFrom * s * (aim ? 0.7 : 1);
      const len = S.footTickLen * s;
      const alpha = aim ? HUD_TUNE.aimTickAlpha : HUD_TUNE.tickAlpha;
      const width = S.boresightWidth * s;
      c.ring(cx, cy, dot / 4, dot / 2, col.ink, 1);
      c.line(cx - from - len, cy, cx - from, cy, width, col.ink, alpha);
      c.line(cx + from, cy, cx + from + len, cy, width, col.ink, alpha);
      c.line(cx, cy - from - len, cx, cy - from, width, col.ink, alpha);
      c.line(cx, cy + from, cx, cy + from + len, width, col.ink, alpha);
      this.out.ops += 5;
      if (this.charge > 0) {
        const r = S.chargeRadius * s;
        const w = S.chargeWidth * s;
        c.ring(cx, cy, r, w, col.muted, 0.35);
        // Clockwise from twelve, and a charge that is full burns rather than sitting in the cool
        // colour, so a held shot says when it is worth letting go.
        c.arc(cx, cy, r, 0, 360 * Math.min(1, this.charge), w, this.charge >= 1 ? col.hot : col.accent, 0.95);
        this.out.ops += 2;
      }
    }
  }

  /** A frame the overlay drew nothing on: the shape count goes to nothing with it. */
  idle(): void {
    this.out.ops = 0;
  }
}

/**
 * One custom property on an element. A stand-in for the page in a test need not have `setProperty`,
 * and a display that throws there would take the whole frame with it.
 */
function setVar(el: { style?: { setProperty?: (name: string, value: string) => void } }, name: string, value: string): void {
  const style = el.style;
  if (style && typeof style.setProperty === 'function') style.setProperty(name, value);
}

/** A cell's key-cap element. Built into the cell's own markup, so it is always there. */
function keyOf(cell: HTMLElement): HTMLElement {
  return cell.querySelector<HTMLElement>('.key') ?? cell;
}

/**
 * A key's code as a cap: "KeyW" is "W", "Digit1" is "1", "Mouse0" is "LMB", nothing at all is a
 * dash. It is shorter than the Controls page's own names on purpose — a cap is 22 px wide and
 * "Left mouse" does not fit in one — and it is here rather than borrowed from the menu because the
 * menu's names are for a list of rows and these are for a cap.
 */
export function keyLabel(code: string): string {
  if (!code) return '—';
  const mouse = MOUSE_CAPS[code];
  if (mouse) return mouse;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `N${m[1]}`;
  m = /^(Control|Shift|Alt|Meta)(Left|Right)$/.exec(code);
  if (m) return m[1] === 'Control' ? 'Ctrl' : m[1];
  m = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (m) return ARROW_CAPS[m[1]] ?? m[1];
  return NAMED_CAPS[code] ?? code;
}

// The three tables `keyLabel` reads are out here rather than inside it: the cells ask for a name at
// the display's own tick and a table built inside the call would be built again every time.
const MOUSE_CAPS: Record<string, string> = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5' };
const ARROW_CAPS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
const NAMED_CAPS: Record<string, string> = { Space: 'Space', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps', Escape: 'Esc' };

/** An id as words, for an item whose own name the game's tables never had. */
function wordsOf(id: string): string {
  return id.replace(/_/g, ' ').trim();
}

/** Anything that goes into markup: the five characters that would otherwise close a tag. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
