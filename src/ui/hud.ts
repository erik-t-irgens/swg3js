import type { Kit } from '../combat/kit';
// The game's own table of worlds, so a roster row names a planet and a zone the way the rest of the
// game names them rather than inventing words from an id. It is plain data and imports nothing.
import { PLANETS, type PlanetDef } from '../data/planets.ts';
import { HUD_SIZES, barBand, breathRow, clamp01, makeBreathRow } from './hudMath.ts';
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
  /**
   * The breath bar's own step, INVENTED like the rest and deliberately coarser than `barPixels`. The
   * two bars are told apart by what they do rather than by what they are: health arrives in blows and
   * wants half a pixel of the bar, so the size of a hit reads; breath is a slow drain and is written
   * once per pixel of the bar's own length (160 at scale 1), which is the finest a pixel can show.
   * A whole dive therefore costs at most 160 writes for the bar, spread over however long the breath
   * lasts, rather than 320.
   */
  breathPixels: 160,
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
const TUNE_KEYS = ['barPixels', 'breathPixels', 'cooldownSteps', 'chargeSteps', 'hurtSteps', 'tickAlpha', 'aimTickAlpha'] as const;

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

/**
 * A second bar's readout: a word, where it stands and what it stands out of. It is the shape the
 * class pool has always had (`Resource` in `src/combat/kit.ts`), declared structurally here so that
 * the breath row can take the same thing from whoever holds the player's breath without this file
 * learning anything about either of them.
 */
export interface BarReadout {
  readonly label: string;
  readonly value: number;
  readonly max: number;
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
  /**
   * The breath row: the bar, its number, and the row that carries both. It is the **first** row of
   * the body block, above the health bar, and that is a choice rather than an accident. The block is
   * anchored at the bottom of the screen and grows upward, so a row put in at the top moves nothing
   * that is already on the screen: the health bar, the class pool, the ability cells and the hands
   * all stay exactly where they were, and only the class's name above them is pushed up. A row put in
   * under the pool would have shifted both bars upward the moment you went under, which is the worst
   * possible time to move what someone is watching.
   *
   * It carries no ghost. The ghost behind the other two bars is there so the size of a *blow* reads,
   * and breath is not taken in blows: it drains. A ghost would ease down behind it on every frame of
   * a dive, would never once be seen, and would double the writes the row makes.
   */
  private readonly breathBar: HTMLElement;
  private readonly breathFill: HTMLElement;
  private readonly breathRowEl: HTMLElement;
  private readonly breathText: HTMLElement;
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
  /**
   * The breath row as it stands: whether it is up, the bar in steps of `breathPixels`, the number and
   * the word last written, and the band the fill wears (`''` is the resting one, which is no class at
   * all and so the bar's own colour). `NaN` is "nothing written yet", as it is for the other bars.
   */
  private breathShown = false;
  private breathCur = NaN;
  private breathTextDrawn = NaN;
  private breathLabelDrawn = '';
  /**
   * The band the bar is wearing. It starts at `good` rather than at nothing because the markup above
   * carries neither `warn` nor `bad`, which *is* the resting band: starting it empty would have the
   * row spend two writes on the frame it first comes up toggling two classes off that were never on.
   * It is deliberately not reset when the row goes down, since the element keeps its classes while it
   * is hidden and the two would then disagree.
   */
  private breathBandDrawn = 'good';
  /** What `breathRow` fills, kept so that asking about breath allocates nothing in a frame. */
  private readonly breathOut = makeBreathRow();
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
  private readonly out = { ops: 0, icons: 0, keys: '', attached: false, crosshair: false, hands: '', breath: '' };

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
          <div class="hud-brow breath-row" hidden>
            <div class="hud-bar breath"><div class="fill"></div></div>
            <div class="val breath-val"></div>
          </div>
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
    this.breathRowEl = q('.breath-row');
    this.breathBar = q('.hud-bar.breath');
    this.breathFill = q('.hud-bar.breath > .fill');
    this.breathText = q('.breath-val');
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
   * `breath` is the breath row as it reads, and an empty string while the row is down, which is the
   * only way to see it at all from a tab nobody is looking at.
   */
  report(): { ops: number; icons: number; keys: string; attached: boolean; crosshair: boolean; hands: string; breath: string } {
    const o = this.out;
    o.icons = iconCount();
    o.crosshair = this.crosshairShown();
    o.breath = this.breathShown ? `${this.breathLabelDrawn} ${this.breathTextDrawn}` : '';
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
      this.breathCur = NaN;
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

  /**
   * One frame of the slow half. `breath` is the player's own breath if they have any to show, and
   * nothing at all otherwise — which is what dry land hands over, and what every caller written
   * before there was breath hands over by leaving the argument off.
   */
  update(dt: number, x: number, y: number, z: number, kit: Kit, hp: number, maxHp: number, clock: string, creatureName: string, saberOn: boolean, breath?: BarReadout | null): void {
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
    // Breath, which is a row that is not there at all on dry land and costs such a frame nothing.
    this.setBreath(breath ?? null);
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

  /**
   * The breath row. It stands while there is breath to show and it is not full (`breathRow` in
   * `hudMath`), and it is not on the page at all otherwise — a frame on dry land reaches the first
   * line, finds the row down and already down, and writes nothing.
   *
   * What it costs while it is up: the row appearing is one write, then one per pixel of the bar's own
   * length as it drains (`HUD_TUNE.breathPixels`), one per change of the number beside it, two on
   * each of the at most two changes of band, and one as the row goes down again. Nothing is compared
   * against the page: what was written is remembered here, as everywhere else in this file.
   *
   * The band is two class toggles rather than one because the resting colour is no class at all —
   * the bar wears the interface's own accent from `.hud-bar > .fill`, which is the stylesheet's
   * default and the one colour on the block that is neither health nor the class pool.
   */
  private setBreath(r: BarReadout | null): void {
    const b = breathRow(r ? r.value : 0, r ? r.max : 0, this.breathOut);
    const show = !!r && b.show;
    if (show !== this.breathShown) {
      this.breathShown = show;
      this.breathRowEl.hidden = !show;
      this.writes++;
      // Whatever it held when it went down is written again from scratch the next time it comes up,
      // so a row that comes back never shows the last dive's number for a frame.
      if (!show) {
        this.breathCur = NaN;
        this.breathTextDrawn = NaN;
        this.breathLabelDrawn = '';
      }
    }
    if (!show || !r) return;
    const px = Math.max(1, HUD_TUNE.breathPixels);
    const steps = Math.round(b.share * px);
    if (steps !== this.breathCur) {
      this.breathCur = steps;
      this.breathFill.style.transform = `scaleX(${steps / px})`;
      this.writes++;
    }
    if (b.band !== this.breathBandDrawn) {
      this.breathBandDrawn = b.band;
      this.breathBar.classList.toggle('warn', b.band === 'warn');
      this.breathBar.classList.toggle('bad', b.band === 'bad');
      this.writes += 2;
    }
    // Ceiling, not rounding, and for the health bar's own reason two centimetres below it: a thing
    // that is still there must never read nought. Rounded, the last half-second of air says "0".
    const shown = Math.ceil(r.value);
    if (shown !== this.breathTextDrawn || r.label !== this.breathLabelDrawn) {
      this.breathTextDrawn = shown;
      this.breathLabelDrawn = r.label;
      this.breathText.textContent = `${r.label} ${shown}`;
      this.writes++;
    }
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

// ===================================================================================================
// The group's roster.
//
// The people you are grouped with, down the right-hand side under the corner block: a name, a health
// bar, and on the right either how far away they are, or where they are when that is not this world,
// or nothing at all while the group has not heard from them. It is built the way the rest of this
// file is built — a pool of rows made once and never grown, every value compared against what the
// row is showing and written only when it has changed — so a frame in which nothing has moved writes
// nothing at all and allocates nothing, and the node test measures both rather than taking their
// word for it.
//
// What somebody says is not here. The message line in the bottom left already holds a line for eight
// seconds and fades it, and the chat page already routes what was said on to it; a second log beside
// it would put every line up twice.

/**
 * Every number the roster runs on. All of them are INVENTED except the row count, which is the
 * group's own cap, and they are live through `Roster.tune` so one can be tried without a reload.
 * None of them decides what is shown, only how finely a value is compared before it is written and
 * where the block sits, so the worst a wrong one can do is cost a write or move the block.
 *
 * `rows` is read once, when the roster is built: the rows are made then and never grown, as the
 * message line's pool is. `barPixels` is how finely a row's health bar is compared, in steps of the
 * bar's own length. `metreStep`, `coarseFrom` and `farStep` are how finely a distance is compared —
 * a metre while someone is close, and 25 m once they are 200 m off, where a metre either way is not
 * worth a write — and `kmFrom` is where the distance reads in kilometres instead, rounded to a
 * tenth, which is what the comparison uses above it so the number compared and the words written can
 * never disagree. `top`, `side` and `width` are the block's placement in CSS pixels; `top` is a plain
 * number because the corner block it sits under is placed in plain pixels too, while the block's own
 * insides follow `--hud-scale` like the rest of the instrument. `showAlone` is 1 to keep the roster
 * up while you are the only one in it, which is how to look at it without a second browser.
 */
export const ROSTER_TUNE = {
  /** The group's cap, which is the owner's decision and not ours: up to eight. */
  rows: 8,
  barPixels: 160,
  metreStep: 1,
  coarseFrom: 200,
  farStep: 25,
  kmFrom: 1000,
  top: 96,
  side: 12,
  width: 168,
  showAlone: 0,
};

/** The keys `Roster.tune` takes; anything else is a mistake at the console and is said out loud. */
const ROSTER_KEYS = ['rows', 'barPixels', 'metreStep', 'coarseFrom', 'farStep', 'kmFrom', 'top', 'side', 'width', 'showAlone'] as const;

/**
 * The steps above that may be 0. `showAlone` is a switch: 0 hides the roster while you are alone in
 * it, 1 keeps it up. `top` and `side` are placements in pixels, and 0 is a perfectly good answer for
 * either — flush against the corner — so they are not held above zero the way a step that divides is.
 * `width` is not here: a block no pixels wide is a mistake, not a placement.
 */
const ROSTER_ZERO_OK: readonly string[] = ['showAlone', 'top', 'side'];

/**
 * A member of the group as the roster shows them, declared structurally: it is the shape the group
 * itself keeps, so the display is handed that list and adapts nothing. This file works out nothing
 * about anybody — it writes what it is given.
 *
 * `distance` below zero is not by itself "another world". The group sets it below zero for three
 * different reasons — they are elsewhere, their browser has gone quiet, or nothing has been heard of
 * them yet — and only the first of those is a world worth naming. So the row that is marked `me`
 * carries the world this browser is on, and a member is shown as elsewhere only when their own
 * `planet` and `zone` differ from it; the rest stand under one plain word. A `hp` below zero is a
 * health nothing carries yet, and the bar stands empty rather than reading as a member at death's
 * door.
 */
export interface RosterMember {
  /** Who the row is, as the group names them; never drawn. */
  readonly id: number | string;
  readonly name: string;
  /** Health as a share of their own full, 0 to 1, or below zero while nothing carries it. */
  readonly hp: number;
  /** The world they are on: a planet's id, and the zone's when they are in one. */
  readonly planet: string;
  readonly zone: string;
  /** Whoever leads. */
  readonly leader: boolean;
  /** This browser's own row, which is also where the world everyone else is compared against comes from. */
  readonly me: boolean;
  /** Metres away, or below zero; see above for the three things below zero can mean. */
  readonly distance: number;
  /**
   * Their line is open. The group's own field: false is a browser that is reloading or has gone
   * quiet, which keeps its place in the group and its row on the display, dimmed. Nothing has to
   * carry it — a list without it is read as everyone being here.
   */
  readonly here?: boolean;
  /** The same thing said outright, for anything that would rather say it that way than through `here`. */
  readonly away?: boolean;
}

/**
 * Which of the four things a row's right-hand column is saying. It is compared as a number and not
 * as the words themselves, so a row whose reading has not changed builds no string at all.
 * `AT_NOTHING` is your own row, which is not a distance from anywhere, and it is also what a row
 * starts as — a fresh row's column is empty, so a roster whose first group is only you writes
 * nothing into it.
 */
const AT_NOTHING = 0;
const AT_METRES = 1;
const AT_WORLD = 2;
const AT_AWAY = 3;

/**
 * A value let go when a step it was drawn through changed, so that the next group round writes it
 * again. It is -2 because nothing a row can really be showing is: a quantised distance is never
 * below zero and a health in steps of the bar never is either. A reading taken in the gap before
 * that next round says so with a question mark rather than printing it.
 */
const AT_RESET = -2;

/** What a row is showing, so nothing is ever read back off the page to find out. */
interface RosterRow {
  root: HTMLElement;
  nameEl: HTMLElement;
  atEl: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  name: string;
  /** Which of the four readings the right-hand column is showing. */
  atMode: number;
  /** The distance as last written, quantised, while the reading is a distance. */
  atNum: number;
  /**
   * The world whose words were written, as the group handed it over, while the reading is a world.
   * Two fields rather than one joined key: joining them would be a string built on the frame path
   * only to be compared and thrown away.
   */
  atPlanet: string;
  atZone: string;
  /** The health bar as last written, in steps of `barPixels`; `AT_RESET` is "nothing written yet". */
  health: number;
  band: string;
  shown: boolean;
  leader: boolean;
  you: boolean;
  away: boolean;
}

/** What `Roster.report()` hands back, filled in place so asking for it allocates nothing but its words. */
export interface RosterReport {
  /** Rows standing now, and how many members were handed over but had no row left. */
  rows: number;
  over: number;
  /** Writes in the last full second, and so far in the one being counted. */
  writes: number;
  writesNow: number;
  /** Whether the roster's own rules reached the page at all. */
  styled: boolean;
  /** The roster as words, oldest row first, which is how it is read from a tab nobody can see. */
  lines: string;
}

/** The word a member stands under when the group knows nothing better about where they are. */
const ROSTER_AWAY_WORD = 'away';

/**
 * The healths a made-up group wears, as a ramp the row's place along the block is read through.
 * Every number here is INVENTED and none of them is ever seen in play: they exist so that a group
 * conjured at the console shows all three of the bar's bands however many rows were asked for, which
 * is what tells the owner the bands are working. They are anchors, not a straight line, because the
 * bands are nothing like equal — `barBand` calls a third and up good and a sixth and up warn — and a
 * straight line from full to nearly nothing steps clean over the warn band on a group of four,
 * which is exactly what made a working display look broken.
 *
 * The block is read in thirds: the first third of the rows falls through the good band, the second
 * through the warn band and the last through the bad one, each one ending a little inside its band
 * so that the rounding the row does on the way to the screen cannot tip it into the next.
 */
const STAND_IN_HEALTHS = { goodTop: 1, goodLow: 0.4, warnTop: 0.3, warnLow: 0.2, badTop: 0.14, badLow: 0.04 };

/** One row's made-up health: `at` is 0 at the top of the block and 1 at the bottom. */
function standInHealth(at: number): number {
  const h = STAND_IN_HEALTHS;
  if (at <= 1 / 3) return h.goodTop + (h.goodLow - h.goodTop) * (at * 3);
  if (at <= 2 / 3) return h.warnTop + (h.warnLow - h.warnTop) * ((at - 1 / 3) * 3);
  return h.badTop + (h.badLow - h.badTop) * ((at - 2 / 3) * 3);
}

/**
 * The roster's `source` until the wiring gives it one. It is a named function and not a fresh
 * closure so that "nobody has told me where the group is" can be told from "the group is empty"
 * without a second flag: a roster with no source pulls nothing, and one whose source answers null
 * stands down.
 */
const NO_SOURCE = (): readonly RosterMember[] | null => null;

/**
 * The roster's own rules. They are here rather than in `hud.css` so that this block carries its own
 * look wherever it is put, and they are written to the page once, when the first roster is built.
 *
 * Not one colour is written down here: every one of them is a palette name and nothing else, with no
 * value behind it, because `:root` in `src/style.css` is the one home for every value on the screen
 * and a copy of those values here is a copy that no test guards and that a repaint would leave
 * behind. `--hud-scale`, `--hud-font` and `--hud-stretch` are read the same way. The three
 * placements are the roster's own and are the only names with a value behind them, since the block
 * is in the page for an instant before `place()` writes them. The bar is the interface's `.hud-bar`
 * from `hud.css`, so a row's health wears exactly the shape and the bands every other bar wears.
 */
const ROSTER_CSS = `
.hud-roster {
  position: absolute;
  top: var(--hud-roster-top, 96px);
  right: var(--hud-roster-side, 12px);
  width: var(--hud-roster-w, 168px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: calc(4px * var(--hud-scale));
  font-family: var(--hud-font);
  font-stretch: var(--hud-stretch);
  font-variant-numeric: tabular-nums;
  font-size: calc(11px * var(--hud-scale));
  letter-spacing: 0.04em;
  pointer-events: none;
}
.hud-roster.hidden { display: none; }
.hud-rrow {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: calc(3px * var(--hud-scale));
  padding: calc(3px * var(--hud-scale)) calc(6px * var(--hud-scale));
  background: var(--plate);
  border: 1px solid var(--edge);
  border-left-width: calc(2px * var(--hud-scale));
  border-left-color: var(--muted);
  border-radius: calc(3px * var(--hud-scale));
  color: var(--ink);
}
.hud-rrow[hidden] { display: none; }
.hud-rrow .top { display: flex; align-items: baseline; justify-content: space-between; gap: calc(6px * var(--hud-scale)); }
.hud-rrow .name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 1px 0 0 var(--void), -1px 0 0 var(--void), 0 1px 0 var(--void), 0 -1px 0 var(--void);
}
.hud-rrow .at {
  flex: none;
  color: var(--muted);
  text-shadow: 1px 0 0 var(--void), -1px 0 0 var(--void), 0 1px 0 var(--void), 0 -1px 0 var(--void);
}
.hud-rrow .hud-bar { width: 100%; height: calc(5px * var(--hud-scale)); }
.hud-rrow.leader { border-left-color: var(--accent); }
.hud-rrow.leader .name { color: var(--accent); }
.hud-rrow.you .name { font-weight: 600; }
.hud-rrow.away { opacity: 0.45; }
`;

/** The one element the roster's rules are written into, so two rosters share one stylesheet. */
const ROSTER_STYLE_ID = 'hud-roster-style';

/**
 * The roster's rules on to the page, once. A page that has them already, and a stand-in for the page
 * in a test that has no head to put them in, both answer without writing anything; a roster whose
 * rules never landed still works, and says so through `report().styled`.
 */
function installRosterStyle(): boolean {
  try {
    const doc = typeof document !== 'undefined' ? (document as unknown as Record<string, any>) : null;
    if (!doc || !doc.head || typeof doc.createElement !== 'function') return false;
    if (typeof doc.getElementById === 'function' && doc.getElementById(ROSTER_STYLE_ID)) return true;
    const el = doc.createElement('style');
    el.id = ROSTER_STYLE_ID;
    el.textContent = ROSTER_CSS;
    doc.head.appendChild(el);
    return true;
  } catch {
    return false;
  }
}

/**
 * The group's members down the side of the display. Give it the group whenever it changes, or every
 * frame if that is easier — the two are the same cost, because a row writes nothing while nothing it
 * shows has changed, and the comparison is numbers and string identities, never a string built to be
 * thrown away.
 *
 * The list handed over must be one the caller keeps and refills, not a new array each time: this
 * side never allocates, and the frame path must not either.
 */
export class Roster {
  /**
   * Where the group comes from, set by the wiring in the same breath as everything else the group
   * module is given. With one, `update` takes the list from it each frame and the caller never has
   * to call `set` at all; without one, nothing is pulled and `set` is the way in. Either way the
   * list must be the caller's own kept array.
   */
  source: () => readonly RosterMember[] | null = NO_SOURCE;
  readonly root: HTMLElement;
  private readonly rows: RosterRow[] = [];
  /** Whether the roster's own rules reached the page. */
  readonly styled: boolean;
  private hiddenNow = true;
  private shownRows = 0;
  private over = 0;
  /** DOM writes: this second so far, and the last full second. */
  private writes = 0;
  private windowStart = performance.now();
  private lastWrites = 0;
  /**
   * The placement as the page was last told it, so a live change reaches it and nothing else does.
   * Three numbers rather than one string: `place` is called every frame, and a key built to be
   * compared and thrown away would be an allocation on the frame path.
   */
  private placedTop = NaN;
  private placedSide = NaN;
  private placedWidth = NaN;
  private readonly statsOut: HudStats = { writes: 0, byDesign: 0, seconds: 0, writesNow: 0, byDesignNow: 0 };
  private readonly reportOut: RosterReport = { rows: 0, over: 0, writes: 0, writesNow: 0, styled: false, lines: '' };
  /** The console's made-up group, kept and refilled rather than built again on every call. */
  private readonly madeUp: { -readonly [K in keyof RosterMember]: RosterMember[K] }[] = [];
  /** While a made-up group is up, the frame's pull stands aside so the real one cannot write over it. */
  private holding = false;
  private readonly tuneOut: typeof ROSTER_TUNE = { ...ROSTER_TUNE };

  constructor(parent: HTMLElement) {
    this.styled = installRosterStyle();
    this.root = document.createElement('div');
    this.root.className = 'hud-roster hidden';
    parent.appendChild(this.root);
    const count = Math.max(1, Math.round(ROSTER_TUNE.rows));
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'hud-rrow';
      el.hidden = true;
      el.innerHTML = '<div class="top"><span class="name"></span><span class="at"></span></div><div class="hud-bar good"><div class="fill"></div></div>';
      this.root.appendChild(el);
      const q = (sel: string) => el.querySelector<HTMLElement>(sel) ?? el;
      this.rows.push({
        root: el,
        nameEl: q('.name'),
        atEl: q('.at'),
        bar: q('.hud-bar'),
        fill: q('.fill'),
        name: '',
        atMode: AT_NOTHING,
        atNum: -1,
        atPlanet: '',
        atZone: '',
        health: AT_RESET,
        band: 'good',
        shown: false,
        leader: false,
        you: false,
        away: false,
      });
    }
    this.place();
    // Building the block is not what the count is about: it counts what the roster writes while the
    // game is running, and a display that counted its own construction would never read 0.
    this.writes = 0;
  }

  /** How many rows the pool holds: fixed when the roster was built. */
  get size(): number {
    return this.rows.length;
  }

  /**
   * The group as it stands. Nothing but the rows that have changed is written; a group of one is not
   * a group, so the block stands down unless `showAlone` is on, and an empty list takes it away.
   *
   * Your own row is found first, because it is what everybody else's world is compared against: the
   * same list carries it, so nothing extra has to cross the wire for the display to tell "they are
   * on another planet" from "we are standing together and nothing has been heard of them".
   */
  set(members: readonly RosterMember[] | null): void {
    const n = members ? members.length : 0;
    const cap = this.rows.length;
    const take = n > cap ? cap : n;
    this.over = n - take;
    const wanted = take > 1 || (take === 1 && ROSTER_TUNE.showAlone > 0);
    if (!wanted) {
      this.showRoot(false);
      // The rows are put away as well, so the block that comes back is not wearing the last group.
      for (let i = 0; i < cap; i++) this.hideRow(this.rows[i]);
      this.shownRows = 0;
      return;
    }
    // Over the whole list, not just the rows that fit, so a ninth member does not take the world
    // this browser is on away from the eight that are shown.
    let mine: RosterMember | null = null;
    for (let i = 0; i < n; i++) {
      if (members![i].me) {
        mine = members![i];
        break;
      }
    }
    for (let i = 0; i < take; i++) this.writeRow(this.rows[i], members![i], mine);
    for (let i = take; i < cap; i++) this.hideRow(this.rows[i]);
    this.shownRows = take;
    this.showRoot(true);
  }

  /**
   * The group is gone: the block goes with it, and a made-up group put up at the console is let go
   * as well — leaving it held would stop the frame ever pulling the real group again.
   */
  clear(): void {
    this.holding = false;
    this.set(null);
  }

  /**
   * A made-up group, for looking at the block with nobody else connected — the console's call, never
   * the game's. The rows are kept and refilled, so asking again allocates nothing, and the group
   * handed over is the roster's own array, which is exactly how a caller is asked to feed it.
   *
   * The names and the distances are stand-ins with no meaning; `showAlone` is what to turn on to see
   * a single row this way. The healths come off the ramp above, so that however many rows are asked
   * for the three bands are all on the screen at once — a made-up group of four that came out all
   * green had the owner looking for a fault in the bands that was not there. The worlds are real ids
   * from the game's own table, so what the block reads is what it would read in play.
   *
   * While one is up the frame's own pull stands aside, so the real group cannot write over it a
   * frame later; `standIn(0)` puts the block down and hands it back.
   */
  standIn(n: number): readonly RosterMember[] {
    const want = Math.max(0, Math.min(this.rows.length, Math.round(n)));
    this.holding = want > 0;
    const made = this.madeUp;
    while (made.length < want) {
      const i = made.length;
      made.push({ id: i + 1, name: `Member ${i + 1}`, hp: 1, planet: '', zone: '', distance: 0, leader: false, me: false, here: true, away: false });
    }
    for (let i = 0; i < want; i++) {
      const m = made[i];
      // Full at the top down to nearly nothing at the bottom, through each band in turn, so the
      // good, the warn and the bad are all shown whether three rows were asked for or eight.
      m.hp = want > 1 ? standInHealth(i / (want - 1)) : STAND_IN_HEALTHS.goodTop;
      // The last of four or more stands on another world and the one before it has gone quiet, so
      // all three readings of the right-hand column can be seen at once.
      const elsewhere = want >= 4 && i === want - 1;
      const quiet = want >= 4 && i === want - 2;
      m.distance = elsewhere || quiet ? -1 : 12 + i * 63;
      m.planet = elsewhere ? 'naboo' : 'tatooine';
      m.zone = '';
      m.leader = i === 0;
      m.me = i === 1;
      m.here = !quiet;
      m.away = false;
    }
    made.length = want;
    this.set(made);
    return made;
  }

  /**
   * Once a frame, or as often as suits. With a `source` it takes the group from it and writes
   * whatever has changed — eight rows of number comparisons, and nothing at all while nobody has
   * moved. It also closes the second the writes are counted in and carries a placement changed at
   * the console to the page. It ages nothing: there is nothing here that fades.
   */
  update(): void {
    const from = this.source;
    if (!this.holding && from !== NO_SOURCE) this.set(from());
    const now = performance.now();
    if (now - this.windowStart >= 1000) {
      this.lastWrites = this.writes;
      this.writes = 0;
      this.windowStart = now;
    }
    this.place();
  }

  /** The same two counts the rest of the display answers with, filled in place. */
  stats(): HudStats {
    const s = this.statsOut;
    s.writes = this.lastWrites;
    s.byDesign = 0;
    s.seconds = (performance.now() - this.windowStart) / 1000;
    s.writesNow = this.writes;
    s.byDesignNow = 0;
    return s;
  }

  /**
   * What the roster is showing, in words as well as in numbers, because the session that works on
   * this file cannot see the screen: `lines` is each row as it reads, in order, which is the only
   * way to check a name, a health bar and a distance from a tab nobody is looking at.
   */
  report(): RosterReport {
    const o = this.reportOut;
    o.rows = this.shownRows;
    o.over = this.over;
    o.writes = this.lastWrites;
    o.writesNow = this.writes;
    o.styled = this.styled;
    let lines = '';
    for (let i = 0; i < this.shownRows; i++) {
      const r = this.rows[i];
      const marks = `${r.leader ? ' (leader)' : ''}${r.you ? ' (you)' : ''}${r.away ? ' (away)' : ''}`;
      // A value let go by a live change of step and not yet written again reads as a question, so
      // that a reading taken in that one gap is never a number the row is not showing.
      const at = r.atNum === AT_RESET ? '?' : this.atWords(r.atMode, r.atNum, r.atPlanet, r.atZone);
      const share = r.band === 'none' ? '—' : r.health === AT_RESET ? '?' : `${Math.round((r.health / Math.max(1, ROSTER_TUNE.barPixels)) * 100)}%`;
      lines += `${lines ? ' | ' : ''}${r.name}${marks} ${share}${at ? ` ${at}` : ''}`;
    }
    o.lines = lines;
    return o;
  }

  /**
   * Try one of the invented steps live; with nothing given it only reports them. `rows` is taken and
   * reported but changes nothing until a fresh roster is built, exactly as the message line's pool
   * is, because the rows are made once. What comes back is a copy, so the console holds a reading
   * and not the table.
   */
  tune(next?: Partial<typeof ROSTER_TUNE>): typeof ROSTER_TUNE {
    let took = false;
    if (next) {
      for (const key of Object.keys(next)) {
        const value = (next as Record<string, unknown>)[key];
        if (!(ROSTER_KEYS as readonly string[]).includes(key)) {
          console.warn(`roster.tune: no step called ${key}; the steps are ${ROSTER_KEYS.join(', ')}`);
          continue;
        }
        const floor = ROSTER_ZERO_OK.includes(key) ? 0 : 1e-9;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < floor) {
          console.warn(`roster.tune: ${key} wants a number ${floor > 0 ? 'above zero' : 'of zero or more'}, not ${String(value)}`);
          continue;
        }
        ROSTER_TUNE[key as keyof typeof ROSTER_TUNE] = value;
        took = true;
      }
    }
    if (took) {
      // Whatever was drawn through the old steps is drawn again through the new ones, the next time
      // the group comes round. Only the two values a step touches are let go: the bar, and a
      // distance. A world's name and the plain word do not go through a step at all, so they are
      // left standing and the row goes on saying what it is really saying.
      for (const row of this.rows) {
        row.health = AT_RESET;
        if (row.atMode === AT_METRES) row.atNum = AT_RESET;
      }
      this.place();
    }
    const out = this.tuneOut;
    for (const key of ROSTER_KEYS) out[key] = ROSTER_TUNE[key];
    return out;
  }

  // --- the writing --------------------------------------------------------------------------------

  private writeRow(row: RosterRow, m: RosterMember, mine: RosterMember | null): void {
    if (!row.shown) {
      row.shown = true;
      row.root.hidden = false;
      this.writes++;
    }
    if (m.name !== row.name) {
      row.name = m.name;
      row.nameEl.textContent = m.name;
      this.writes++;
    }
    // Their browser has gone quiet — reloading, or shut. The group keeps their place and this keeps
    // their row, dimmed; what it must not do is read as "they are on another planet", because their
    // world is still the one you are standing on.
    const gone = m.away === true || m.here === false;
    // The right-hand column, as one of four readings. Your own row has none: a distance from
    // yourself is zero and says nothing. A distance below zero is a world only when their world is
    // genuinely not yours; otherwise they are here somewhere and nothing has been heard of them, and
    // the row says that in one plain word rather than naming the planet you are both standing on.
    let mode = AT_AWAY;
    let atNum = -1;
    let atPlanet = '';
    let atZone = '';
    if (m.me) {
      mode = AT_NOTHING;
    } else if (m.distance >= 0) {
      mode = AT_METRES;
      atNum = quantiseMetres(m.distance);
    } else if (!gone && (!mine || m.planet !== mine.planet || m.zone !== mine.zone) && (m.planet || m.zone)) {
      mode = AT_WORLD;
      atPlanet = m.planet;
      atZone = m.zone;
    }
    // What is compared is the reading, the number its words are built from and the world as it was
    // handed over — never the words — so a string is built only when what it would say has changed.
    if (mode !== row.atMode || atNum !== row.atNum || atPlanet !== row.atPlanet || atZone !== row.atZone) {
      row.atMode = mode;
      row.atNum = atNum;
      row.atPlanet = atPlanet;
      row.atZone = atZone;
      row.atEl.textContent = this.atWords(mode, atNum, atPlanet, atZone);
      this.writes++;
    }
    // The health bar, in steps of its own length, and its band, which is the interface's own. A
    // health nothing carries yet stands empty in the band for a bar with nothing behind it, rather
    // than reading as a member about to die.
    const px = Math.max(1, Math.round(ROSTER_TUNE.barPixels));
    const known = m.hp >= 0;
    const share = known ? clamp01(m.hp) : 0;
    const steps = Math.round(share * px);
    if (steps !== row.health) {
      row.health = steps;
      row.fill.style.transform = `scaleX(${steps / px})`;
      this.writes++;
    }
    const band = known ? barBand(share) : 'none';
    if (band !== row.band) {
      row.bar.classList.toggle(row.band, false);
      row.bar.classList.toggle(band, true);
      row.band = band;
      this.writes += 2;
    }
    this.flag(row, 'leader', !!m.leader);
    this.flag(row, 'you', !!m.me);
    this.flag(row, 'away', gone);
  }

  /** One reading of the right-hand column as it reads. The one place a string is built for it. */
  private atWords(mode: number, atNum: number, planet: string, zone: string): string {
    if (mode === AT_METRES) return distanceWords(atNum);
    if (mode === AT_WORLD) return worldWords(planet, zone);
    if (mode === AT_AWAY) return ROSTER_AWAY_WORD;
    return '';
  }

  private flag(row: RosterRow, name: 'leader' | 'you' | 'away', on: boolean): void {
    if (row[name] === on) return;
    row[name] = on;
    row.root.classList.toggle(name, on);
    this.writes++;
  }

  private hideRow(row: RosterRow): void {
    if (!row.shown) return;
    row.shown = false;
    row.root.hidden = true;
    this.writes++;
  }

  private showRoot(on: boolean): void {
    const hide = !on;
    if (hide === this.hiddenNow) return;
    this.hiddenNow = hide;
    this.root.classList.toggle('hidden', hide);
    this.writes++;
  }

  /**
   * Where the block sits, as three properties the rules read. One write at boot, and one more only
   * when a placement is changed at the console, so the numbers above and the block on the screen can
   * never say different things.
   */
  private place(): void {
    if (ROSTER_TUNE.top === this.placedTop && ROSTER_TUNE.side === this.placedSide && ROSTER_TUNE.width === this.placedWidth) return;
    this.placedTop = ROSTER_TUNE.top;
    this.placedSide = ROSTER_TUNE.side;
    this.placedWidth = ROSTER_TUNE.width;
    setVar(this.root, '--hud-roster-top', `${ROSTER_TUNE.top}px`);
    setVar(this.root, '--hud-roster-side', `${ROSTER_TUNE.side}px`);
    setVar(this.root, '--hud-roster-w', `${ROSTER_TUNE.width}px`);
    this.writes += 3;
  }
}

/**
 * A distance rounded to what the words it becomes can tell apart: a metre while someone is close, 25
 * m once they are `coarseFrom` off, and a hundred once it reads in kilometres. Two distances that
 * would read the same round to the same number, which is what lets the roster compare numbers and
 * still never write the same words twice.
 */
export function quantiseMetres(d: number): number {
  const v = Number.isFinite(d) && d > 0 ? d : 0;
  if (v >= ROSTER_TUNE.kmFrom) return Math.round(v / 100) * 100;
  const step = Math.max(1e-9, v >= ROSTER_TUNE.coarseFrom ? ROSTER_TUNE.farStep : ROSTER_TUNE.metreStep);
  return Math.round(v / step) * step;
}

/** A quantised distance as it reads: metres, and kilometres to a tenth from `kmFrom` up. */
export function distanceWords(metres: number): string {
  if (metres >= ROSTER_TUNE.kmFrom) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

/**
 * A world as the game itself names it, from the game's own table: the planet's name, and the zone's
 * after it when they are in one, which is the same pair `main.ts` puts in the corner block. An id
 * off the wire is looked up and never trusted — `PLANETS.find`, not `planetById`, which throws on an
 * id it does not know — so a build that sends a world this one has never heard of reads as the id
 * tidied up rather than taking the display down.
 *
 * The tidying is what this used to do on its own, and on its own it was wrong: the ids that really
 * cross are `space_light1` for Kessel, `yavin4` for Yavin 4, and `kashyyyk` with a zone of `main`
 * for Kachirho, none of which tidy into anything a player would recognise.
 */
export function worldWords(planet: string, zone: string): string {
  const def = planet ? PLANETS.find((p) => p.id === planet) : undefined;
  if (!def) return tidyId(zone || planet);
  const z = zone && def.zones ? def.zones.find((x) => x.id === zone) : undefined;
  return z ? `${def.name}: ${z.name}` : def.name;
}

/** A world the table cannot name, made readable: underscores out, first letter up. */
function tidyId(id: string): string {
  const words = id.replace(/_/g, ' ').trim();
  if (!words) return ROSTER_AWAY_WORD;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
