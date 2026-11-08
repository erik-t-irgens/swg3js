// The Graphics page laid out to be found (the owner's ask of 2026-11-02, `src/ui/graphicsPage.ts`): its sections under
// sub-tabs, the sub-tab open last kept in this browser, the Volumetrics sub-tab's sections folding (kept too), and a find
// box that filters every row on the page by its label and hint across every sub-tab, saying which sub-tab each match
// stands in, cleared by Escape in the box without the menu hearing that Escape.
//
// Day one: the Escape menu as it stood before (90d089a's `menu.ts`, out of git) and today's are both built in a stand-in
// page over the same knob tables (each reads today's `floraPage.ts`, `volPage.ts`, the effects registry), and every
// control of the page before -- every knob row and the reset -- is held present in today's once, with the very settings a
// change of it writes, in the same order. `menu.ts` reads `import.meta.env`, which node has not got, so both copies are
// loaded with that one read stood in (`DEV` true) and, for the copy before, its constructor's parameter properties and
// two imports' missing extensions written out, which node's type stripping cannot read and which change nothing it does.
//
// The grouping is the owner's (one line of `GRAPHICS_TABS`, `GRAPHICS_TAB_OF` or `GRAPHICS_FOLDED` a change), so nothing
// here pins it: each check holds the tables' rules (a section on the sub-tab its line names, folded where the list says),
// and the only rules of the tables themselves held are that every section is named and no sub-tab is left empty. What a
// browser kept is read back in a node process of its own, which this test spawns of itself (`GRAPHICS_LAYOUT_RELOAD`):
// `folds.ts` reads each key once a session, so in the process that wrote it every later read is its cache, never storage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StandInEvent, StandInPage, storage, type Element0 } from './standInPage.ts';
import { oldTexts, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** This process is a reload the test spawned of itself: its mode (`kept`, `gone`, `refuse`, `garbage`), else '' (the test). */
const RELOAD = process.env.GRAPHICS_LAYOUT_RELOAD ?? '';

const page = new StandInPage();
page.install(storage());

const { DEFAULT_SETTINGS } = await import('../../../src/core/settings.ts');
const { GRAPHICS_TABS, GRAPHICS_TAB_OF, GRAPHICS_FOLDED, GRAPHICS_TAB_KEY, GRAPHICS_FOLDS_KEY, graphicsTabs, findTerms, rowMatches } = await import('../../../src/ui/graphicsPage.ts');
const { FoldStore } = await import('../../../src/ui/folds.ts');
const PRE_WAVE = '90d089a';

/** `menu.ts`'s text made a module node can load, its relative imports pointed at today's files. */
async function loadMenu(text: string, tag: string): Promise<{ Menu: new (parent: unknown, input: unknown, settings: unknown) => MenuLike }> {
  const from = join(REPO, 'src', 'ui');
  const out = text
    .replace(/import\.meta\.env\b/g, '({ DEV: true, BASE_URL: "/" })')
    .replace('constructor(parent: HTMLElement, private readonly input: Input, private readonly settings: Settings) {', 'constructor(parent: HTMLElement, input: Input, settings: Settings) {\n    this.input = input;\n    this.settings = settings;')
    .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href}'`);
  const dir = mkdtempSync(join(tmpdir(), 'ui-menu-'));
  try {
    const file = join(dir, `menu-${tag}.ts`);
    writeFileSync(file, out);
    return (await import(pathToFileURL(file).href)) as never;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface MenuLike {
  root: Element0;
  onSetting: (k: string, v: unknown) => void;
  onUiSound: (a: string) => void;
  knobState: (k: string) => { note?: string; off?: string } | null;
  show(page?: string): void;
  hide(): void;
  redrawGraphics(): void;
}

const today = await loadMenu(readFileSync(join(REPO, 'src/ui/menu.ts'), 'utf8').replace(/\r\n/g, '\n'), 'now');
const oldText = RELOAD ? null : (oldTexts(['src/ui/menu.ts'], PRE_WAVE)?.get('src/ui/menu.ts') ?? null);
const before = oldText ? await loadMenu(oldText, 'before') : null;

const input = { bindings: new Proxy({}, { get: () => ['Backquote'] }), resetBindings() {}, assignKey() {} };

function build(M: { Menu: new (parent: unknown, input: unknown, settings: unknown) => MenuLike }, calls: string[], sounds: string[] = []): { menu: MenuLike; body: Element0 } {
  const parent = page.createElement('div');
  page.body.append(parent);
  const menu = new M.Menu(parent, input, structuredClone({ ...DEFAULT_SETTINGS }));
  menu.onSetting = (k, v) => void calls.push(`${k}=${JSON.stringify(v)}`);
  menu.onUiSound = (a) => void sounds.push(a);
  menu.show('graphics');
  return { menu, body: menu.root.querySelector('.menu-body')! };
}

/** A knob moved once, as a player moves it. */
function move(el: Element0): void {
  if (el.classList.contains('reset-gfx')) page.click(el);
  else if (el.localName === 'input' && el.type === 'checkbox') page.enter(el, String(!el.checked), ['change']);
  else if (el.localName === 'input' && el.type === 'range') page.enter(el, el.max, ['input']);
  else if (el.dataset.preset !== undefined) {
    const opts = el.querySelectorAll('option').filter((o) => o.value);
    page.enter(el, opts[1]?.value ?? opts[0]?.value ?? '', ['change']);
  } else {
    const opts = el.querySelectorAll('option');
    page.enter(el, opts[opts.length - 1]?.value ?? '', ['change']);
  }
}

/** Every control of the page's own (the knobs and the reset), in order, each moved once with the settings it wrote. */
function controls(body: Element0, calls: string[]): { id: string; act: string }[] {
  const list = body.querySelectorAll('[data-key], select[data-preset], .reset-gfx');
  const out: { id: string; act: string }[] = [];
  for (const el of list) {
    const id = `${el.localName}:${el.dataset.key ?? el.dataset.preset ?? el.className}`;
    const n = calls.length;
    move(el);
    out.push({ id, act: calls.slice(n).join(' ') });
  }
  return out;
}

const visible = (body: Element0) => body.querySelectorAll('.gfx-sec').filter((s) => !s.classList.contains('gfx-out'));
const titlesOf = (secs: Element0[]) => secs.map((s) => s.dataset.sec!);
const tabButton = (body: Element0, id: string) => body.querySelector(`.gfx-tabs button[data-gfx-tab="${id}"]`)!;
const marked = (body: Element0) => GRAPHICS_TABS.filter((t) => tabButton(body, t.id).classList.contains('on')).map((t) => t.id);
const FIRST = GRAPHICS_TABS[0].id;
const LAST = GRAPHICS_TABS[GRAPHICS_TABS.length - 1].id;
/** The sections the table puts on a folding sub-tab (every section is named in it: held in section 1). */
const FOLDING = Object.keys(GRAPHICS_TAB_OF).filter((t) => GRAPHICS_TABS.find((x) => x.id === GRAPHICS_TAB_OF[t])?.folds);

// ---------------------------------------------------------------- 0. a reload: what a browser kept, read in a process of its own

if (RELOAD) {
  const store = storage(RELOAD === 'refuse');
  if (RELOAD === 'kept') {
    store.kept.set(GRAPHICS_TAB_KEY, LAST);
    store.kept.set(GRAPHICS_FOLDS_KEY, JSON.stringify(Object.fromEntries(FOLDING.map((t) => [t, !GRAPHICS_FOLDED.includes(t)]))));
  }
  if (RELOAD === 'gone') store.kept.set(GRAPHICS_TAB_KEY, 'gone');
  if (RELOAD === 'garbage') store.kept.set(GRAPHICS_FOLDS_KEY, '{not json');
  page.install(store);
  const out: Record<string, unknown> = {};
  try {
    const { body } = build(today, []);
    out.on = marked(body);
    out.shown = [...new Set(visible(body).map((s) => s.dataset.gfxTab))];
    out.folded = Object.fromEntries(body.querySelectorAll('.gfx-sec.gfx-folds').map((s) => [s.dataset.sec, s.querySelector('.gfx-rows')!.classList.contains('gfx-out')]));
    // A sub-tab clicked lasts the session whether or not storage takes it.
    const other = GRAPHICS_TABS.find((t) => !(out.on as string[]).includes(t.id));
    if (other) {
      page.click(tabButton(body, other.id));
      out.clicked = visible(body).every((s) => s.dataset.gfxTab === other.id) && marked(body).join() === other.id;
    }
  } catch (err) {
    out.threw = String(err);
  }
  writeSync(1, `RELOAD ${JSON.stringify(out)}\n`);
  process.exit(0);
}

/** The reload in a process of its own: what it read, or why it gave nothing. */
function reload(mode: string): Record<string, unknown> {
  try {
    const text = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, GRAPHICS_LAYOUT_RELOAD: mode }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const line = text.split(/\r?\n/).find((l) => l.startsWith('RELOAD '));
    return line ? (JSON.parse(line.slice('RELOAD '.length)) as Record<string, unknown>) : { threw: `no answer: ${text.slice(-400)}` };
  } catch (err) {
    return { threw: String((err as { stderr?: string }).stderr || err) };
  }
}

// ---------------------------------------------------------------- 1. the tables

const ALL = (() => {
  const { body } = build(today, []);
  return titlesOf(body.querySelectorAll('.gfx-sec'));
})();
const TAB_OF = new Map(ALL.map((t, i) => [t, graphicsTabs(ALL)[i]]));
const titlesOn = (id: string) => ALL.filter((t) => TAB_OF.get(t) === id);
{
  const unnamed = ALL.filter((t) => !Object.prototype.hasOwnProperty.call(GRAPHICS_TAB_OF, t));
  ok(unnamed.length === 0 && ALL.length >= 17, `every section of the page is named in the sub-tabs' table (${ALL.length})${unnamed.length ? `: missing ${unnamed.join(', ')}` : ''}`);
  ok(Object.values(GRAPHICS_TAB_OF).every((t) => GRAPHICS_TABS.some((x) => x.id === t)) && GRAPHICS_TABS.every((x) => Object.values(GRAPHICS_TAB_OF).includes(x.id)), 'every sub-tab the table names exists, and every sub-tab holds a section (moving the last section off a sub-tab takes its line out of the sub-tabs too)');
  ok(GRAPHICS_TABS.length >= 1 && new Set(GRAPHICS_TABS.map((t) => t.id)).size === GRAPHICS_TABS.length && GRAPHICS_TABS.every((t) => t.label.length > 0), `every sub-tab an id of its own and words (${GRAPHICS_TABS.map((t) => t.label).join(', ')})`);
  ok(graphicsTabs(['Picture', 'A section a later wave adds', 'The wind', 'Another']).join(',') === [GRAPHICS_TAB_OF.Picture, GRAPHICS_TAB_OF.Picture, GRAPHICS_TAB_OF['The wind'], GRAPHICS_TAB_OF['The wind']].join(','), 'a section the table does not name stands in the sub-tab of the section before it');
  const strays = GRAPHICS_FOLDED.filter((t) => !ALL.includes(t));
  ok(strays.length === 0, `every section the list says starts folded is a section of the page (${GRAPHICS_FOLDED.length})${strays.length ? `; not: ${strays.join(', ')}` : ''}`);
  ok(findTerms('  Rain  OPACITY ').join(',') === 'rain,opacity' && rowMatches('Rain opacity How solid the falling rain looks', ['rain', 'opacity']) && !rowMatches('Rain', ['rain', 'snow']), 'a find is its words, each to be found in a row, any case');
}

// ---------------------------------------------------------------- 2. day one: every control of before, once, with its act

if (!before) console.log(`note git cannot hand ${PRE_WAVE} over here: the comparison with the page before is skipped`);
else {
  page.install(storage());
  const was: string[] = [];
  const o = build(before, was);
  const oldTitles = o.body.querySelectorAll('h3').map((h) => h.textContent);
  const oc = controls(o.body, was);
  page.install(storage());
  const now: string[] = [];
  const n = build(today, now);
  const newTitles = titlesOf(n.body.querySelectorAll('.gfx-sec'));
  const all = controls(n.body, now);
  // The two settings the wave of the rooms' lights added to Shadows and distance (Room lamps, Room light shadows) are the
  // page's since; every other control is held to the page before, in order, as it stood.
  const ADDED = ['select:roomLightSpots', 'select:roomLightShadows'];
  const reset = all.find((c) => c.id === 'button:reset-gfx');
  ok(!!reset && / roomLightSpots=0 roomLightShadows=0 /.test(reset.act), "and the page's reset puts both back at nought, the pool as the world always had it");
  // The horizon pass's second wave added two to Distance and detail (the far ground's switch and the Terrain distance),
  // after the far tiles' radius; they are held apart as the rooms' two are.
  // The third wave added the Ground detail distance after them.
  const HORIZON = ['input:farRings', 'input:terrainDistance', 'input:groundDetailDistance'];
  const hz = HORIZON.map((id) => all.findIndex((c) => c.id === id));
  ok(hz[0] === all.findIndex((c) => c.id === 'input:farRadius') + 1 && hz[1] === hz[0] + 1 && hz[2] === hz[1] + 1, `the far ground's switch, the Terrain distance and the Ground detail distance stand after the far tiles' radius (${hz.join(', ')})`);
  // The reset's act, less the ones it now writes as well, is the reset of before.
  const nc = all.filter((c) => !ADDED.includes(c.id) && !HORIZON.includes(c.id)).map((c) => (c.id === 'button:reset-gfx' ? { ...c, act: c.act.replace(' roomLightSpots=0 roomLightShadows=0', '').replace(' farRings=false terrainDistance=8 groundDetailDistance=2.5', '') } : c));
  const added = all.filter((c) => ADDED.includes(c.id));
  ok(added.length === 2 && all.findIndex((c) => c.id === ADDED[0]) === all.findIndex((c) => c.id === 'input:shadowCasterRadius') + 1 && all.findIndex((c) => c.id === ADDED[1]) === all.findIndex((c) => c.id === ADDED[0]) + 1, `the rooms' two light settings stand in the shadows' section, after the smallest caster (${added.map((c) => c.id).join(', ')})`);
  ok(oldTitles.join('|') === newTitles.join('|'), `the page's sections are the ones it had, in the order it had them (${newTitles.length})`);
  const ids = nc.map((c) => c.id);
  ok(new Set(ids).size === ids.length, `every control stands on the page once, across every sub-tab (${ids.length})`);
  const diff: string[] = [];
  for (let i = 0; i < Math.max(oc.length, nc.length); i++) if (oc[i]?.id !== nc[i]?.id || oc[i]?.act !== nc[i]?.act) diff.push(`${oc[i]?.id} -> ${oc[i]?.act} | now ${nc[i]?.id} -> ${nc[i]?.act}`);
  ok(diff.length === 0 && nc.length === oc.length, `every control of before is there, in order, and writes the very settings it wrote (${nc.length})${diff.length ? `\n  ${diff.slice(0, 6).join('\n  ')}` : ''}`);
  ok(nc.filter((c) => c.act).length === nc.length, 'and every one of them writes a setting');
}

// ---------------------------------------------------------------- 3. the sub-tabs, kept in this browser

{
  const store = storage();
  page.install(store);
  const sounds: string[] = [];
  const { body } = build(today, [], sounds);
  ok(titlesOf(visible(body)).join('|') === titlesOn(FIRST).join('|') && marked(body).join() === FIRST, `the page opens on its first sub-tab, its sections alone shown (${titlesOn(FIRST).join(', ')})`);
  if (LAST === FIRST) console.log('note the page has one sub-tab: there is no other to go to');
  else {
    body.scrollTop = 120;
    page.click(tabButton(body, LAST));
    ok(visible(body).every((s) => s.dataset.gfxTab === LAST) && titlesOf(visible(body)).join('|') === titlesOn(LAST).join('|') && sounds.includes('select'), `a sub-tab clicked shows its sections alone (${visible(body).length}), with the menu's own click`);
    ok(store.kept.get(GRAPHICS_TAB_KEY) === LAST, 'and is kept in this browser');
    ok(body.scrollTop === 0, 'a sub-tab opens at its own scroll');
    page.click(tabButton(body, FIRST));
    ok(body.scrollTop === 120, 'and the sub-tab left stands where it was left when it comes back');
    page.click(tabButton(body, LAST));
    const again = build(today, []).body;
    ok(marked(again).join() === LAST && visible(again).every((s) => s.dataset.gfxTab === LAST), 'a menu built again in this session opens on the sub-tab kept');
  }
}

// ---------------------------------------------------------------- 4. a folding sub-tab's sections fold, kept

const FOLDS = GRAPHICS_TABS.find((t) => t.folds);
if (!FOLDS) console.log('note no sub-tab folds: the folding is not tried');
else {
  const store = storage();
  page.install(store);
  const { body } = build(today, []);
  page.click(tabButton(body, FOLDS.id));
  const sec = (t: string) => body.querySelectorAll('.gfx-sec').find((s) => s.dataset.sec === t)!;
  const rowsHidden = (t: string) => sec(t).querySelector('.gfx-rows')!.classList.contains('gfx-out');
  const secs = titlesOn(FOLDS.id);
  const wrong = secs.filter((t) => rowsHidden(t) !== GRAPHICS_FOLDED.includes(t) || sec(t).classList.contains('gfx-folded') !== rowsHidden(t));
  ok(wrong.length === 0, `every section of a folding sub-tab starts folded exactly where the list says (${secs.filter((t) => GRAPHICS_FOLDED.includes(t)).length} of ${secs.length})${wrong.length ? `; not: ${wrong.join(', ')}` : ''}`);
  const shut = secs.find((t) => GRAPHICS_FOLDED.includes(t));
  const open = secs.find((t) => !GRAPHICS_FOLDED.includes(t));
  if (shut) {
    page.fire(sec(shut).querySelector('h3')!, new StandInEvent('click'));
    ok(!rowsHidden(shut) && JSON.parse(store.kept.get(GRAPHICS_FOLDS_KEY) ?? '{}')[shut] === false, `a heading clicked unfolds its section, kept in this browser (${shut})`);
  }
  if (open) {
    page.fire(sec(open).querySelector('h3')!, new StandInEvent('click'));
    ok(rowsHidden(open) && JSON.parse(store.kept.get(GRAPHICS_FOLDS_KEY) ?? '{}')[open] === true, `and folds one too (${open})`);
  }
  // A folded section's knobs still act.
  const folded = open ?? shut!;
  if (!open) page.fire(sec(folded).querySelector('h3')!, new StandInEvent('click'));
  const calls: string[] = [];
  const b2 = build(today, calls).body;
  const knob = b2.querySelectorAll('.gfx-sec').find((s) => s.dataset.sec === folded)!.querySelector('[data-key]')!;
  ok(b2.querySelectorAll('.gfx-sec').find((s) => s.dataset.sec === folded)!.querySelector('.gfx-rows')!.classList.contains('gfx-out'), `the section stands folded in a menu built again (${folded})`);
  move(knob);
  ok(!!calls[0]?.startsWith(`${knob.dataset.key}=`), `a knob in a folded section still writes its setting (${calls[0]})`);
  // Sections of other sub-tabs do not fold.
  const plain = GRAPHICS_TABS.find((t) => !t.folds);
  if (plain) {
    page.click(tabButton(b2, plain.id));
    const pic = b2.querySelectorAll('.gfx-sec').find((s) => s.dataset.sec === titlesOn(plain.id)[0])!;
    page.fire(pic.querySelector('h3')!, new StandInEvent('click'));
    ok(!pic.classList.contains('gfx-folds') && !pic.querySelector('.gfx-rows')!.classList.contains('gfx-out'), `the other sub-tabs' sections do not fold (${pic.dataset.sec})`);
  }
}

// ---------------------------------------------------------------- 5. the find, across every sub-tab, and its Escape

{
  page.install(storage());
  const { menu, body } = build(today, []);
  const openTab = marked(body)[0];
  const find = () => body.querySelector('.gfx-find')!;
  const typeFind = (words: string) => page.enter(find(), words, ['input']);
  const holding = (words: string) => body.querySelectorAll('.gfx-sec').filter((s) => s.querySelectorAll('.knob').some((k) => rowMatches(k.querySelector('.knob-label')!.textContent, findTerms(words)))).map((s) => s.dataset.sec!);
  typeFind('shadow');
  const shown = visible(body);
  const want = holding('shadow');
  ok(body.classList.contains('gfx-finding') && titlesOf(shown).join('|') === want.join('|') && want.length > 0, `a find shows every section holding a match, whatever its sub-tab (${want.length} sections in ${new Set(want.map((t) => TAB_OF.get(t))).size} sub-tabs)`);
  ok(shown.every((s) => s.querySelector('.gfx-in')!.textContent === GRAPHICS_TABS.find((t) => t.id === s.dataset.gfxTab)!.label), 'each shown section says the sub-tab it stands in');
  const rowsOk = shown.every((s) => s.querySelectorAll('.knob').every((k) => k.classList.contains('gfx-out') === !rowMatches(k.querySelector('.knob-label')!.textContent, ['shadow'])));
  ok(rowsOk, 'only the rows that match are shown, by label and hint');
  const folds = new FoldStore(GRAPHICS_FOLDS_KEY, GRAPHICS_FOLDED);
  const through = shown.filter((s) => s.classList.contains('gfx-folds') && folds.folded(s.dataset.sec!));
  if (!through.length) console.log('note no section a find for shadow shows stands folded now: the find through a fold is not tried');
  else ok(through.every((s) => !s.querySelector('.gfx-rows')!.classList.contains('gfx-out')), `a match in a folded section is shown (${through.map((s) => s.dataset.sec).join(', ')})`);
  ok(GRAPHICS_TABS.every((t) => !tabButton(body, t.id).classList.contains('on')), 'while it finds, no sub-tab is marked');
  typeFind('biggest saving');
  ok(titlesOf(visible(body)).includes('Picture') && visible(body)[0].querySelectorAll('.knob').filter((k) => !k.classList.contains('gfx-out')).length === 1, "a hint's words find its row (Render scale's)");
  typeFind('nothing has these words zxq');
  ok(visible(body).length === 0 && !body.querySelector('.gfx-none')!.classList.contains('gfx-out'), 'a find that matches nothing says so');
  // A folding heading clicked while finding changes no fold.
  typeFind('rain');
  const foldingShown = visible(body).find((s) => s.classList.contains('gfx-folds'));
  if (!foldingShown) console.log('note a find for rain shows no section of a folding sub-tab: the heading clicked while finding is not tried');
  else {
    const id = foldingShown.dataset.sec!;
    const wasFolded = folds.folded(id);
    page.fire(foldingShown.querySelector('h3')!, new StandInEvent('click'));
    ok(folds.folded(id) === wasFolded && !foldingShown.querySelector('.gfx-rows')!.classList.contains('gfx-out'), `a heading clicked while finding folds nothing (${id})`);
  }
  // Redrawn from the console while the find is being typed: the find stands, and the box keeps the keyboard.
  find().focus();
  menu.redrawGraphics();
  ok(find().value === 'rain' && body.classList.contains('gfx-finding') && visible(body).length > 0, 'a redraw of the page (a setting moved from the console) keeps the find');
  ok((page.doc.activeElement as unknown) === find(), 'and the box being typed in keeps the keyboard across it');
  // Escape in the box: the find goes and the menu never hears it.
  const heard: string[] = [];
  page.win.addEventListener('keydown', (e: StandInEvent) => void heard.push(e.key));
  find().focus();
  const e = page.key('Escape', 'Escape');
  ok(heard.length === 0 && e.stopped, 'Escape in the find box stops there: the menu\'s own Escape (a window listener) never hears it');
  ok(find().value === '' && !body.classList.contains('gfx-finding') && titlesOf(visible(body)).join('|') === titlesOn(openTab).join('|') && marked(body).join() === openTab, `and it clears the find, the sub-tab it opened on shown again (${openTab})`);
  page.key('Escape', 'Escape');
  ok(heard.length === 1, 'a second Escape, out of the box, is the menu\'s again');
  // The find is put down when the page is left.
  typeFind('fog');
  menu.show('sound');
  menu.show('graphics');
  ok(find().value === '' && !body.classList.contains('gfx-finding'), 'leaving the page puts the find down');
  typeFind('fog');
  menu.hide();
  menu.show('graphics');
  ok(find().value === '' && !body.classList.contains('gfx-finding'), 'and so does shutting the menu');
}

// ---------------------------------------------------------------- 6. everything the page did before still holds

{
  page.install(storage());
  const calls: string[] = [];
  const { menu, body } = build(today, calls);
  const wtab = body.querySelector('input[data-key="weather"]')!.closest('.gfx-sec')!.dataset.gfxTab!;
  page.click(tabButton(body, wtab));
  const weather = body.querySelector('input[data-key="weather"]')!;
  page.enter(weather, 'false', ['change']);
  const density = body.querySelector('input[data-key="weatherDensity"]')!;
  ok(calls.includes('weather=false') && density.closest('.knob')!.classList.contains('disabled') && marked(body).join() === wtab, `a switch others wait on greys them, and the page drawn again stays on its sub-tab (${wtab})`);
  const range = body.querySelector('input[data-key="rainOpacity"]')!;
  page.enter(range, '0.5', ['input']);
  ok(calls.includes('rainOpacity=0.5') && range.parentElement!.querySelector('.value')!.textContent === '50%', 'a slider applies live and says its value');
  menu.knobState = (k) => (k === 'volumetrics' ? { note: 'from the next arrival' } : null);
  menu.redrawGraphics();
  ok(body.querySelector('input[data-key="volumetrics"]')!.closest('.knob')!.querySelector('small')!.textContent.includes('from the next arrival'), "the game's own word on a knob (the volumetrics master's notice) is drawn with it");
  const n = calls.length;
  page.click(body.querySelector('.reset-gfx')!);
  ok(calls.length > n + 50, `the reset still resets every knob of the page (${calls.length - n})`);
  // Storage that refuses, in this session: the page draws, its sub-tabs and folds work for the session.
  page.install(storage(true));
  let threw = false;
  try {
    const b = build(today, []).body;
    page.click(tabButton(b, LAST));
    ok(visible(b).every((s) => s.dataset.gfxTab === LAST), 'with storage refusing, a sub-tab still shows');
  } catch {
    threw = true;
  }
  ok(!threw, 'and nothing throws');
  page.install(storage());
}

// ---------------------------------------------------------------- 7. a reload, in a process of its own

{
  // The session's reads are cached in this process, so a reload is a process of its own: the sub-tab and folds kept stand,
  // each fold kept the other way from how it starts, so a read that never reaches storage stands at the start and fails.
  const foldedAs = (r: Record<string, unknown>, rule: (t: string) => boolean) => FOLDING.every((t) => (r.folded as Record<string, boolean>)?.[t] === rule(t));
  const kept = reload('kept');
  ok(!kept.threw && (kept.on as string[]).join() === LAST && (kept.shown as string[]).join() === LAST, `a reload opens on the sub-tab kept (${JSON.stringify({ on: kept.on, shown: kept.shown, threw: kept.threw })})`);
  ok(foldedAs(kept, (t) => !GRAPHICS_FOLDED.includes(t)), 'and stands every section of a folding sub-tab as it was kept');
  const gone = reload('gone');
  ok(!gone.threw && (gone.on as string[]).join() === FIRST && (gone.shown as string[]).join() === FIRST, `a sub-tab kept that the page no longer has opens the first, shown and marked (${JSON.stringify({ on: gone.on, shown: gone.shown, threw: gone.threw })})`);
  const refused = reload('refuse');
  ok(!refused.threw && (refused.on as string[]).join() === FIRST && foldedAs(refused, (t) => GRAPHICS_FOLDED.includes(t)), `with storage refusing from the first read, the page draws on its first sub-tab, every fold as it starts (${refused.threw ?? 'drawn'})`);
  ok(LAST === FIRST || refused.clicked === true, 'and a sub-tab clicked still shows, for the session');
  const garbage = reload('garbage');
  ok(!garbage.threw && foldedAs(garbage, (t) => GRAPHICS_FOLDED.includes(t)), `with the folds kept unreadable, every fold as it starts (${garbage.threw ?? 'drawn'})`);
}

// ---------------------------------------------------------------- 8. the wiring only the menu makes

{
  const menu = readFileSync(join(REPO, 'src/ui/menu.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/body\.innerHTML = `<h2>Graphics<\/h2>\$\{graphicsMarkup\(GRAPHICS, \(k\) => this\.knobRows\(k\), this\.gfx\)\}<div class="menu-actions"><button class="reset-gfx">Reset graphics to defaults<\/button><\/div>`;\n      this\.wireKnobs\(body\);\n      wireGraphics\(body, this\.gfx, \{ scroller: body, sound: \(a\) => this\.onUiSound\(a\) \}\);/.test(menu), "the page is the menu's own rows laid out by `graphicsMarkup`, wired by `wireKnobs` and then by `wireGraphics`");
  ok(/for \(const g of GRAPHICS\) for \(const k of g\.knobs\) this\.setValue\(k\.key, DEFAULT_SETTINGS\[k\.key\]\);/.test(menu), 'its reset walks the very table it draws');
  const css = readFileSync(join(REPO, 'src/style.css'), 'utf8');
  const rules = css.slice(css.indexOf('.gfx-bar'), css.indexOf('.gfx-finding .gfx-folds'));
  ok(rules.length > 0 && !/z-index|position\s*:/.test(rules), "the page's own rules carry no z-index and no position");
  ok(css.includes('.menu-body .gfx-out { display: none; }'), 'what is not shown is hidden by a rule that outranks the knob rows\' own `display: flex`');
}

console.log(`\ngraphicsLayout: ${checks} checks passed`);
