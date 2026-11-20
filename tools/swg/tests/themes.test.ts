// The interface's colour themes (the interface rewrite's second wave, item 11): the game's own theme table
// (`src/core/themes.ts`), held to the check the owner's examples page was built against, Default held to the palette,
// the Colours switch on the Interface page, and a theme put on and taken off again through `applyTheme` on a stand-in
// page, with everyone who keeps a copy of a colour (the hull flash among them) told.
//
// The check is the examples page's own (`themecheck.mjs`, brought in here as it stands: the same rules, numbers and
// backdrops), run over the game's table rather than the page. Its words against the dark under everything, its type on
// the action bar's plate over a bright desert, a forest and the night, the signals told apart from each other and from
// the interface's colour, a ship's four layers apart, and the bars' colours turning where they turn.
//
// Run: node tools/swg/tests/themes.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const text = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const { THEMES, THEME_GROUPS, DEFAULT_THEME, themeById, applyTheme } = await import('../../../src/core/themes.ts');
const { PALETTE_NAMES, PALETTE_FALLBACK, COLOURS, COL, onPaletteChange } = await import('../../../src/core/palette.ts');
const { DEFAULT_SETTINGS } = await import('../../../src/core/settings.ts');

// ---------------------------------------------------------------- the check, as the examples page's themecheck.mjs has it
const ROLES = ['accent', 'ink', 'muted', 'void', 'plate', 'panel', 'rule', 'edge', 'good', 'warn', 'bad', 'hot', 'shield', 'armour', 'chassis', 'component', 'health', 'pool'];
const ALPHA: Record<string, [number, number]> = { plate: [0.6, 0.9], panel: [0.55, 0.85], rule: [0.12, 0.4], edge: [0.2, 0.65] };
const BACKDROPS: Record<string, number[]> = { day: [217, 190, 143], forest: [63, 90, 58], night: [20, 28, 48] };
type Parsed = { rgb: number[]; a: number };
function parse(s: string): Parsed | null {
  s = String(s).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (x: number[], y: number[]) => {
  const a = lum(x);
  const b = lum(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const over = (fg: number[], a: number, bg: number[]) => fg.map((c, i) => c * a + bg[i] * (1 - a));
function lab([r, g, b]: number[]): number[] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dE = (p: number[], q: number[]) => {
  const a = lab(p);
  const b = lab(q);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};
function check(t: { v: readonly string[] }): { errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  if (!Array.isArray(t.v) || t.v.length !== 18) return { errors: [`needs 18 values, has ${t.v?.length}`], warns };
  const c: Record<string, Parsed> = {};
  for (let i = 0; i < 18; i++) {
    const p = parse(t.v[i]);
    if (!p) {
      errors.push(`${ROLES[i]}: cannot read "${t.v[i]}"`);
      continue;
    }
    const name = ROLES[i];
    if (ALPHA[name]) {
      if (p.a >= 1 || p.a < ALPHA[name][0] || p.a > ALPHA[name][1]) errors.push(`${name}: alpha ${p.a} outside ${ALPHA[name][0]}..${ALPHA[name][1]}`);
    } else if (p.a !== 1) errors.push(`${name}: must be opaque #rrggbb`);
    c[name] = p;
  }
  if (errors.length) return { errors, warns };
  const v = (n: string) => c[n].rgb;
  const need = (label: string, got: number, min: number, soft = false) => {
    if (got < min) (soft ? warns : errors).push(`${label} ${got.toFixed(2)} < ${min}`);
  };
  const V = v('void');
  need('contrast ink/void', contrast(v('ink'), V), 10);
  need('contrast accent/void', contrast(v('accent'), V), 5.5);
  need('contrast muted/void', contrast(v('muted'), V), 5);
  for (const s of ['good', 'warn', 'bad', 'hot', 'shield', 'armour', 'chassis', 'component']) need(`contrast ${s}/void`, contrast(v(s), V), 4.5);
  for (const [bd, bg] of Object.entries(BACKDROPS)) {
    const plate = over(v('plate'), c.plate.a, bg);
    need(`contrast ink/plate over ${bd}`, contrast(v('ink'), plate), 4.5);
    need(`contrast muted/plate over ${bd}`, contrast(v('muted'), plate), 2.6, true);
  }
  const pairs: [string, string, number, boolean?][] = [['good', 'warn', 25], ['good', 'bad', 30], ['warn', 'bad', 18], ['bad', 'accent', 22], ['good', 'accent', 18], ['warn', 'accent', 10, true], ['hot', 'bad', 14]];
  for (const [a, b, min, soft] of pairs) need(`dE ${a}/${b}`, dE(v(a), v(b)), min, soft);
  const layers = ['shield', 'armour', 'chassis', 'component'];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) need(`dE ${layers[i]}/${layers[j]}`, dE(v(layers[i]), v(layers[j])), 10);
  need('dE health/muted (the turn at 40%)', dE(v('health'), v('muted')), 30);
  need('dE health/bad (ripple over the low bar)', dE(v('health'), v('bad')), 14);
  need('contrast health/void (a low bar on its dark track)', contrast(v('health'), V), 1.6);
  need('dE pool/accent (the Force bar runs between them)', dE(v('pool'), v('accent')), 15);
  need('contrast pool/void', contrast(v('pool'), V), 2.2);
  need('dE good/muted (stamina under health)', dE(v('good'), v('muted')), 18);
  const forceMid = v('pool').map((x, i) => (x + v('accent')[i]) / 2);
  need('dE force-middle/muted (Force over health)', dE(forceMid, v('muted')), 14);
  return { errors, warns };
}

// ---------------------------------------------------------------- 1. the table
{
  ok(ROLES.join() === PALETTE_NAMES.join(), "the check's eighteen roles are the palette's names, in its order");
  ok(THEMES.length === 42, `the table holds the examples page's forty-two themes (${THEMES.length})`);
  ok(new Set(THEMES.map((t) => t.id)).size === THEMES.length, 'no theme is named twice');
  ok(THEMES.every((t) => t.v.length === 18 && t.name.length > 0), 'each has a name and eighteen values');
  // Each group's themes stand together, and the groups come in the page's order.
  const order = THEME_GROUPS.map((g) => g.id as string);
  const seen: string[] = [];
  for (const t of THEMES) if (seen[seen.length - 1] !== t.group) seen.push(t.group);
  ok(seen.join() === order.join(), `each group's themes stand together, in the page's order (${seen.join(' ')})`);
  const counts = order.map((g) => THEMES.filter((t) => t.group === g).length);
  ok(counts.join() === '4,9,7,12,6,4', `four proposed, nine first drafts, seven of eras and factions, twelve places, six of ships and technology, four of the Force (${counts.join(', ')})`);
  ok(THEMES[0].id === DEFAULT_THEME && DEFAULT_THEME === 'default' && DEFAULT_SETTINGS.hudTheme === DEFAULT_THEME, 'the settings start on Default, the first theme');
  ok(THEMES[0].v.every((x, i) => x === PALETTE_FALLBACK[i]), 'Default is the palette as it stands, value for value');
  // And the stylesheet's own declarations are the same eighteen (palette.test.ts holds them to the fallbacks too).
  const css = text('src/style.css');
  const declared = PALETTE_NAMES.map((n) => new RegExp(`--${n}: ([^;]+);`).exec(css)?.[1]?.trim());
  ok(declared.every((x, i) => x === THEMES[0].v[i]), "and Default is what `src/style.css` declares on `:root`");
  ok(themeById('nothing-of-the-sort').id === DEFAULT_THEME && themeById('sith').name === 'Sith', 'a word that is no theme reads as Default; a theme is found by its word');
}

// ---------------------------------------------------------------- 2. every theme passes the examples page's check
{
  const failing: string[] = [];
  let soft = 0;
  for (const t of THEMES) {
    const { errors, warns } = check(t);
    if (errors.length) failing.push(`${t.id}: ${errors.join('; ')}`);
    soft += warns.length;
    if (warns.length) console.log(`note ${t.id} (soft): ${warns.join('; ')}`);
  }
  ok(failing.length === 0, `every one of the ${THEMES.length} passes the check (${failing.join(' | ') || `none failing; ${soft} soft notes`})`);
  // The check itself catches what it is for: a theme broken each way fails it.
  const broken = (i: number, value: string) => ({ v: THEMES[0].v.map((x, j) => (j === i ? value : x)) });
  ok(check(broken(COL.good, THEMES[0].v[COL.warn])).errors.some((e) => e.startsWith('dE good/warn')), 'the check fails ready drawn in the caution colour');
  ok(check(broken(COL.plate, '#182636')).errors.some((e) => e.startsWith('plate: alpha')), 'and a plate with no see-through left');
  ok(check(broken(COL.ink, '#303840')).errors.some((e) => e.startsWith('contrast ink/void')), 'and type too dark to read on the dark');
  ok(check(broken(COL.shield, THEMES[0].v[COL.armour])).errors.some((e) => e.startsWith('dE shield/armour')), "and a ship's two layers in one colour");
  ok(check({ v: THEMES[0].v.slice(0, 17) }).errors.length === 1, 'and a theme a value short');
}

// ---------------------------------------------------------------- 3. a theme put on and taken off (`applyTheme`)
{
  // A stand-in root: its own style is a map, and the computed style is that map over the stylesheet's `:root`, as the
  // browser's is (an inline custom property outranks the stylesheet's).
  const inline = new Map<string, string>();
  const sheet = new Map<string, string>(PALETTE_NAMES.map((n, i) => [`--${n}`, PALETTE_FALLBACK[i]]));
  const root = { style: { setProperty: (n: string, v: string) => void inline.set(n, v), removeProperty: (n: string) => (inline.delete(n), '') } } as unknown as Element;
  (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({ getPropertyValue: (n: string) => inline.get(n) ?? sheet.get(n) ?? '' });
  let told = 0;
  const stop = onPaletteChange(() => void told++);
  const { LAYER_FLASH } = await import('../../../src/space/shipCombat.ts');
  const flashBefore = LAYER_FLASH.shield;
  const sith = themeById('sith');
  const on = applyTheme('sith', root);
  ok(on === 'sith' && inline.size === 18 && PALETTE_NAMES.every((n, i) => inline.get(`--${n}`) === sith.v[i]), 'a theme writes its eighteen onto the root, which outranks the stylesheet');
  ok(PALETTE_NAMES.every((_, i) => COLOURS[i] === sith.v[i]), "and the palette is read again, which is what the overlay's every stroke reads");
  ok(told === 1, 'and whoever keeps a colour of their own is told, once');
  ok(LAYER_FLASH.shield === parseInt(sith.v[COL.shield].slice(1), 16) && LAYER_FLASH.shield !== flashBefore, "the ship's hull flash takes the theme's layer colours (it read them once, as its module loaded)");
  const back = applyTheme('default', root);
  ok(back === 'default' && inline.size === 0 && PALETTE_NAMES.every((_, i) => COLOURS[i] === PALETTE_FALLBACK[i]), "Default takes the eighteen off again, so the stylesheet's own stand, and the palette is the stylesheet's");
  ok(LAYER_FLASH.shield === flashBefore && told === 2, 'and the flash is back on the palette as it stands');
  const odd = applyTheme('no-such-theme', root);
  ok(odd === 'default' && inline.size === 0, 'a word that is no theme puts Default on');
  stop();
}

// ---------------------------------------------------------------- 4. the Colours switch, and the game's wiring
{
  const { INTERFACE } = await import('../../../src/ui/hudPage.ts');
  const knob = INTERFACE.flatMap((g) => g.knobs).find((k) => k.key === 'hudTheme');
  ok(!!knob && knob.kind === 'choice' && knob.label === 'Colours', 'the Interface page has a Colours switch');
  const choices = knob?.choices ?? [];
  ok(choices.length === 42 && choices.every((c, i) => c.value === THEMES[i].id && c.label === THEMES[i].name), "it lists every theme by its name, in the examples page's order");
  ok(choices.every((c, i) => c.group === THEME_GROUPS.find((g) => g.id === THEMES[i].group)?.label), 'each under its group, as the examples page groups them');
  const menu = text('src/ui/menu.ts');
  ok(/<optgroup label="\$\{g\}">\$\{run\}<\/optgroup>/.test(menu), 'and the menu lists a choice with groups under its groups');
  const main = text('src/main.ts');
  ok(/private themeOn = applyTheme\(this\.settings\.hudTheme\);/.test(main) && main.indexOf('private themeOn = applyTheme') - main.indexOf('private readonly settings: Settings = loadSettings();') < 600, 'the game puts the saved theme on straight after reading the settings, before the interface is built');
  const apply = /private applyHudSettings\(\): void \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/const theme = themeById\(S\.hudTheme\)\.id;\n\s+if \(theme !== this\.themeOn\) this\.themeOn = applyTheme\(theme\);/.test(apply), 'and a theme switched is put on when the settings are applied, only when it changes');
  ok(/case 'hudTheme':\n\s+\/\/ A size, a backing store and a few switches: no shader and no element is made\.\n\s+this\.applyHudSettings\(\);/.test(main), 'which the switch does the moment it moves');
  ok(/\['theme', 'hudTheme', THEMES\.map\(\(t\) => t\.id\)\]/.test(main), '`__debug.hud({ theme })` takes a theme by its word, refusing any other');
  // What keeps a copy of a colour of its own hears of a switch.
  ok(/onPaletteChange\(\(\) => this\.repaint\(\)\);/.test(text('src/ui/mapUi.ts')) && /onPaletteChange\(\(\) => this\.repaint\(\)\);/.test(text('src/ui/galaxyView.ts')) && /onPaletteChange\(\(\) => this\.relabelAll\(\)\);/.test(text('src/net/remotePlayers.ts')), "the space map's materials, the galaxy's rings and routes and the names over other players' heads are drawn again on a switch");
}

// ---------------------------------------------------------------- 5. the colours that were written into code are the palette's
{
  // The interface's colours that were still typed into its code (the map's layers, your mark, its grid and shades, the
  // galaxy's rings and routes, a name over another player's head, the message line's plain look, the flight display's
  // glow): none is a literal now. The world's own stay (the loading picture, the map pictures, the dye swatches, a
  // preview's lights).
  const lit = /['"`]#[0-9a-fA-F]{3,8}['"`]|\b0x[0-9a-fA-F]{6}\b|rgba?\(\s*\d/;
  const typedIn = (body: string) => body.split('\n').some((l) => !/^\s*(\/\/|\*)/.test(l) && lit.test(l));
  // The whole of the map's file; of the peers' file, the name over a head (a peer's blade colour is the game's own).
  const label = /function drawLabel\([\s\S]*?\n\}/.exec(text('src/net/remotePlayers.ts'))?.[0] ?? '';
  ok(!!label && !typedIn(text('src/ui/mapUi.ts')) && !typedIn(label), 'the map window and the names over heads carry no colour of their own');
  const galaxy = text('src/ui/galaxyView.ts');
  ok(!/0x7fd7ff|0xff9d5a/.test(galaxy) && /color: colourHex\('chassis'\)/.test(galaxy), "the galaxy's routes and rings are the palette's (its globes and lights are the galaxy's own)");
  ok(!/rgba\(6,10,18,0\.35\)|text-shadow:0 0 2px #060a12/.test(text('src/ui/messages.ts')), "the message line's plain look reads the palette's dark");
  ok(!/drop-shadow\(0 0 3px rgba\(/.test(text('src/ui/hud.css')), "the flight display's cross glows in the palette's accent");

  // And the two stylesheets, whole: a colour typed into a declaration anywhere outside the palette's own block stays
  // that colour under every theme. The two lit wells (an item's picture, the creator's backdrop) were typed in as a
  // blue-grey and stayed navy under a red theme (the wave's review); they are the palette's light let into its dark now.
  // The one literal left is the travel curtain's black, which replaces the world rather than being drawn over it.
  // Only declarations' values are read, so a selector such as `#fade` is not taken for a colour.
  const typedColours = (css: string): string[] => {
    const from = css.indexOf('/* palette:');
    const to = css.indexOf('/* /palette */');
    const body = (from >= 0 && to > from ? css.slice(0, from) + css.slice(to) : css).replace(/\/\*[\s\S]*?\*\//g, '');
    const found: string[] = [];
    for (const rule of body.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      for (const d of rule[2].matchAll(/(?:^|;)\s*([-a-zA-Z]+)\s*:\s*([^;]+)/g)) {
        for (const m of d[2].matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color\(srgb|\b0x[0-9a-fA-F]{6}\b/g)) found.push(`${rule[1].trim()} ${d[1]}: ${m[0]}`);
      }
    }
    return found;
  };
  const style = text('src/style.css');
  const hudCss = text('src/ui/hud.css');
  const typed = [...typedColours(style), ...typedColours(hudCss)];
  ok(typed.length === 1 && typed[0] === '#fade background: #000', `neither stylesheet types a colour outside the palette but the travel curtain's black (${typed.join(' | ')})`);
  const well = (name: string) => new RegExp(`${name}: color-mix\\(in srgb, color-mix\\(in srgb, var\\(--accent\\) \\d+%, var\\(--void\\)\\) \\d+%, transparent\\);`).test(style);
  ok(well('--well-pic') && well('--well-creation') && /\.bp-pic \{[^}]*radial-gradient\(circle at 50% 40%, var\(--well-pic\),/.test(style) && /\.bp-examine-pic \{[^}]*var\(--well-pic\)/.test(style) && /\.overlay\.creation \{[^}]*radial-gradient\(ellipse at 50% 30%, var\(--well-creation\),/.test(style), "the lit wells behind an item's picture and the creator are the palette's accent let into its void, so a theme lights them");
  // The scan finds what it is for: either well typed back in as it was is caught.
  const typedBack = style.replace('var(--well-pic),', 'rgba(40,62,86,0.9),').replace('var(--well-creation),', 'rgba(30,48,70,0.95),');
  ok(typedColours(typedBack).length === 3, 'and the scan catches either well typed back in as it was');
}

console.log(`\n${checks} checks passed`);
