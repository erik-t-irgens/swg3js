// The Interface page (src/ui/menu.ts) against the settings it writes (src/core/settings.ts), the
// rebind notification everything that shows a bound key hangs off, and the panels' colours
// (src/style.css) against the one place they are declared.
//
// Three failures are pinned here, each of which is invisible until someone opens the menu. A knob
// that names a key the settings do not carry writes a value nothing reads. A display setting with no
// knob is a switch the player cannot reach, which is exactly what the pass promised not to leave
// behind: every number is reachable from the page as well as from the console. And a range whose
// ends disagree with the range the console helper clamps to gives two different answers for the same
// setting depending on which one you used last.
//
// The notification is the other half: the keys are written in one place and read in several, and
// before this there was nothing to hear, so the slot row said 1 to 6 whatever you had bound.
//
// Everything here is synthetic. No browser, no document, and nothing read from the game's own files:
// the module is imported for its tables alone, and `Menu` itself is never built.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, HUD_LINES_RANGE, HUD_SCALE_RANGE } from '../../../src/core/settings.ts';
import { INTERFACE, notifyBindingsChanged, onBindingsChanged } from '../../../src/ui/hudPage.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Knob = {
  key: string;
  label: string;
  hint: string;
  kind: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  choices?: { value: string; label: string }[];
  requires?: readonly string[];
};

const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
const knobs: Knob[] = INTERFACE.flatMap((g) => g.knobs as unknown as Knob[]);

// ---------------------------------------------------------------------------------------------
// The page's shape.
{
  ok(INTERFACE.length > 0, `the page has groups (${INTERFACE.length})`);
  ok(
    INTERFACE.every((g) => typeof g.title === 'string' && g.title.length > 0 && g.knobs.length > 0),
    'every group has a heading and at least one knob',
  );
  ok(knobs.length > 0, `and knobs on it (${knobs.length})`);
  ok(
    knobs.every((k) => typeof k.label === 'string' && k.label.length > 0 && typeof k.hint === 'string' && k.hint.length > 0),
    'every knob says what it is and what it does',
  );
  ok(new Set(knobs.map((k) => k.key)).size === knobs.length, 'no setting has two knobs on the page');
}

// ---------------------------------------------------------------------------------------------
// Every knob names a real setting, of the kind its control writes.
{
  const missing = knobs.filter((k) => defaults[k.key] === undefined).map((k) => k.key);
  ok(missing.length === 0, `every knob names a setting that exists${missing.length ? `: ${missing.join(', ')}` : ''}`);

  const wrong: string[] = [];
  for (const k of knobs) {
    const v = defaults[k.key];
    const want = k.kind === 'toggle' ? 'boolean' : k.kind === 'choice' ? 'string' : 'number';
    if (typeof v !== want) wrong.push(`${k.key} is a ${typeof v}, its ${k.kind} writes a ${want}`);
  }
  ok(wrong.length === 0, `and a control that writes the kind of value that setting holds${wrong.length ? `: ${wrong.join('; ')}` : ''}`);

  const out: string[] = [];
  for (const k of knobs) {
    const v = defaults[k.key];
    if (k.kind === 'range') {
      if (typeof k.min !== 'number' || typeof k.max !== 'number' || typeof k.step !== 'number') out.push(`${k.key} has no range`);
      else if (k.min >= k.max) out.push(`${k.key}'s range runs backwards`);
      else if (typeof v === 'number' && (v < k.min || v > k.max)) out.push(`${k.key}'s default ${v} is outside ${k.min}..${k.max}`);
    } else if (k.kind === 'select') {
      if (!k.options?.length) out.push(`${k.key} has no options`);
      else if (!k.options.some((o) => o.value === v)) out.push(`${k.key}'s default ${String(v)} is not one of its options`);
    }
  }
  ok(out.length === 0, `and a slider or a list the default sits inside${out.length ? `: ${out.join('; ')}` : ''}`);

  const waits = knobs.flatMap((k) => (k.requires ?? []).filter((r) => defaults[r] === undefined));
  ok(waits.length === 0, `a knob that waits on a switch waits on one that exists${waits.length ? `: ${waits.join(', ')}` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// Every display setting is reachable from the page, and the page's ends are the ends the console
// helper clamps a wild value to.
{
  const display = Object.keys(defaults).filter((k) => k.startsWith('hud'));
  const onPage = new Set(knobs.map((k) => k.key));
  const hidden = display.filter((k) => !onPage.has(k));
  ok(display.length > 0, `the settings carry the display's own keys (${display.length})`);
  ok(hidden.length === 0, `and every one of them has a knob on the page${hidden.length ? `: ${hidden.join(', ')}` : ''}`);

  const scale = knobs.find((k) => k.key === 'hudScale')!;
  const lines = knobs.find((k) => k.key === 'hudMessageLines')!;
  ok(scale.min === HUD_SCALE_RANGE.min && scale.max === HUD_SCALE_RANGE.max, 'the scale slider runs from end to end of the range the console clamps to');
  ok(lines.min === HUD_LINES_RANGE.min && lines.max === HUD_LINES_RANGE.max, 'and so does the line count');
  ok(lines.requires?.includes('hudMessages') === true, 'the line count is greyed while the message line is off');
}

// ---------------------------------------------------------------------------------------------
// The rebind notification.
{
  const heard: string[] = [];
  const stopA = onBindingsChanged(() => heard.push('a'));
  const stopB = onBindingsChanged(() => heard.push('b'));
  notifyBindingsChanged();
  ok(heard.join(',') === 'a,b', `everything listening hears one rebind, in the order it subscribed (${heard.join(',') || 'nothing'})`);

  heard.length = 0;
  stopA();
  notifyBindingsChanged();
  ok(heard.join(',') === 'b', 'one that has stopped listening hears nothing more');

  heard.length = 0;
  const stopBad = onBindingsChanged(() => {
    throw new Error('a display that cannot redraw its key-caps');
  });
  const stopC = onBindingsChanged(() => heard.push('c'));
  let threw = false;
  try {
    notifyBindingsChanged();
  } catch {
    threw = true;
  }
  ok(!threw, 'a listener that throws does not take the menu down with it');
  ok(heard.join(',') === 'b,c', 'and the ones after it are still told');

  stopBad();
  stopB();
  stopC();
  heard.length = 0;
  notifyBindingsChanged();
  ok(heard.length === 0, 'with nobody listening a rebind is a no-op');
}

// ---------------------------------------------------------------------------------------------
// The table above is only a table: the page could be deleted from the menu and every check so far
// would still pass. These three read `src/ui/menu.ts` as text -- the way the wiring test reads
// `main.ts` -- and say that the page is rendered, that its knobs are wired with everything else's,
// and that both ways in are still there.
{
  const menu = readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8');
  ok(menu.includes("page === 'interface'"), 'the menu still builds the Interface page');
  ok(/const all = \[[^\]]*INTERFACE/.test(menu), "and wires its knobs with the other pages' in `wireKnobs`");
  const ways = menu.split('data-page="interface"').length - 1;
  ok(ways >= 2, `and there are two ways to it, the nav and the paused page (${ways})`);
}

// ---------------------------------------------------------------------------------------------
// The panels' colours. A hundred and forty literals in `src/style.css` became the palette's names,
// which is the one change in this package that can shift a panel quietly, and nothing else watches
// it: `palette.test.ts` reads the `:root` block and stops there. So the rest of the file is checked
// here -- every tint is a named colour at an alpha, every name it uses is declared, and the only
// literal colours left are the three that are deliberate. A future edit that types a colour in by
// hand fails this rather than being noticed a week later.
{
  const css = readFileSync(new URL('../../../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = css.indexOf(':root');
  const root = css.slice(open, css.indexOf('}', open));
  const declared = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  ok(declared.size > 0, `the stylesheet declares its colours in one place (${declared.size} names)`);

  const rest = css.slice(0, open) + css.slice(css.indexOf('}', open) + 1);
  const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);
  const strays = [...new Set(used.filter((n) => !declared.has(n)))];
  ok(strays.length === 0, `every name the file reads is one it declares${strays.length ? `: ${strays.join(', ')}` : ''}`);

  // One level of nesting, since every tint holds a `var(…)`.
  const mixes = [...rest.matchAll(/color-mix\([^()]*(?:\([^()]*\)[^()]*)*\)/g)].map((m) => m[0]);
  const bad = mixes.filter((m) => !/^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+(?:\.\d+)?)%, transparent\)$/.test(m.trim()));
  ok(mixes.length > 0 && bad.length === 0, `every tint is one of those names at an alpha (${mixes.length})${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
  const off = mixes.map((m) => /var\((--[a-z0-9-]+)\)/.exec(m)?.[1] ?? '').filter((n) => !declared.has(n));
  ok(off.length === 0, `and no tint is mixed from a name that is not declared${off.length ? `: ${off.join(', ')}` : ''}`);

  // Only the values of declarations are scanned, or `#fade` and `#loading` would read as colours.
  const values = [...rest.matchAll(/(?:^|[;{])\s*[-a-zA-Z]+\s*:\s*([^;{}]+)/g)].map((m) => m[1]);
  const literals: string[] = [];
  for (const v of values) for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) literals.push(m[0].replace(/\s+/g, ''));
  // The three the hand-off names, each with its reason written beside it in the stylesheet: the
  // travel curtain, which is meant to reach black, and the two lit wells behind a picture.
  const allowed = new Set(['#000', 'rgba(40,62,86,0.9)', 'rgba(30,48,70,0.95)']);
  const typed = [...new Set(literals.filter((l) => !allowed.has(l)))];
  ok(typed.length === 0, `no colour is typed into a panel by hand${typed.length ? `: ${typed.join(', ')}` : ''}`);
  ok(literals.length > 0 && literals.length <= 4, `and the deliberate few are still few (${literals.length})`);
}

console.log(`\n${checks} checks passed`);
