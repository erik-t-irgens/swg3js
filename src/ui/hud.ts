import type { Kit } from '../combat/kit';
// The game's own table of worlds, so a roster row names a planet and a zone the way the rest of the
// game names them rather than inventing words from an id. It is plain data and imports nothing.
import { PLANETS, type PlanetDef } from '../data/planets.ts';
import { HUD_SIZES, barBand, barLayout, breathOf, clamp01, distanceWords as metreWords, makeBarLayout, makeBreathRow, noBreath, type BarBox, type BlockAlign, type ForceEdge, type ForceLook } from './hudMath.ts';
import { glyphFor, iconCount, installIcons } from './hudIcons.ts';
import { makeMarkIn, makeMarkOut, markSvg, markWords, weaponMark, type MarkKey } from './weaponMark.ts';

/**
 * The class `#ui` wears while the hide key has the interface off the screen (`App.setHudHidden`). Not `hidden`: the
 * page's own `.hidden` is `display: none !important` on whatever wears it, which on `#ui` would take the menus, the
 * loading screen and the chat line down with the display. `hud.css` says what it hides and what stays.
 */
export const HUD_HIDDEN_CLASS = 'ui-hidden';

/**
 * The muted words after the weather's own while the weather is held or forced (the old corner note's job, in two
 * words). Written once into its own span; the line only puts it on or takes it off.
 */
const HELD_WORDS = ' · held';

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
  /** DOM writes in the last full second that are meant to happen: the 4 Hz /loc and frame rate, the clock's minute, a rebuild of the slot row, a new placing of the bars. */
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
  readonly bad: number;
  readonly warn: number;
}

/**
 * The grapple's mark as the overlay draws it, filled by the game each frame from the hook's own mark and
 * this frame's camera: where the dart would bite on the screen, and the anchor while the rope is out. Plain
 * numbers and switches in one kept record, so drawing it makes nothing.
 */
export interface HudGrappleMark {
  /** The Interface page's switch: off, nothing of the mark is drawn (the hook still fires). */
  enabled: boolean;
  /** A press would fire: the diamond in `good`; `held` from the snap hold, at half alpha; `next` while attached, in `muted`. */
  shows: boolean;
  held: boolean;
  next: boolean;
  /** The point rests on a vehicle's hull (wave 3): the diamond in `warn`, so a moving anchor is told from a still one before firing. */
  vehicle: boolean;
  /** A refused press: the diamond flashes `bad` while this is above nought. */
  flash: number;
  /** Where the mark stands on the screen, and whether it is in front of the camera at all. */
  onScreen: boolean;
  x: number;
  y: number;
  /** The anchor's small mark, while the rope is out and the anchor in front of the camera. */
  anchorOn: boolean;
  ax: number;
  ay: number;
  /** How much of the longest rope is out (0 to 1) while the rope is attached, nought otherwise: the arc round the crosshair. */
  ropeUsed: number;
}

export function newHudGrappleMark(): HudGrappleMark {
  return { enabled: true, shows: false, held: false, next: false, vehicle: false, flash: 0, onScreen: false, x: 0, y: 0, anchorOn: false, ax: 0, ay: 0, ropeUsed: 0 };
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

/** What a hand is holding, as the rack keeps it (`WeaponDef`), declared structurally: the mark reads its class. */
export interface HandItem {
  readonly id?: string;
  readonly name?: string | null;
  readonly class?: string;
}

/**
 * Where the weapon mark reads from (`weaponMark.ts`), declared structurally: the player satisfies it as it stands. What
 * each hand holds (read by identity, so nothing is worked out while nothing has changed), the bare-hands switch, the
 * stand-in blaster's kind (`gunClass`), the saber's stance, and how long the blade in a hand takes to come out or go back
 * (`bladeSeconds`, the blade's own timing; a source without it, or an answer that is not a number, is the default,
 * `HUD_SIZES.markBladeSeconds`). The kit in play is the one `update` is handed.
 */
export interface HandSource {
  readonly equipped: { right: HandItem | null; left: HandItem | null };
  readonly fists?: boolean;
  readonly gunClass?: string;
  readonly saber?: { readonly style: string };
  bladeSeconds?(hand: 'right' | 'left', closing: boolean): number;
}

/** Every live display, so a rebind in the Controls page reaches the cells at once. */
const LIVE: Hud[] = [];

/**
 * The bindings changed: every display puts the new keys on its cells. Called by whoever rebinds — one
 * line in the Controls page. Nothing breaks without it: the cells notice a changed binding at the
 * four-times-a-second tick anyway, and this only makes it immediate.
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

/** What the mark last read in a hand after `refresh` or a new source: nothing the rack hands over is this, so the next frame reads the hands afresh. */
const NOT_READ: HandItem = {};

/**
 * The weapon mark as last written, so a frame compares and writes nothing while nothing has changed: what each slot
 * shows, each slot's tilt, whether it is a pair, whether the blade is out, and the four blade timings (`NaN` is
 * "nothing written yet").
 */
interface MarkDrawn {
  a: MarkKey | '\u0000';
  b: MarkKey | '\u0000';
  tiltA: number;
  tiltB: number;
  pair: boolean;
  lit: boolean;
  openR: number;
  closeR: number;
  openL: number;
  closeL: number;
}

/**
 * One of the two bars that carry a ghost, health and Force. The ghost costs two writes a fall and nothing at all
 * otherwise: while it is not easing it carries `snap` — the stylesheet's "no transition" — and is written straight to
 * the fill's own value, where it sits behind the fill and is never seen; a fall takes `snap` off and writes the new
 * value, and the stylesheet walks it down from where the bar was over `ghostSeconds`.
 *
 * Each goes away `HUD_SIZES.fullLinger` seconds after it is full (the class `off`, a fade the stylesheet runs) and
 * comes back the moment it drops: `sinceFull` is how long it has been full as drawn, and `shown` whether it wears
 * `off` or not, as last written.
 */
interface BodyBar {
  root: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  /** The fill and the ghost as last written, in steps of `barPixels`; NaN is "nothing written yet". */
  cur: number;
  ghostAt: number;
  snap: boolean;
  ghostFor: number;
  shown: boolean;
  sinceFull: number;
}

/** What one bar's box was last written as (`barLayout`), so a placing writes only what moved; NaN is "nothing yet". */
interface BoxDrawn {
  x: number;
  y: number;
  w: number;
  h: number;
  rl: number;
  rr: number;
  clipTop: boolean;
  clipBottom: boolean;
}

function newBoxDrawn(): BoxDrawn {
  return { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN, rl: Number.NaN, rr: Number.NaN, clipTop: false, clipBottom: false };
}

/**
 * The display's own looks that are numbers in `HUD_SIZES` and are drawn by the stylesheet, as the custom properties
 * it reads (each with its start value as the stylesheet's fallback): written at boot and again only when one is moved
 * live, as the ghost's ease is. `unit` is what follows the number.
 */
const LOOK_VARS: readonly { key: keyof typeof HUD_SIZES; name: string; unit: string }[] = [
  { key: 'markSize', name: '--hud-mark', unit: '' },
  { key: 'markGap', name: '--hud-mark-gap', unit: '' },
  { key: 'blockSide', name: '--hud-block-side', unit: '' },
  { key: 'hpEaseSeconds', name: '--hud-hp-ease', unit: 's' },
  { key: 'rippleSeconds', name: '--hud-ripple', unit: 's' },
  { key: 'ripplePx', name: '--hud-ripple-px', unit: '' },
  { key: 'rippleStrength', name: '--hud-ripple-alpha', unit: '' },
  { key: 'breathFlashSeconds', name: '--hud-breath-flash', unit: 's' },
  { key: 'barFadeSeconds', name: '--hud-bar-fade', unit: 's' },
  // The weapon mark's (item 6): how see-through it is, how fast it turns to a new stance, and a pair's two small marks
  // and the line between them.
  { key: 'markAlpha', name: '--hud-mark-alpha', unit: '' },
  { key: 'markTurnSeconds', name: '--hud-mark-turn', unit: 's' },
  { key: 'markPairScale', name: '--hud-mark-pair', unit: '' },
  { key: 'markPairAt', name: '--hud-mark-pair-at', unit: '' },
  { key: 'markSplitLength', name: '--hud-mark-split', unit: '' },
  { key: 'markSplitWidth', name: '--hud-mark-split-w', unit: '' },
  { key: 'markSplitAngle', name: '--hud-mark-split-angle', unit: '' },
  // The corner's readouts: the frame rate's type and its drop shadow, and the weather word's type.
  { key: 'fpsSize', name: '--hud-fps-size', unit: '' },
  { key: 'fpsShadowY', name: '--hud-fps-shadow-y', unit: '' },
  { key: 'fpsShadowBlur', name: '--hud-fps-shadow-blur', unit: '' },
  { key: 'weatherSize', name: '--hud-weather-size', unit: '' },
];

/**
 * The slow half of the head-up display: the planet block with the weather's word and the clock, the
 * frame rate, the body block's bars, the number slots with the keys you have bound, the weapon mark for what the hands hold, the
 * crosshair and its charge, the prompt, the hurt fade and the mouse-free line. The
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
  private readonly loc: HTMLElement;
  /**
   * The nearest living thing's name, a line of its own at the foot of the top-left block: the `/loc`
   * line's tail once, until the coordinates went over the minimap and a name could no longer ride
   * them. Empty while the plate over a head says the same thing better. Written when the name changes,
   * and kept here rather than read back off the element.
   */
  private readonly nearby: HTMLElement;
  private nearbyText = '';
  /** The frame rate alone at the top right, as `62 fps`, while its switch is on (`setReadouts`). */
  private readonly fps: HTMLElement;
  /**
   * The weather in a word or two under the minimap (in its place when it is off), and the muted " · held" after it
   * while the weather is held or forced: the word written when it changes, the held part a class. What was written is
   * kept here rather than read back off the element.
   */
  private readonly weatherEl: HTMLElement;
  private readonly weatherWordEl: HTMLElement;
  private weatherText = '';
  private weatherHeld = false;
  private weatherShown = false;
  /** The world's time of day just above the minimap's coordinates (or the corner's `/loc` with no minimap). */
  private readonly clock: HTMLElement;
  private clockText = '';
  /** The three switches (`setReadouts`) and what each line wears: `gone` while its switch is off. */
  private wantFps = false;
  private wantWeather = true;
  private wantClock = false;
  private fpsShown = false;
  private clockShown = false;
  /** The body block, whose standing down is how this file knows the player is at a ship's controls. */
  private readonly bottom: HTMLElement;
  /** The box the bars stand in: its size is the bars' layout's, so the weapon mark and the action bar lay out round it. */
  private readonly barsEl: HTMLElement;
  private readonly hp: BodyBar;
  private readonly res: BodyBar;
  /**
   * Health's two looks below a share (`HUD_SIZES.hpLow`, `hpRipple`): the dark red in place of `muted`, and the
   * ripple of `bad` spreading out from the bar, each one class the stylesheet runs. As last written.
   */
  private hpLow = false;
  private hpRipple = false;
  /**
   * The breath bar, on top of the top-most bar while you are under water (`barLayout`). Its place is kept whether it
   * shows or not, so its coming and going moves nothing on the screen; it carries no ghost, since breath drains and is
   * not taken in blows. Below `breathFlashBelow` it flashes white (the class `low`, an animation the stylesheet runs).
   */
  private readonly breathBar: HTMLElement;
  private readonly breathFill: HTMLElement;
  /**
   * The stamina bar, attached to Force (or to health with no Force) as the layout says. While the speed classes are in
   * force it is in the block and only made visible or not (`off`); with them off it is not in the block at all
   * (`gone`), and the bars are placed without it. No ghost: stamina drains and comes back, it is not taken in blows.
   */
  private readonly staminaBar: HTMLElement;
  private readonly staminaFill: HTMLElement;
  /** The stamina bar as last written: in the block or not, up or not, the bar in steps of its own pixels, and whether it wears the tired band. */
  private staminaOn = false;
  private staminaShown = false;
  private staminaCur = NaN;
  private staminaTired = false;
  /**
   * Where the block stands and how Force meets health (the Interface page's three switches, `setBlock`), the layout
   * worked out from them (`barLayout`, a kept struct) and what each bar's box was last written as.
   */
  private align: BlockAlign = 'middle';
  private look: ForceLook = 'over';
  private edge: ForceEdge = 'lower';
  private readonly bars = makeBarLayout();
  private readonly hpBox = newBoxDrawn();
  private readonly poolBox = newBoxDrawn();
  private readonly staminaBox = newBoxDrawn();
  private readonly breathBox = newBoxDrawn();
  private barsW = Number.NaN;
  private barsH = Number.NaN;
  /** The `HUD_SIZES` looks as the page was last told them (`LOOK_VARS`), so a live change reaches it and nothing else does. */
  private readonly lookWritten: number[] = LOOK_VARS.map(() => Number.NaN);
  private readonly slotsEl: HTMLElement;
  /**
   * The weapon mark (the interface rewrite's first wave, item 6; `weaponMark.ts`): our own mark for what the hands hold,
   * in the block's mark box, slightly see-through and with no name. Its two slots (`a`, and `b` for the left hand in a
   * pair) are written when what they show changes; a lightsaber's tilt is a custom property on its slot, which the
   * stylesheet turns it by; the blade draws in and out by one class on the mark (`lit`), at the blade's own timing (four
   * custom properties, written when the hands change). What the hands held, the kit, the bare-hands switch, the stand-in
   * blaster's kind and the stance, as last read (`mk*`), so a frame with none of them changed compares and writes nothing.
   */
  private readonly markEl: HTMLElement;
  private readonly markA: HTMLElement;
  private readonly markB: HTMLElement;
  private readonly markIn = makeMarkIn();
  private readonly markOut = makeMarkOut();
  private readonly markDrawn: MarkDrawn = { a: '\u0000', b: '\u0000', tiltA: Number.NaN, tiltB: Number.NaN, pair: false, lit: false, openR: Number.NaN, closeR: Number.NaN, openL: Number.NaN, closeL: Number.NaN };
  private mkRight: HandItem | null = NOT_READ;
  private mkLeft: HandItem | null = NOT_READ;
  private mkKit = '\u0000';
  private mkBare = false;
  private mkGun = '\u0000';
  private mkStyle = '\u0000';
  /** The Interface page's switch: the mark's blade follows the real one (on), or stands out whatever the real one does. */
  private markFollows = true;
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
  /**
   * Whether the kit has a Force pool (the bar in the block or `gone`), as last written. `NaN` elsewhere is "nothing
   * written yet", because it is the one value that is never equal to itself.
   */
  private resShown = true;
  /**
   * The breath bar as it stands: whether it is up, the bar in steps of `breathPixels`, and whether it flashes. `NaN`
   * is "nothing written yet", as it is for the other bars. `breathLow` is not reset when the bar goes down, since the
   * element keeps its classes while it is hidden and the two would then disagree.
   */
  private breathShown = false;
  private breathCur = NaN;
  private breathLow = false;
  /** What `breathOf` fills, kept so that asking about breath allocates nothing in a frame. */
  private readonly breathOut = makeBreathRow();
  /**
   * This frame's seconds and the share the next `setBar` writes: fields and never arguments, since a fraction handed to
   * a call the compiler leaves out is a number made a frame (docs/lessons, "A frame allocates nothing"; measured in
   * `hudBars.test.ts`). Begun as fractions, so each is a double from its first write.
   */
  private frameDt = 0.5;
  private shareIn = 0.5;
  private chargeShown = false;
  private chargeDrawn = NaN;
  private charge = 0;
  private hurtLevel = 0;
  private hurtDrawn = NaN;
  private lastFps = performance.now();
  private frames = 0;
  /** The quarter-second lines are written on the next frame whatever the clock says (`refresh`, the interface shown again). */
  private tickNow = false;
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
  /** Where the keys on the cells come from, and what the weapon mark reads. */
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
  /** The grapple's mark, written by the game each frame it is simulated and drawn on the overlay with the crosshair. */
  readonly grappleMark: HudGrappleMark = newHudGrappleMark();
  /** What `report` hands back: one object, filled in place. */
  private readonly out = { ops: 0, icons: 0, keys: '', attached: false, crosshair: false, mark: '', breath: '', stamina: '', bars: '', block: '', fps: '', weather: '', clock: '' };

  /**
   * The display's markup. The top-left block holds, in order, the weather's line (first, so with the minimap off it
   * stands in the minimap's place; the minimap's own wrap is put in ahead of it, and it then stands under the circle),
   * the world's name, the clock, the `/loc` line and the nearby line. The clock stands just above the coordinates: over
   * the minimap's while it shows (the stylesheet places it there), above `/loc` while it does not.
   *
   * The body block (`.bottom`) is the weapon mark's box and the bars' box (`.hud-top`: the mark over the bars in the
   * middle, beside them at the screen's edge at either side), with the action bar under both, always the lowest thing.
   * The bars are placed in their box by `barLayout`, in the order they are drawn, each over the one before it:
   * health, Force, stamina, breath.
   */
  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hurt"></div>
      <div class="panel top-left">
        <div class="hud-weather gone"><span class="word"></span><span class="held"></span></div>
        <div class="planet-name"></div>
        <div class="hud-clock gone"></div>
        <div class="loc"></div>
        <div class="hud-nearby"></div>
      </div>
      <div class="hud-fps gone"></div>
      <div class="crosshair"></div>
      <div class="charge" hidden><div class="fill"></div></div>
      <div class="mouse-free hidden">Mouse free · <b>click</b> to look again</div>
      <div class="prompt"></div>
      <div class="bottom">
        <div class="hud-top">
          <div class="hud-mark"><svg class="ic mk" viewBox="0 0 24 24" aria-hidden="true"><g class="mk-a"></g><path class="mk-split" d="M11.5 12h1"></path><g class="mk-b"></g></svg></div>
          <div class="hud-bars">
            <div class="hud-bar hp"><div class="ghost snap"></div><div class="fill"></div></div>
            <div class="hud-bar pool"><div class="ghost snap"></div><div class="fill"></div></div>
            <div class="hud-bar stamina good off gone"><div class="fill"></div></div>
            <div class="hud-bar breath off"><div class="fill"></div></div>
          </div>
        </div>
        <div class="hud-kit">
          <div class="slots"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    this.planetName = q('.planet-name');
    this.loc = q('.loc');
    this.nearby = q('.hud-nearby');
    this.fps = q('.hud-fps');
    this.weatherEl = q('.hud-weather');
    this.weatherWordEl = q('.hud-weather .word');
    this.clock = q('.hud-clock');
    this.bottom = q('.bottom');
    this.barsEl = q('.hud-bars');
    // `sinceFull` and `ghostFor` begin as fractions, so each field is a double from its first write (each is moved by a
    // frame's seconds); a ghost's ease below nought is no ease at all.
    this.hp = { root: q('.hud-bar.hp'), fill: q('.hud-bar.hp > .fill'), ghost: q('.hud-bar.hp > .ghost'), cur: NaN, ghostAt: NaN, snap: true, ghostFor: -0.5, shown: true, sinceFull: 0.5 };
    this.res = { root: q('.hud-bar.pool'), fill: q('.hud-bar.pool > .fill'), ghost: q('.hud-bar.pool > .ghost'), cur: NaN, ghostAt: NaN, snap: true, ghostFor: -0.5, shown: true, sinceFull: 0.5 };
    this.breathBar = q('.hud-bar.breath');
    this.breathFill = q('.hud-bar.breath > .fill');
    this.staminaBar = q('.hud-bar.stamina');
    this.staminaFill = q('.hud-bar.stamina > .fill');
    this.slotsEl = q('.slots');
    this.crosshair = q('.crosshair');
    this.chargeEl = q('.charge');
    this.chargeFill = q('.charge .fill');
    this.mouseFree = q('.mouse-free');
    this.prompt = q('.prompt');
    this.hurtEl = q('.hurt');
    this.markEl = q('.hud-mark');
    this.markA = q('.hud-mark .mk-a');
    this.markB = q('.hud-mark .mk-b');
    LIVE.push(this);
    // The held words, once: the line only ever puts them on or takes them off.
    q('.hud-weather .held').textContent = HELD_WORDS;
    // The bars placed as the defaults say, until the game hands over the Interface page's switches.
    this.layoutBars();
    // Everything the constructor puts on the page is the display's own markup and is not counted:
    // the two counts are about what it writes while the game is running, not about building itself.
    this.byDesign = 0;
    // The ghost's ease is one number (`HUD_SIZES.ghostSeconds`) and the stylesheet reads it, so the
    // timer this file runs and the walk the page draws can never say different things; the bars' own
    // looks (`LOOK_VARS`) are told the page the same way.
    this.syncGhost();
    this.syncLooks();
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

  /** Where the keys on the cells come from. The cells take them at once. */
  setInput(input: HudBindings): void {
    this.input = input;
    this.refreshKeys(true);
  }

  /** What the weapon mark reads: the live object the player keeps. The next frame reads the hands afresh. */
  setHandSource(source: HandSource | null): void {
    this.handSource = source;
    this.mkRight = NOT_READ;
  }

  /**
   * The Interface page's switch for the mark's blade (on to begin with, the owner's "Start on not off"): on, a
   * lightsaber's mark draws its blade in and out with the real one; off, it shows the stance with the blade out whether
   * the real one is out or not. Not in a frame; the next frame writes the class if it has to.
   */
  setMarkBlade(follow: boolean): void {
    this.markFollows = follow;
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

  /**
   * The weather's word (`weatherWord` in `weatherWords.ts`: "Rain", never "Weather: Rain"), or '' where there is none
   * to say (space, a dungeon, a world with no weather), and whether it is held or forced, which puts the muted
   * " · held" after it. Cheap to call every frame: the word is one of a few kept strings, compared against what was
   * written rather than against the element, and nothing is written while neither has changed.
   */
  setWeather(word: string, held: boolean): void {
    if (word !== this.weatherText) {
      this.weatherText = word;
      if (word) {
        this.weatherWordEl.textContent = word;
        this.writes++;
      }
    }
    if (held !== this.weatherHeld) {
      this.weatherHeld = held;
      this.weatherEl.classList.toggle('held', held);
      this.writes++;
    }
    this.showWeather();
  }

  /** The weather's line up while its switch is on and there is a word to say, and down otherwise: one class. */
  private showWeather(): void {
    const show = this.wantWeather && this.weatherText !== '' && this.weatherText !== '\u0000';
    if (show === this.weatherShown) return;
    this.weatherShown = show;
    this.weatherEl.classList.toggle('gone', !show);
    this.writes++;
  }

  /**
   * The three readouts' switches (the Interface page's Frame rate, Weather and Clock): each line is in the page or
   * `gone`, one class each, written only when its switch moves. Not in a frame.
   */
  setReadouts(fps: boolean, weather: boolean, clock: boolean): void {
    this.wantFps = fps;
    this.wantWeather = weather;
    this.wantClock = clock;
    if (fps !== this.fpsShown) {
      this.fpsShown = fps;
      this.fps.classList.toggle('gone', !fps);
      this.byDesign++;
      // Coming up, it is written on the next frame rather than a quarter second later.
      if (fps) this.tickNow = true;
    }
    if (clock !== this.clockShown) {
      this.clockShown = clock;
      this.clock.classList.toggle('gone', !clock);
      this.byDesign++;
      // Written afresh when it comes up: while it was down nothing kept it.
      this.clockText = '\u0000';
    }
    this.showWeather();
  }

  /**
   * Where the block stands and how the Force bar meets the health bar (the Interface page's three switches): the
   * block's class, and the bars placed again (`layoutBars`). Called with the settings and never in a frame; a size
   * moved live (`HUD_SIZES`) is taken up by calling it again with the same three, which `applyHudSettings` does.
   */
  setBlock(align: BlockAlign, look: ForceLook, edge: ForceEdge): void {
    if (align !== this.align) {
      this.bottom.classList.toggle('align-left', align === 'left');
      this.bottom.classList.toggle('align-right', align === 'right');
      this.byDesign += 2;
    }
    this.align = align;
    this.look = look;
    this.edge = edge;
    this.layoutBars();
    this.syncLooks();
    // A stance's tilt moved at a dial reaches the mark the same way: the next frame works the mark out again (and writes
    // only what changed).
    this.mkStyle = '\u0000';
  }

  /**
   * The bars placed in their box (`barLayout`), at scale 1 as custom properties the stylesheet multiplies by the HUD
   * scale: each box's place, size and two ends' rounding, the inside look's clipped half as a class, and the box's own
   * size, which the weapon mark and the action bar lay out round. Only what moved is written. Called when the switches,
   * the kit's Force pool, the speed classes or a size changes; never in a steady frame.
   */
  private layoutBars(): void {
    const L = barLayout(this.align, this.look, this.edge, this.resShown, this.staminaOn, this.bars);
    if (L.w !== this.barsW) {
      this.barsW = L.w;
      setVar(this.barsEl, '--hud-bars-w', `${L.w}`);
      this.byDesign++;
    }
    if (L.h !== this.barsH) {
      this.barsH = L.h;
      setVar(this.barsEl, '--hud-bars-h', `${L.h}`);
      this.byDesign++;
    }
    this.placeBar(this.hp.root, L.hp, this.hpBox);
    this.placeBar(this.res.root, L.pool, this.poolBox);
    this.placeBar(this.staminaBar, L.stamina, this.staminaBox);
    this.placeBar(this.breathBar, L.breath, this.breathBox);
  }

  private placeBar(el: HTMLElement, b: BarBox, d: BoxDrawn): void {
    const rl = b.roundL ? 1 : 0;
    const rr = b.roundR ? 1 : 0;
    if (b.x !== d.x) {
      d.x = b.x;
      setVar(el, '--bx', `${b.x}`);
      this.byDesign++;
    }
    if (b.y !== d.y) {
      d.y = b.y;
      setVar(el, '--by', `${b.y}`);
      this.byDesign++;
    }
    if (b.w !== d.w) {
      d.w = b.w;
      setVar(el, '--bw', `${b.w}`);
      this.byDesign++;
    }
    if (b.h !== d.h) {
      d.h = b.h;
      setVar(el, '--bh', `${b.h}`);
      this.byDesign++;
    }
    if (rl !== d.rl) {
      d.rl = rl;
      setVar(el, '--rl', `${rl}`);
      this.byDesign++;
    }
    if (rr !== d.rr) {
      d.rr = rr;
      setVar(el, '--rr', `${rr}`);
      this.byDesign++;
    }
    if (b.clipTop !== d.clipTop) {
      d.clipTop = b.clipTop;
      el.classList.toggle('clip-top', b.clipTop);
      this.byDesign++;
    }
    if (b.clipBottom !== d.clipBottom) {
      d.clipBottom = b.clipBottom;
      el.classList.toggle('clip-bottom', b.clipBottom);
      this.byDesign++;
    }
  }

  /** The bars' own looks (`LOOK_VARS`) told the page as custom properties on the root: at boot, and when one moves. */
  private syncLooks(): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    for (let i = 0; i < LOOK_VARS.length; i++) {
      const v = LOOK_VARS[i];
      const n = HUD_SIZES[v.key];
      if (n === this.lookWritten[i]) continue;
      this.lookWritten[i] = n;
      setVar(root, v.name, `${n}${v.unit}`);
    }
  }

  /** The world's name in the corner. The minimap's own line over its circle is told beside this (`Minimap.setName`). */
  setPlanet(p: PlanetDef): void {
    this.planetName.textContent = p.name;
    this.byDesign++;
  }

  /**
   * The kit in play: its number slots with the keys you have bound. A rebuild of the row, so every
   * write here is counted apart as one that is meant to happen -- counted where each one is made, so
   * the figure is the number and not an estimate of it. The kit's name is not written anywhere: the
   * class words left the screen in the port's pass 1 (a character will learn rather than be a class).
   */
  setKit(kit: Kit): void {
    this.slotsEl.innerHTML = '';
    this.byDesign += 1;
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
    // A new kit's bars and charge are written again whatever they held for the last one.
    this.hp.cur = NaN;
    this.res.cur = NaN;
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

  /**
   * A frame with the interface hidden (the hide key, `App.setHudHidden`): nothing is written and nothing is
   * compared, and the second the writes are counted in is still closed on time, so `stats` reads the hidden
   * second's own count -- 0 -- rather than whatever the last shown second wrote. Called in `update`'s place.
   */
  rest(): void {
    const now = performance.now();
    // The frame-rate line's own clock is kept moving too, so its first reading after the interface comes back is
    // the frames of that quarter second and not one frame over the whole time it was hidden.
    this.lastFps = now;
    this.frames = 0;
    this.roll(now);
  }

  /**
   * The interface shown again after the hide key: every "write only when changed" record let go, so the next
   * `update` writes every value afresh from what is true now -- a bar that moved while hidden shows where it
   * is, a cooldown that ran out shows ready, the weapon mark shows what the hands hold, and the quarter-second lines
   * (the frame rate, `/loc`) and the clock are written on that first frame rather than up to a quarter second
   * later. Nothing is written here; the frame after does the writing, and it is one burst, not a steady cost.
   * The kit's row itself (its cells and their marks) is the kit's and was written when it was set, hidden or
   * not, so it is not rebuilt. Every value record (a number, a word) is let go; every two-state record (a row
   * up or down, a cell lit or not) is taken from the element itself, which is the one record that cannot be
   * wrong, so the next frame writes whatever differs from the page. Turning a two-state record over instead
   * is wrong exactly when the truth changed while hidden: the turned record then agrees with the new truth and
   * nothing is written.
   */
  refresh(): void {
    this.tickNow = true;
    this.nearbyText = '\u0000';
    this.refreshBar(this.hp);
    this.refreshBar(this.res);
    this.hpLow = hasClass(this.hp.root, 'low');
    this.hpRipple = hasClass(this.hp.root, 'ripple');
    this.resShown = !hasClass(this.res.root, 'gone');
    this.breathShown = !hasClass(this.breathBar, 'off');
    this.breathCur = Number.NaN;
    this.breathLow = hasClass(this.breathBar, 'low');
    this.staminaOn = !hasClass(this.staminaBar, 'gone');
    this.staminaShown = !hasClass(this.staminaBar, 'off');
    this.staminaCur = Number.NaN;
    this.staminaTired = hasClass(this.staminaBar, 'warn');
    // The weather's line, its held words and the clock: the word and the time let go, the two classes read back.
    this.weatherText = '\u0000';
    this.weatherShown = !hasClass(this.weatherEl, 'gone');
    this.weatherHeld = hasClass(this.weatherEl, 'held');
    this.clockText = '\u0000';
    for (const cell of this.slots) {
      cell.lit = hasClass(cell.root, 'active');
      cell.ready = hasClass(cell.root, 'ready');
      cell.coolDrawn = Number.NaN;
      cell.code = '\u0000';
    }
    this.saberLit = this.saberEl ? hasClass(this.saberEl, 'active') : false;
    this.saberCostText = '';
    this.chargeShown = !this.chargeEl.hidden;
    this.chargeDrawn = Number.NaN;
    // A blow taken while hidden is not flashed after the fact: the fade is put at its end, and the next frame
    // writes the fade's element clear whatever it last wore.
    if (this.hurtLevel > 0) this.hurtLevel = 1e-6;
    this.hurtDrawn = Number.NaN;
    // The weapon mark: what the hands held let go, so the next frame works the mark out again; each slot's markup, its
    // tilt and the blade's timings let go so they are written afresh; the pair and the blade's two classes read back.
    this.mkRight = NOT_READ;
    const m = this.markDrawn;
    m.a = '\u0000';
    m.b = '\u0000';
    m.tiltA = Number.NaN;
    m.tiltB = Number.NaN;
    m.openR = Number.NaN;
    m.closeR = Number.NaN;
    m.openL = Number.NaN;
    m.closeL = Number.NaN;
    m.pair = hasClass(this.markEl, 'pair');
    m.lit = hasClass(this.markEl, 'lit');
    this.promptText = '\u0000';
  }

  /**
   * One bar let go for `refresh`: its fill and ghost written again from the next share, and whether it stands read
   * back off the element. A ghost that was easing down when the interface went is snapped back behind its fill on
   * that frame (`ageBar` with a moment left), rather than walked down long after the blow that moved it.
   */
  private refreshBar(bar: BodyBar): void {
    bar.cur = Number.NaN;
    bar.ghostAt = Number.NaN;
    if (!bar.snap) bar.ghostFor = 1e-9;
    bar.shown = !hasClass(bar.root, 'off');
  }

  /** The second the writes are counted in, closed when it is a second old. */
  private roll(now: number): void {
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.lastByDesign = this.byDesign;
    this.writes = 0;
    this.byDesign = 0;
    this.windowStart = now;
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
   * The bars carry no words on the screen, so these are the only words for them: `breath` is the
   * breath bar as drawn (its share, and `low` while it flashes), an empty string while it is down;
   * `stamina` '' while it is not in the block, 'down' while it keeps its place unseen; `bars` every
   * bar's share as drawn and what it wears; `block` the three switches; the three readouts as they
   * stand ('' while a line is off); and `mark` the weapon mark in words, which carries none on the screen
   * ('saber 22.5° lit', 'staff 45° in', 'dual X 45° lit', 'pistol', 'sword / knife'; '' before its first frame).
   */
  report(): { ops: number; icons: number; keys: string; attached: boolean; crosshair: boolean; mark: string; breath: string; stamina: string; bars: string; block: string; fps: string; weather: string; clock: string } {
    const o = this.out;
    o.icons = iconCount();
    o.crosshair = this.crosshairShown();
    const pct = (steps: number, px: number) => (steps === steps ? `${Math.round((steps / px) * 100)}%` : '?');
    o.breath = this.breathShown ? `Breath ${pct(this.breathCur, Math.max(1, HUD_TUNE.breathPixels))}${this.breathLow ? ' low' : ''}` : '';
    o.stamina = !this.staminaOn ? '' : this.staminaShown ? `Stamina ${pct(this.staminaCur, HUD_SIZES.staminaBarW)}${this.staminaTired ? ' tired' : ''}` : 'down';
    const bar = (name: string, b: BodyBar) => `${name} ${pct(b.cur, HUD_TUNE.barPixels)}${b.shown ? '' : ' gone'}`;
    o.bars = `${bar('health', this.hp)}${this.hpLow ? ' low' : ''}${this.hpRipple ? ' ripple' : ''} · ${this.resShown ? bar('force', this.res) : 'no force'} · ${o.stamina || 'no stamina'} · ${o.breath || 'no breath'}`;
    o.block = `${this.align} ${this.look} ${this.edge}`;
    o.fps = this.fpsShown ? this.fps.textContent ?? '' : '';
    o.weather = this.weatherShown ? `${this.weatherText}${this.weatherHeld ? HELD_WORDS : ''}` : '';
    o.clock = this.clockShown ? this.clockText : '';
    let keys = '';
    for (let i = 0; i < this.kitSlotCount; i++) keys += (keys ? ' ' : '') + keyLabel(this.slots[i].code);
    o.keys = keys;
    o.mark = this.markDrawn.a === '\u0000' ? '' : markWords(this.markOut, this.markDrawn.lit);
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
   * Put the keys that are bound now on the cells. Called when the bindings change — at once through
   * `hudBindingsChanged`, and in any case at the display's own four-times-a-second tick, so a rebind
   * reaches the cells whether or not whoever rebound said so. (The corner strip that named the map's,
   * the inventory's and the spawner's keys went with the top-right box: the keys are the Controls page's.)
   */
  refreshKeys(_always = false): void {
    for (const cell of this.slots) {
      const code = this.codeOf(cell.action);
      if (code === cell.code) continue;
      cell.code = code;
      cell.cap.textContent = keyLabel(code);
      this.writes++;
    }
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

  // -------------------------------------------------------------------------------------------
  // The frame.

  /**
   * One frame of the slow half. `x, y, z` are where the corner's `/loc` line says you are, in whatever
   * frame the caller has chosen for it: on a planet the game hands over the map window's own pair
   * (`main.ts` works it out before the call), so the line and the map say the same two numbers, and in
   * space the game's own frame, which a story's place and a waypoint take there. `breath` is the player's
   * own breath if they have any to show, and nothing at all otherwise — which is what dry land hands
   * over, and what every caller written before there was breath hands over by leaving the argument off.
   * `clock` is the world's time of day as words, which the caller keeps and makes again only when the
   * minute turns (`App.clockWords`), so handing it over every frame makes nothing; it is written while
   * the clock's line is up and the words have changed, which is once a minute of the world's day.
   */
  update(dt: number, x: number, y: number, z: number, kit: Kit, hp: number, maxHp: number, clock: string, creatureName: string, saberOn: boolean, breath?: BarReadout | null): void {
    this.frames++;
    this.frameDt = dt;
    const now = performance.now();
    const acc = (now - this.lastFps) / 1000;
    if (acc >= 0.25 || this.tickNow) {
      this.tickNow = false;
      this.lastFps = now;
      // The frame rate only while its line is up: off, it is not written at all.
      if (this.fpsShown) {
        this.fps.textContent = `${acc > 0 ? Math.round(this.frames / acc) : 0} fps`;
        this.byDesign++;
      }
      this.loc.textContent = `/loc ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`;
      this.frames = 0;
      this.byDesign++;
      // A rebind nobody announced and the ghost's ease if it has been tried at the console: neither is work for a frame,
      // and four times a second is not one. (What is in the hands is the weapon mark's, read each frame below, so its
      // blade draws out with the real one and its tilt follows the stance at the press of the key.)
      this.refreshKeys();
      this.syncGhost();
    }
    if (this.clockShown && clock !== this.clockText) {
      this.clockText = clock;
      this.clock.textContent = clock;
      this.byDesign++;
    }
    this.roll(now);
    // The nameplate over a creature's head says what you are looking at; with one, the corner says
    // where you are and nothing else, and an empty name is how the game asks for that. The name is
    // asked for at its own rate (`HUD_WIRING.nearbyHz`), so this compares and almost never writes.
    if (creatureName !== this.nearbyText) {
      this.nearbyText = creatureName;
      this.nearby.textContent = creatureName ? `nearby: ${creatureName}` : '';
      this.writes++;
    }
    // A bar is written only when its share has moved by a pixel of the bar's own length. No bar
    // carries a word or a number any more (the interface rewrite): the bar is the reading.
    const px = HUD_TUNE.barPixels;
    // The share is held between none and all: a bar told a share outside that wrote a length the
    // browser threw away, which left the last one on the screen.
    const share = maxHp > 0 ? hp / maxHp : 0;
    this.shareIn = share;
    this.setBar(this.hp, px);
    // Health's two looks low down, each a class the stylesheet eases or runs: the dark red at and under
    // `hpLow`, the ripple under `hpRipple`. One write as each threshold is crossed, none otherwise.
    const low = share <= HUD_SIZES.hpLow;
    if (low !== this.hpLow) {
      this.hpLow = low;
      this.hp.root.classList.toggle('low', low);
      this.writes++;
    }
    const ripple = share < HUD_SIZES.hpRipple;
    if (ripple !== this.hpRipple) {
      this.hpRipple = ripple;
      this.hp.root.classList.toggle('ripple', ripple);
      this.writes++;
    }
    this.ageFull(this.hp, px);
    const r = kit.resource;
    if (!!r !== this.resShown) {
      // A kit with no Force pool: the bar out of the block, and the bars placed again without it (stamina takes
      // Force's place against health). A change of kit, not a frame's work.
      this.resShown = !!r;
      this.res.root.classList.toggle('gone', !r);
      this.writes++;
      this.layoutBars();
    }
    if (r) {
      this.shareIn = r.max > 0 ? r.value / r.max : 0;
      this.setBar(this.res, px);
      this.ageFull(this.res, px);
    }
    // Breath, which is a bar that is not shown at all on dry land and costs such a frame nothing.
    this.setBreath(breath ?? null);
    // The weapon mark: what the hands hold compared by identity and the stance by its word, and the blade by one
    // switch, so a steady frame compares a handful of values and writes nothing.
    this.readMark(kit.id, saberOn);
    // The ghosts' eases ending: once a frame, and nothing is written in a steady one.
    this.ageBars();
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
   * under the fill, where it cannot be seen. Nothing is written while nothing has moved. The share is
   * `shareIn`, set by the caller just before: a field, so no fraction is handed to the call.
   */
  private setBar(bar: BodyBar, px: number): void {
    const steps = Math.round(Math.max(0, Math.min(1, this.shareIn)) * px);
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
   * Health or Force going away when full (the owner's: "disappear if full after 1.5 seconds, just like stamina"):
   * `HUD_SIZES.fullLinger` seconds after the bar is full as drawn it takes `off`, and the moment it drops it takes it
   * off again. One write each way and none in between; the bar keeps its place in the block, so nothing else moves.
   */
  private ageFull(bar: BodyBar, px: number): void {
    if (bar.cur === px) bar.sinceFull += this.frameDt;
    else bar.sinceFull = 0;
    const show = bar.cur !== px || bar.sinceFull < HUD_SIZES.fullLinger;
    if (show === bar.shown) return;
    bar.shown = show;
    bar.root.classList.toggle('off', !show);
    this.writes++;
  }

  /**
   * The breath bar. It stands while there is breath to show and it is not full (`breathRow` in `hudMath`), and it is
   * not shown otherwise — a frame on dry land reaches the first line, finds the bar down and already down, and writes
   * nothing. Its place in the block is kept either way (`barLayout`), so it coming up moves nothing.
   *
   * What it costs while it is up: the bar appearing is one write, then one per pixel of the bar's own length as it
   * drains (`HUD_TUNE.breathPixels`), one as it goes under `breathFlashBelow` and starts flashing (and one if it comes
   * back over), and one as it goes down again. Nothing is compared against the page: what was written is remembered
   * here, as everywhere else in this file. It is the accent's bright blue, the stylesheet's own default fill.
   */
  private setBreath(r: BarReadout | null): void {
    // Read off the breath's own record (`breathOf`), never handed its two numbers: a fraction handed to a call is a number made.
    const b = r ? breathOf(r, this.breathOut) : noBreath(this.breathOut);
    const show = !!r && b.show;
    if (show !== this.breathShown) {
      this.breathShown = show;
      this.breathBar.classList.toggle('off', !show);
      this.writes++;
      // Whatever it held when it went down is written again from scratch the next time it comes up,
      // so a bar that comes back never shows the last dive's share for a frame.
      if (!show) this.breathCur = NaN;
    }
    if (!show || !r) return;
    const px = Math.max(1, HUD_TUNE.breathPixels);
    const steps = Math.round(b.share * px);
    if (steps !== this.breathCur) {
      this.breathCur = steps;
      this.breathFill.style.transform = `scaleX(${steps / px})`;
      this.writes++;
    }
    if (b.low !== this.breathLow) {
      this.breathLow = b.low;
      this.breathBar.classList.toggle('low', b.low);
      this.writes++;
    }
  }

  /**
   * The stamina bar (the speed classes: src/anim/). `pool` is the body's own pool (what is left, and whether the
   * body is tired), read here so that no number is handed across the call; `max` its size; `show` the pool's own word
   * for whether its bar is up (while it is not full, and for a moment after); and `on` whether the speed classes are
   * in force for the body at all. Called by the game each frame it draws the display, before `update`; a frame with
   * the pool full and the bar down reaches the third line and writes nothing.
   *
   * With the classes off the bar is not in the block at all (`gone`), and the bars are placed without it. With them on
   * it keeps its place while it is down (`off` hides it and never takes it out of the block), so nothing moves each
   * time a sprint begins.
   *
   * What it costs while it is up: one write as the bar comes up and one as it goes, one per pixel of the bar's own
   * length as the pool moves (`HUD_SIZES.staminaBarW`), and one each time the body becomes tired or rested (the bar
   * wears the warning colour while tired: no run until the pool is back).
   */
  setStamina(pool: { readonly value: number; readonly tired: boolean }, max: number, show: boolean, on: boolean): void {
    if (on !== this.staminaOn) {
      this.staminaOn = on;
      this.staminaBar.classList.toggle('gone', !on);
      this.writes++;
      // The bars placed again with it or without it: a change of the speed classes, not a frame's work.
      this.layoutBars();
    }
    if (!on) show = false;
    const value = pool.value;
    const tired = pool.tired;
    if (show !== this.staminaShown) {
      this.staminaShown = show;
      this.staminaBar.classList.toggle('off', !show);
      this.writes++;
      // Written again from scratch the next time it comes up, so it never shows the last sprint's share for a frame.
      if (!show) this.staminaCur = NaN;
    }
    if (!show) return;
    // A step of the bar is a pixel of the long bar at scale 1 (`staminaBarW`): the pool moves all the time while it
    // shows, so it is compared no finer than can be seen.
    const px = HUD_SIZES.staminaBarW;
    const steps = Math.round(Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * px);
    if (steps !== this.staminaCur) {
      this.staminaCur = steps;
      this.staminaFill.style.transform = `scaleX(${steps / px})`;
      this.writes++;
    }
    if (tired !== this.staminaTired) {
      this.staminaTired = tired;
      this.staminaBar.classList.toggle('warn', tired);
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
  private ageBars(): void {
    // The two are stepped by name rather than through a list: a list here would be a new array on
    // every frame the display runs, which is the one thing the frame path must never do. The frame's
    // seconds are `frameDt`, a field, so no fraction is handed to either call.
    this.ageBar(this.hp);
    this.ageBar(this.res);
  }

  private ageBar(bar: BodyBar): void {
    if (bar.ghostFor <= 0) return;
    bar.ghostFor -= this.frameDt;
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

  /**
   * The weapon mark, once a frame. What the hands hold is compared by identity, and the kit, the bare-hands switch, the
   * stand-in blaster's kind and the stance by their words, against what was last read: while none has changed nothing is
   * worked out and nothing written. Then the blade: `lit` on the mark while the real blade is lit and these hands can
   * light it (or always, with the switch off), one class the moment it changes, which starts the stylesheet's draw in or
   * out at the blade's own timing. With no source (a test's display, before the game hands one over) the hands are
   * empty and the kit alone decides.
   */
  private readMark(kitId: string, saberOn: boolean): void {
    const src = this.handSource;
    const right = src ? src.equipped.right : null;
    const left = src ? src.equipped.left : null;
    const bare = !!src && src.fists === true;
    const gun = src && typeof src.gunClass === 'string' ? src.gunClass : '';
    const style = src && src.saber ? src.saber.style : 'medium';
    if (right !== this.mkRight || left !== this.mkLeft || kitId !== this.mkKit || bare !== this.mkBare || gun !== this.mkGun || style !== this.mkStyle) {
      this.mkRight = right;
      this.mkLeft = left;
      this.mkKit = kitId;
      this.mkBare = bare;
      this.mkGun = gun;
      this.mkStyle = style;
      const m = this.markIn;
      m.right = right && typeof right.class === 'string' ? right.class : right ? '?' : '';
      m.left = left && typeof left.class === 'string' ? left.class : left ? '?' : '';
      m.kit = kitId;
      m.bare = bare;
      m.gun = gun;
      m.style = style;
      weaponMark(m, this.markOut);
      this.drawMark();
    }
    const lit = !this.markFollows || (saberOn && this.markOut.lights);
    if (lit !== this.markDrawn.lit) {
      this.markDrawn.lit = lit;
      this.markEl.classList.toggle('lit', lit);
      this.writes++;
    }
  }

  /**
   * The mark as `weaponMark` worked it out, written: each slot's markup when what it shows changed, each slot's tilt
   * (a custom property the stylesheet turns the saber by, easing to a new stance), the pair's class, and the blade's
   * timings in each hand when they changed. Only on a change of what is held or of the stance: never in a steady frame.
   */
  private drawMark(): void {
    const o = this.markOut;
    const d = this.markDrawn;
    if (o.a !== d.a) {
      d.a = o.a;
      this.markA.innerHTML = markSvg(o.a, false);
      this.writes++;
    }
    if (o.b !== d.b) {
      d.b = o.b;
      this.markB.innerHTML = markSvg(o.b, true);
      this.writes++;
    }
    if (o.tiltA !== d.tiltA) {
      d.tiltA = o.tiltA;
      setVar(this.markA, '--mk-tilt', `${o.tiltA}`);
      this.writes++;
    }
    if (o.tiltB !== d.tiltB) {
      d.tiltB = o.tiltB;
      setVar(this.markB, '--mk-tilt', `${o.tiltB}`);
      this.writes++;
    }
    const pair = o.b !== '';
    if (pair !== d.pair) {
      d.pair = pair;
      this.markEl.classList.toggle('pair', pair);
      this.writes++;
    }
    // The blade's own timing in each hand (the right's draws the single saber, the staff and the X's first; the left's
    // the X's second and a pair's saber), or the default where there is none to read.
    d.openR = this.bladeVar('--mk-open', 'right', false, d.openR);
    d.closeR = this.bladeVar('--mk-close', 'right', true, d.closeR);
    d.openL = this.bladeVar('--mk-open2', 'left', false, d.openL);
    d.closeL = this.bladeVar('--mk-close2', 'left', true, d.closeL);
  }

  /** One of the blade's timings: read from the source (the default where it has none), written when it moved; what is now written. */
  private bladeVar(name: string, hand: 'right' | 'left', closing: boolean, was: number): number {
    const src = this.handSource;
    const read = src && typeof src.bladeSeconds === 'function' ? src.bladeSeconds(hand, closing) : Number.NaN;
    const s = Number.isFinite(read) && read > 0 ? read : HUD_SIZES.markBladeSeconds;
    if (s === was) return was;
    setVar(this.markEl, name, `${s}`);
    this.writes++;
    return s;
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
    this.drawGrappleMark(this.grappleMark);
  }

  /**
   * The grapple's mark: a diamond with its corners on the axes where the dart would bite -- `good` when a press
   * fires, `warn` when that is a vehicle's hull (wave 3), at half alpha from the snap hold, `muted` while attached for
   * the next anchor, `bad` for a refused press's moment -- and a small `accent` mark at the anchor while the rope is out. While the rope is attached, a
   * thin arc round the crosshair says how much of the longest rope is out, clockwise from twelve, in `muted` and in
   * `warn` past `grappleRopeWarn`. Drawn whatever the Jedi's crosshair switch says, behind its own; never at a ship's
   * controls or with the mouse free. Palette indices and kept numbers only.
   */
  private drawGrappleMark(m: HudGrappleMark): void {
    const c = this.canvas;
    const col = this.colours;
    if (!c || !col || !m.enabled || this.mouseFreeDrawn || this.bodyHidden()) return;
    const s = this.scale;
    const S = HUD_SIZES;
    const width = S.grappleMarkWidth * s;
    if (m.onScreen && (m.shows || m.flash > 0)) {
      const colour = m.flash > 0 && !m.shows ? col.bad : m.next ? col.muted : m.vehicle ? col.warn : col.good;
      const alpha = S.grappleMarkAlpha * (m.held && m.flash <= 0 ? 0.5 : 1);
      this.diamond(m.x, m.y, S.grappleMark * s, width, colour, alpha);
    }
    if (m.anchorOn) this.diamond(m.ax, m.ay, S.grappleAnchor * s, width, col.accent, S.grappleMarkAlpha);
    if (m.ropeUsed > 0) {
      const used = m.ropeUsed < 1 ? m.ropeUsed : 1;
      c.arc(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2), S.grappleRopeArc * s, 0, 360 * used, S.grappleRopeArcWidth * s, used > S.grappleRopeWarn ? col.warn : col.muted, S.grappleMarkAlpha);
      this.out.ops++;
    }
  }

  /** A diamond of four strokes, its corners `r` out on the axes. */
  private diamond(x: number, y: number, r: number, width: number, colour: number, alpha: number): void {
    const c = this.canvas!;
    c.line(x, y - r, x + r, y, width, colour, alpha);
    c.line(x + r, y, x, y + r, width, colour, alpha);
    c.line(x, y + r, x - r, y, width, colour, alpha);
    c.line(x - r, y, x, y - r, width, colour, alpha);
    this.out.ops += 4;
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

/**
 * Whether an element wears a class, read off the element (`refresh`'s two-state records). A stand-in for the page
 * in a test need not have `contains`, where the answer is simply no, as `bodyHidden` reads it.
 */
function hasClass(el: { classList?: { contains?: (name: string) => boolean } }, name: string): boolean {
  const list = el.classList;
  return !!list && typeof list.contains === 'function' ? list.contains(name) : false;
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
const NAMED_CAPS: Record<string, string> = { Space: 'Space', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps', Escape: 'Esc', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Pause: 'Pause', Insert: 'Ins' };

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
    this.roll();
    this.place();
  }

  /**
   * A frame with the interface hidden (the hide key): nothing is pulled or written, and the second the writes are
   * counted in is still closed on time, so `stats` reads the hidden second's own 0. Called in `update`'s place.
   */
  rest(): void {
    this.roll();
  }

  /**
   * The interface shown again: every row's "written when changed" record let go, so the next `update` writes each
   * row standing afresh -- its name, its column and its bar -- from the group as it is now; its three marks are taken
   * from the row's own classes, as the display's two-state records are (`Hud.refresh` says why).
   */
  refresh(): void {
    for (const row of this.rows) {
      row.name = '\u0000';
      row.atMode = -1;
      row.atNum = AT_RESET;
      row.health = AT_RESET;
      row.leader = hasClass(row.root, 'leader');
      row.you = hasClass(row.root, 'you');
      row.away = hasClass(row.root, 'away');
    }
  }

  private roll(): void {
    const now = performance.now();
    if (now - this.windowStart < 1000) return;
    this.lastWrites = this.writes;
    this.writes = 0;
    this.windowStart = now;
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

/**
 * A quantised distance as it reads: metres, and kilometres to a tenth from `kmFrom` up. The words
 * themselves are `hudMath`'s, so the roster down the side of the screen and the death card's list of
 * facilities spell a distance the same way and follow the same live threshold -- the rule the action
 * bar and the Controls page already keep for a key's name.
 */
export function distanceWords(metres: number): string {
  return metreWords(metres, ROSTER_TUNE.kmFrom);
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
