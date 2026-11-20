// The interface's colours: eighteen names, one table, one home.
//
// The values live in `src/style.css` on `:root`, between the `palette` markers, so the first paint is
// right before any script runs and the panels' 231 `var(--…)` uses keep reading the same declarations
// the canvas does. This module reads them once at boot, and again whenever a colour theme is switched
// (`applyTheme` in `themes.ts`, which writes a theme's eighteen over these on the root's own style), and
// keeps them as an array of ready CSS strings
// indexed by `COL`, so nothing on the screen builds a colour string in a frame. If a declaration is
// missing (a half-edited stylesheet) the literal below is used instead, so the canvas can never be
// handed `undefined` for a colour.
//
// It is in `core` rather than `ui` because the ship's hull flash reads the four layer colours from here
// as numbers, which is what keeps a bar, a pip and the flash on the model from drifting apart.
//
// Alpha is never baked into a string: the overlay sets `globalAlpha` and strokes with the opaque entry,
// which costs nothing and allocates nothing. The four translucent entries (`plate`, `panel`, `rule`,
// `edge`) carry their own alpha because that alpha is part of what they mean.

/** The eighteen, in index order. `COL` is the index of each. */
export const PALETTE_NAMES = [
  // the instrument: the chrome everything structural is drawn in
  'accent',
  'ink',
  'muted',
  'void',
  'plate',
  'panel',
  'rule',
  'edge',
  // the signals: state, and nothing else
  'good',
  'warn',
  'bad',
  'hot',
  // the ship's four damage layers: the same colour on the bar, on the pip and on the hull flash
  'shield',
  'armour',
  'chassis',
  'component',
  // the two ramps' dark ends (health runs to `bad`, the class pool to `accent`)
  'health',
  'pool',
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

/**
 * The fallbacks, and the values `src/style.css` must declare. `palette.test.ts` checks the stylesheet
 * against this table name for name and value for value, so a change in one file without the other
 * fails a test rather than the screen.
 *
 * Every one of these except `component` was already on the screen somewhere before this pass;
 * `component` exists so that a part hit and a hull hit stop looking identical.
 */
export const PALETTE_FALLBACK: readonly string[] = Object.freeze([
  '#7fd7ff', // accent: the interface's own colour
  '#e8f1f8', // ink: primary text, the boresight, neutral marks (never pure white)
  '#9fb3c4', // muted: secondary text, a bar's ghost, a disabled slot
  '#060a12', // void: the dark under everything (never pure black)
  'rgba(24, 38, 54, 0.7)', // plate: raised cells
  'rgba(8, 14, 24, 0.62)', // panel: panel and readout backgrounds
  'rgba(127, 215, 255, 0.18)', // rule: hairlines
  'rgba(127, 215, 255, 0.28)', // edge: a panel's or a cell's 1 px border
  '#6adf7a', // good: ready, friendly, on target
  '#e2a33c', // warn: caution
  '#ff5a4a', // bad: danger, an enemy, a kill
  '#ffb040', // hot: a charge filling, a burn, a boost in use
  '#9fd8ff', // shield
  '#ffb070', // armour
  '#ff8a50', // chassis
  '#ffd27f', // component
  '#b8322a', // health: the health ramp's dark end
  '#2d7fd6', // pool: the class pool ramp's dark end
]);

type ColIndex = { readonly [K in PaletteName]: number };

/** Colour indices, which is what the overlay's calls take. */
export const COL: ColIndex = Object.freeze(
  PALETTE_NAMES.reduce((acc, name, i) => {
    (acc as Record<string, number>)[name] = i;
    return acc;
  }, {} as Record<string, number>) as ColIndex,
);

/**
 * The live table: ready CSS strings, one per name, in `COL` order. The array itself is never replaced,
 * so anything that captured it keeps reading the current values.
 */
export const COLOURS: string[] = PALETTE_FALLBACK.slice();

let readFromCss = false;

/** Whether the values in `COLOURS` came from the stylesheet or are still the fallbacks. */
export function paletteRead(): boolean {
  return readFromCss;
}

/**
 * Read the eighteen from `:root` at boot, and again when a colour theme is switched (`applyTheme`). Safe to
 * call again (the same work, and the theme's answer once one is on) and safe to call with no document at
 * all, which is how a node test imports this module. Returns how many names the page supplied.
 */
export function initPalette(root?: Element): number {
  const el = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!el || typeof getComputedStyle !== 'function') return 0;
  const style = getComputedStyle(el);
  let found = 0;
  for (let i = 0; i < PALETTE_NAMES.length; i++) {
    const value = style.getPropertyValue(`--${PALETTE_NAMES[i]}`).trim();
    if (!value) continue;
    COLOURS[i] = value;
    found++;
  }
  readFromCss = found > 0;
  return found;
}

/**
 * Who reads the palette into something of their own (a three material's colour, the hull flash's numbers, a label drawn
 * once onto a canvas) and must read it again when a theme is switched (the Colours switch, `applyTheme` in
 * `themes.ts`; the interface rewrite's second wave, item 11). The page's own `var(--…)` uses and every stroke the
 * overlay makes read the table live and need nothing. A plain list, called after the table is read again and never in
 * a frame; a listener that throws does not stop the others.
 */
const changeListeners: (() => void)[] = [];

/** Hear about a theme switched. Returns the call that stops hearing about it. */
export function onPaletteChange(fn: () => void): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

/** The palette has been read again: everything that keeps a copy of it takes the new values. */
export function paletteChanged(): void {
  for (let i = 0; i < changeListeners.length; i++) {
    try {
      changeListeners[i]();
    } catch (err) {
      console.warn('a palette listener threw', err);
    }
  }
}

/**
 * Two palette entries mixed, `t` of the first over the second, as a 24-bit number: a shade three wants as one number
 * and the palette has no name for (the space map's faint grid is the pool's blue far down toward `void`). Alpha is
 * left out, as `colourHex` leaves it.
 */
export function colourMix(a: PaletteName, b: PaletteName, t: number): number {
  const x = colourHex(a);
  const y = colourHex(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * k + ((y >> shift) & 255) * (1 - k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** One colour as a CSS string. Out of range gives `ink`, so a bad index cannot blank a stroke. */
export function colourOf(i: number): string {
  return COLOURS[i] ?? COLOURS[COL.ink];
}

/**
 * A palette entry as a 24-bit number, for three's materials and lights (the hull flash). Only the six
 * hex forms parse; a translucent entry gives its colour without its alpha. An unreadable value gives
 * the fallback's, so a stylesheet typo cannot turn a flash black.
 */
export function colourHex(name: PaletteName): number {
  const i = COL[name];
  return parseColour(COLOURS[i]) ?? parseColour(PALETTE_FALLBACK[i]) ?? 0xffffff;
}

/** `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)` to a 24-bit number; anything else null. */
export function parseColour(value: string | undefined): number | null {
  if (!value) return null;
  const s = value.trim();
  if (s.charCodeAt(0) === 35) {
    const body = s.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(body)) {
      const r = parseInt(body[0] + body[0], 16);
      const g = parseInt(body[1] + body[1], 16);
      const b = parseInt(body[2] + body[2], 16);
      return (r << 16) | (g << 8) | b;
    }
    if (/^[0-9a-fA-F]{6}$/.test(body)) return parseInt(body, 16);
    return null;
  }
  const m = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*(?:[,/]\s*([0-9.%]+)\s*)?\)$/.exec(s);
  if (!m) return null;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (clamp(Number(m[1])) << 16) | (clamp(Number(m[2])) << 8) | clamp(Number(m[3]));
}

/**
 * The four damage layers as numbers, keyed as `CombatLayer` is. This is what `LAYER_FLASH` becomes, so
 * the colour a hit flashes on the hull is the colour its bar and its pip are drawn in.
 */
export function layerColours(): { shield: number; armor: number; component: number; chassis: number } {
  return {
    shield: colourHex('shield'),
    armor: colourHex('armour'),
    component: colourHex('component'),
    chassis: colourHex('chassis'),
  };
}
