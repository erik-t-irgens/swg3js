// The interface's palette (src/core/palette.ts) against its one home (src/style.css): that the
// eighteen names in the stylesheet's `:root` are exactly the eighteen the module expects and carry
// exactly the values it falls back on, so a rename or a drift in one file fails here rather than on
// the screen; that every value is a colour a browser will take; that the four damage layers are four
// distinct colours, which is the whole point of having them; and that the module is safe to import
// with no document at all, which is how this test imports it.
//
// Synthetic and hand-written throughout: nothing here comes from the game's own files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COL, COLOURS, PALETTE_FALLBACK, PALETTE_NAMES, colourHex, colourOf, initPalette, layerColours, paletteRead, parseColour } from '../../../src/core/palette.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8');

// ---------------------------------------------------------------------------------------------
// The table itself.
{
  ok(PALETTE_NAMES.length === 18, `the palette is eighteen names (${PALETTE_NAMES.length})`);
  ok(new Set(PALETTE_NAMES).size === 18, 'no name is repeated');
  ok(PALETTE_FALLBACK.length === PALETTE_NAMES.length, 'a fallback value for every name');
  ok(COLOURS.length === PALETTE_NAMES.length, 'the live table is the same length');
  let ordered = true;
  for (let i = 0; i < PALETTE_NAMES.length; i++) if (COL[PALETTE_NAMES[i]] !== i) ordered = false;
  ok(ordered, 'COL is each name\'s index into the table, in order');

  let legal = true;
  const bad: string[] = [];
  for (let i = 0; i < PALETTE_FALLBACK.length; i++) {
    const v = PALETTE_FALLBACK[i];
    const isHex = /^#[0-9a-f]{6}$/i.test(v);
    const isRgba = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[0-9.]+\s*)?\)$/.test(v);
    if (!isHex && !isRgba) {
      legal = false;
      bad.push(`${PALETTE_NAMES[i]}=${v}`);
    }
    if (parseColour(v) === null) {
      legal = false;
      bad.push(`${PALETTE_NAMES[i]} does not parse`);
    }
  }
  ok(legal, `every name in the table is a legal colour${bad.length ? `: ${bad.join(', ')}` : ''}`);

  // Rule 1 of the design: nothing is drawn in pure white or pure black, so neither sits at the end of
  // the range where a bright sky or a black sky swallows it.
  ok(colourHex('ink') !== 0xffffff && colourHex('void') !== 0x000000, 'nothing is pure white or pure black');
}

// ---------------------------------------------------------------------------------------------
// The stylesheet is the one home: the marked block must hold exactly these names and values.
{
  const start = css.indexOf('/* palette:');
  const end = css.indexOf('/* /palette */');
  ok(start > 0 && end > start, 'src/style.css carries the marked palette block');
  const block = css.slice(start, end);
  const declared = new Map<string, string>();
  const re = /--([a-z-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) declared.set(m[1], m[2].trim());

  const missing = PALETTE_NAMES.filter((n) => !declared.has(n));
  ok(missing.length === 0, `the stylesheet declares every name the module expects${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  const extra = [...declared.keys()].filter((n) => !(PALETTE_NAMES as readonly string[]).includes(n));
  ok(extra.length === 0, `and declares nothing else in the block${extra.length ? `: ${extra.join(', ')}` : ''}`);

  const drift: string[] = [];
  for (let i = 0; i < PALETTE_NAMES.length; i++) {
    const name = PALETTE_NAMES[i];
    const want = PALETTE_FALLBACK[i];
    const got = declared.get(name);
    if (got !== want) drift.push(`${name}: stylesheet ${got}, module ${want}`);
  }
  ok(drift.length === 0, `every value matches name for name${drift.length ? `: ${drift.join('; ')}` : ''}`);

  // The names the panels already used keep working, pointing at the eighteen.
  ok(/--text:\s*var\(--ink\)/.test(css), 'the panels\' --text points at ink');
  ok(/--panel-border:\s*var\(--edge\)/.test(css), 'the panels\' --panel-border points at edge');
  ok(/--hud-scale:\s*1;/.test(css), 'the HUD scale is declared, and starts at 1');
  ok(/@import\s+'\.\/ui\/hud\.css'/.test(css), "the HUD's own stylesheet is pulled in before any script runs");
}

// ---------------------------------------------------------------------------------------------
// The four damage layers, which the bar, the pip and the hull flash all read.
{
  const layers = layerColours();
  const values = [layers.shield, layers.armor, layers.component, layers.chassis];
  ok(new Set(values).size === 4, 'the four layer colours are four distinct values');
  ok(layers.component !== layers.chassis, 'a part hit and a hull hit no longer flash identically');
  ok(values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff), 'each is a 24-bit number a material can take');
  ok(layers.shield === 0x9fd8ff && layers.armor === 0xffb070 && layers.chassis === 0xff8a50 && layers.component === 0xffd27f, 'and they are the values the bars are drawn in');
}

// ---------------------------------------------------------------------------------------------
// Parsing, and the fallbacks with no document.
{
  ok(parseColour('#7fd7ff') === 0x7fd7ff, 'a six-digit hex parses');
  ok(parseColour('#abc') === 0xaabbcc, 'a three-digit hex parses');
  ok(parseColour('rgba(24, 38, 54, 0.7)') === ((24 << 16) | (38 << 8) | 54), 'a translucent entry gives its colour without its alpha');
  ok(parseColour('rgb(1,2,3)') === ((1 << 16) | (2 << 8) | 3), 'rgb() parses');
  ok(parseColour('cornflowerblue') === null && parseColour('') === null && parseColour(undefined) === null, 'anything else is null, not a wrong colour');

  ok(initPalette() === 0, 'initPalette with no document reads nothing and does not throw');
  ok(paletteRead() === false, 'and says so');
  ok(COLOURS[COL.accent] === PALETTE_FALLBACK[COL.accent], 'so the table is still the fallbacks');
  ok(colourOf(999) === COLOURS[COL.ink], 'a colour index out of range gives ink, never undefined');
  ok(colourOf(COL.void) === '#060a12', 'and a good one gives its string');
}

// ---------------------------------------------------------------------------------------------
// The reading path itself, which is the one thing in the module that can silently leave the canvas on
// the fallbacks while the panels show the stylesheet's values — and the one thing the drift check
// above cannot catch. A stub root and a stub `getComputedStyle` stand in for a browser.
{
  const table = COLOURS; // the array identity, which captors keep reading
  const supplied = new Map<string, string>([
    ['--accent', ' #112233'],
    ['--ink', '#445566 '],
    ['--void', '  #010203  '],
    // `--muted` is deliberately left out: a half-edited stylesheet must not blank a colour.
    ['--muted', ''],
  ]);
  const root = { nodeType: 1 } as unknown as Element;
  const previous = (globalThis as Record<string, unknown>).getComputedStyle;
  let askedFor: unknown = null;
  (globalThis as Record<string, unknown>).getComputedStyle = (el: unknown) => {
    askedFor = el;
    return { getPropertyValue: (name: string) => supplied.get(name) ?? '' };
  };
  try {
    const found = initPalette(root);
    ok(found === 3, `the three the stub supplies are read, and only those (${found})`);
    ok(askedFor === root, 'from the root it was handed, not the document');
    ok(paletteRead() === true, 'and the module says the values came from the stylesheet');
    ok(COLOURS === table, 'the live table is the same array, so anything that captured it sees the change');
    ok(COLOURS[COL.accent] === '#112233' && COLOURS[COL.ink] === '#445566' && COLOURS[COL.void] === '#010203', 'each value is trimmed and written in place');
    ok(COLOURS[COL.muted] === PALETTE_FALLBACK[COL.muted], 'a name the stylesheet does not carry keeps its fallback rather than going empty');
    ok(colourHex('accent') === 0x112233, 'and the number the hull flash reads follows the value that was read');
    const again = initPalette(root);
    ok(again === 3 && COLOURS[COL.accent] === '#112233', 'a second call is the same work and the same answer');
  } finally {
    // Put the table and the global back, so the checks after this one see the fallbacks again.
    if (previous === undefined) delete (globalThis as Record<string, unknown>).getComputedStyle;
    else (globalThis as Record<string, unknown>).getComputedStyle = previous;
    for (let i = 0; i < PALETTE_FALLBACK.length; i++) COLOURS[i] = PALETTE_FALLBACK[i];
  }
  ok(COLOURS[COL.accent] === PALETTE_FALLBACK[COL.accent], 'and the table is put back for whatever comes after');
}

console.log(`\n${checks} checks passed`);
