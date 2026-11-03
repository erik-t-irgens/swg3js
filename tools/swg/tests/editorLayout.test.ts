// The world editor's window laid out to be found (the owner's ask of 2026-11-02): the Tools tab shows the Tools list across
// its top and below it only the armed tool's own sections (or with none armed the editing's own), with what every tool
// shares at its foot (`TOOL_SECTIONS`); every section's heading folds, on every tab, kept in this browser; and a tab drawn
// again, or come back to, stands where its scroll stood.
//
// Day one: the window as it stood before (90d089a's `editorWindow.ts`, out of git, beside today's) is built in the same
// stand-in page over the same made-up editor in every state, and every control of before is held present in today's once,
// in the very section it stood in, with the very act it had (the host calls a press, a change or a slide makes), wherever
// its section's owner is armed; the Selected and Here tabs, which only fold, hold every control of before exactly. Where
// git cannot hand the old file over, the comparison is skipped and said.
//
// The grouping is the owner's (one line of `TOOL_SECTIONS` or `EDITOR_FOLDED` a change), so nothing here pins it: each check
// holds the tables' rules (a section drawn exactly where its line says, folded exactly where the list says), never the
// grouping as it stands, and the day-one comparison is run again under one-line regroups of the table. A section of the
// window before is told by its id, never its heading's words (three headings are each two sections'). What a browser kept is
// read back in a node process of its own, which this test spawns of itself (`EDITOR_LAYOUT_RELOAD`): `folds.ts` reads each
// key once a session, so in the process that wrote it every later read is its cache, never storage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StandInPage, storage, type Element0 } from './standInPage.ts';
import { loadOld, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** This process is a reload the test spawned of itself: its mode (`kept`, `refuse`, `garbage`), else '' (the test). */
const RELOAD = process.env.EDITOR_LAYOUT_RELOAD ?? '';

const page = new StandInPage();
page.install(storage());

const tune = await import('../../../src/editor/editorTune.ts');
for (const [name, t] of [['look', { tintStrength: 1 }], ['attach', { size: 1 }], ['zone', { radius: 40 }], ['person', { still: 1 }]] as const) tune.registerExtraTune(name, t as Record<string, unknown>);
const { editorDialSet } = await import('../../../src/editor/editorDials.ts');
const today = await import('../../../src/ui/editorWindow.ts');
const { EditorWindow, TOOL_SECTIONS, EDITOR_FOLDED, EDITOR_FOLDS_KEY, toolSectionOwner } = today;
const PRE_WAVE = '90d089a';
const old = RELOAD ? null : ((await loadOld<{ EditorWindow: typeof EditorWindow }>(['src/ui/editorWindow.ts'], 'src/ui/editorWindow.ts', PRE_WAVE)) ?? null);
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- a made-up editor, in any state

const TOOLS = [
  { id: 'brush', label: 'the scatter brush', key: 'B' },
  { id: 'sculpt', label: 'the sculpt brush', key: 'K' },
  { id: 'paint', label: 'the paint brush', key: 'U' },
  { id: 'water', label: 'the water tool', key: 'Z' },
  { id: 'places', label: 'the places tool', key: 'P' },
  { id: 'zones', label: 'the no-spawn zone tool', key: '' },
  { id: 'lights', label: 'the lights tool', key: ';' },
  // The race drawer's first wave.
  { id: 'course', label: 'the Course tool', key: "'" },
];

/** Two shapes of what the editor hands the window, so the rows a mode draws (flatten, plants, a river) are all reached. */
type Variant = 'a' | 'b';
type View = 'row' | 'mark' | 'place' | 'lake' | 'river';

function makeHost(armed: string, variant: Variant, view: View, calls: string[]) {
  const rec = (name: string) => (...args: unknown[]) => void calls.push(`${name} ${JSON.stringify(args)}`);
  const a = variant === 'a';
  const groups = editorDialSet().groups.map((g) => ({
    ...g,
    dials: g.dials.map((d) => (d.kind === 'number' ? { ...d, set: (v: number) => (calls.push(`dial ${d.key} ${v}`), []) } : d)),
  }));
  return {
    view: () => null,
    keep: {} as never,
    pictureUrl: (s: string) => s,
    defaultPack: () => null,
    take: rec('take'),
    held: () => '',
    status: () => '',
    usedHere: () => [],
    sections: (tab: 'selected' | 'here' | 'tools') =>
      tab === 'tools'
        ? [
            { title: 'No-spawn zones', note: 'Let go: circles.', buttons: [{ label: armed === 'zones' ? 'Let go' : 'Arm', act: 'zone:arm' }, { label: 'Circle', act: 'zone:mode:circle', off: true }, { label: 'Outline', act: 'zone:mode:outline' }], rows: [{ words: 'Keeps the wildlife: yes', buttons: [{ label: 'Leave it', act: 'zone:keep:wild' }] }] },
            { title: "The world's own", note: 'Off.', buttons: [{ label: "World's own filter: off", act: 'filter' }] },
            ...(a ? [{ title: 'The walk grid', note: 'stale until baked' }] : []),
          ]
        : tab === 'selected'
          ? [{ title: "The world's own thing", note: 'a template', fields: [{ label: 'Its key', value: 'o:x@1,2,3', act: null }, { label: 'Its name', value: 'x', act: 'zone:name' }], rows: [{ words: 'Stands', buttons: [{ label: 'Hide', act: 'hide' }] }], buttons: [{ label: 'Let go', act: 'letgo' }] }]
          : [{ title: 'People here', rows: [{ words: 'a commoner', title: 'k1', buttons: [{ label: 'Take away', act: 'person:k1', danger: true }] }] }],
    sectionAct: rec('sectionAct'),
    place: () =>
      view === 'place'
        ? { id: 'pl-1', name: 'Dune Town', kind: 'city', shape: 'circle', map: true, say: false, build: true, own: { map: true, say: false, build: true }, desc: 'd', note: 'n', loading: 'a\nb', state: '', snippet: '{ "x": 1 }', words: 'w', sky: { env: 'clear', weather: '', grade: { gloom: 0.2 }, families: ['clear', 'storm'] } }
        : null,
    setPlaceRow: rec('setPlaceRow'),
    lake: () =>
      view === 'lake' || view === 'river'
        ? { id: 'lk-1', name: 'Pond', h: 3, points: 5, area: '40 m²', shader: 's', color: '#123456', opacity: '0.5', ripple: '1', drift: '1', note: 'water', ...(view === 'river' ? { river: { width: '8', velocity: '1', fallFrom: '', length: '30 m', steep: 'one reach' } } : {}) }
        : null,
    setLake: rec('setLake'),
    here: () => [{ id: 'r1', layer: 'world', label: 'Crate', away: '3 m', stood: true, bad: null }, { id: 'r2', layer: 'story', label: 'Lamp', away: '9 m', stood: false, bad: 'no model' }] as { id: string; layer: string; label: string; away: string; stood: boolean; bad: string | null }[],
    goTo: rec('goTo'),
    pickUp: rec('pickUp'),
    remove: rec('remove'),
    isPicked: (id: string) => id === 'r1',
    pick: rec('pick'),
    selected: () =>
      view === 'row' || view === 'mark'
        ? {
            count: 2,
            id: 'r1',
            label: 'Crate',
            file: 'world',
            model: 'crate',
            template: 't',
            x: 1,
            y: 2,
            z: 3,
            yaw: 10,
            pitch: 0,
            roll: 0,
            scale: '1',
            clear: '',
            guard: '',
            solid: true,
            state: '',
            name: '',
            note: '',
            size: '1 m',
            height: '0 m',
            note2: 'nothing',
            mark: view === 'mark',
            furnished: true,
            furniture: 'its own',
            counts: '',
            materials: [{ name: 'body', look: 'tinted', tint: '#ff0000', picture: null }],
            picking: 'the picker is armed',
            offered: { entry: 'a sign', materials: [{ name: 'face', ref: 'r', map: true }] },
            attachments: [{ i: 0, words: 'smoke', at: '0 1 0', size: '1', picked: false }],
          }
        : null,
    setField: rec('setField'),
    setPlace: rec('setPlace'),
    history: () => ({ at: 1, actions: ['put a crate (1 row)', 'moved it (1 row)'] }),
    historyTo: rec('historyTo'),
    tools: () => ({
      snapOn: a,
      grid: 0.25,
      angle: 15,
      gridSteps: [0.1, 0.25, 1],
      angleSteps: [5, 15],
      local: !a,
      gameView: false,
      hold: a,
      files: a ? ['placements/world/x.json: changed'] : [],
      branch: 'claude/mapmaker2',
      fold: { rows: a ? 3 : 1, ms: 1.2, folded: 4, folding: !a, auto: a, hint: 200 },
      list: TOOLS.map((t) => ({ ...t, armed: t.id === armed })),
      brush: { armed: armed === 'brush', entries: a ? [{ key: 'props/crate', name: 'Crate', weight: 1 }] : [], switches: [{ key: 'yaw', words: 'Yaw at random', on: true }] },
      sculpt: { armed: armed === 'sculpt', mode: a ? 'flatten' : 'raise', flatMode: 'both', target: 'typed', height: 12, falloff: 'smooth', falloffs: ['smooth', 'linear'], switches: [{ key: 'keep', words: 'Keep off', on: true }], file: 'heights: 3 tiles', note: a ? 'a note' : '' },
      paint: {
        armed: armed === 'paint',
        layer: a ? 'plants' : 'family',
        plants: { recipes: a ? [{ at: 0, words: 'trees thinned', chosen: true, paints: true }] : [], draft: [{ cls: 'trees', label: 'Trees', op: 'add', family: 'oak', families: ['oak', 'pine'] }], roads: false, note: 'p' },
        entries: a ? [{ at: 0, name: 'grass', child: null, picture: 'a.png', chosen: true, lays: true }] : [],
        families: [{ pack: 'naboo', name: 'grass', pictures: ['a.png', 'b.png'], lent: a }],
        packs: [{ id: 'naboo', words: 'Naboo', on: true }],
        browseNote: a ? 'b' : '',
        colour: '#808080',
        switches: [{ key: 'follow', words: 'Plants follow', on: true }],
        tint: 'gain',
        tints: ['gain', 'raw'],
        opposite: 'max',
        weights: a ? { key: 'grass', name: 'grass', values: [1, 2], own: [1, 1] } : null,
        dem: a ? { base: 'lok:sand', wash: true } : null,
        file: 'paint file',
        note: a ? 'n' : '',
      },
      water: { armed: armed === 'water', mode: a ? 'clicks' : 'river', levelFrom: 'typed', height: 3, riverHeights: 'level', steep: 'effects', draft: a ? 3 : 2, fallTop: false, picked: a ? 'lake-1' : null, lakes: 1, rivers: 0, file: 'water file', note: a ? 'n' : '' },
      places: { armed: armed === 'places', mode: a ? 'circle' : 'outline', kind: 'city', radius: 40, draft: a ? 3 : 1, picked: a ? 'place-1' : null, cities: !a, worldLoading: 'a\nb', worldSky: a ? '{}' : undefined, families: ['a'], file: 'f', note: a ? 'n' : '' },
      attach: { onto: a },
      furnish: a as boolean | undefined,
    }),
    setTool: rec('setTool'),
    refreshStatus: rec('refreshStatus'),
    dialSet: () => ({ helper: 'editor', groups, shipped: new Map() }),
    look: rec('look'),
    lookPalettes: () => Promise.resolve(null),
    attachment: rec('attachment'),
  };
}

type WindowLike = { root: unknown; setTab(t: string): void; refreshEdits(): void; refreshHere(): void; dispose(): void };

/** A window built in the page over the made-up editor, on a tab. */
function build(Win: typeof EditorWindow, armed: string, variant: Variant, view: View, calls: string[], tab: string): { w: WindowLike; root: Element0 } {
  const parent = page.createElement('div');
  page.body.append(parent);
  const w = new Win(parent as unknown as HTMLElement, makeHost(armed, variant, view, calls) as never) as unknown as WindowLike;
  w.setTab(tab);
  return { w, root: w.root as Element0 };
}

/** One control: its heading's words and which heading of the tab it stands under, its kind and words, and its act. */
interface Control {
  section: string;
  head: number;
  el: Element0;
  id: string;
  act: string;
}

function labelOf(el: Element0): string {
  if (el.localName === 'button') return el.textContent || el.title;
  const field = el.closest('.ed-field');
  const span = field?.querySelector('span');
  if (span && span !== el) return span.textContent;
  if (el.title) return el.title;
  const row = el.closest('.ed-row');
  return row?.querySelector('.ed-label')?.textContent ?? el.getAttribute('placeholder') ?? '';
}

/** Every control a tab draws, in its order, each pressed or moved once with the editor's calls written down. */
function controls(tabEl: Element0, calls: string[]): Control[] {
  const out: Control[] = [];
  let section = '';
  let head = -1;
  const all: Element0[] = [];
  const walk = (n: Element0) => {
    for (const k of n.children) {
      all.push(k);
      walk(k);
    }
  };
  walk(tabEl);
  const list: { el: Element0; section: string; head: number }[] = [];
  for (const el of all) {
    if (el.classList.contains('ed-h')) {
      section = el.textContent;
      head++;
    } else if (['button', 'input', 'select', 'textarea'].includes(el.localName)) list.push({ el, section, head });
  }
  for (const { el, section: s, head: h } of list) {
    const kind = el.localName === 'input' ? `input:${el.type}` : el.localName;
    const before = calls.length;
    if (el.localName === 'button') page.click(el);
    // A box is clicked: it turns, then is heard as a click and as a change, as a browser sends them.
    else if (el.localName === 'input' && el.type === 'checkbox') page.enter(el, String(!el.checked), ['click', 'change']);
    else if (el.localName === 'input' && el.type === 'range') page.enter(el, el.max, ['input']);
    else if (el.localName === 'input' && el.type === 'color') page.enter(el, '#123456', ['change']);
    else if (el.localName === 'input') page.enter(el, '7', ['change']);
    else if (el.localName === 'select') {
      const opts = el.querySelectorAll('option');
      page.enter(el, opts[opts.length - 1]?.value ?? '', ['change']);
    } else page.enter(el, 'x\ny', ['change']);
    el.blur();
    out.push({ section: s, head: h, el, id: `${kind}|${labelOf(el)}`, act: calls.slice(before).join(' / ') });
  }
  return out;
}

/**
 * Controls drawn under a folding heading but outside its section's body (which a fold would leave standing): every control
 * whose nearest heading before it folds must stand inside that heading's own section.
 */
function strays(tabEl: Element0): string[] {
  const out: string[] = [];
  let head: Element0 | null = null;
  const walk = (n: Element0) => {
    for (const k of n.children) {
      if (k.classList.contains('ed-h')) head = k;
      else if (['button', 'input', 'select', 'textarea'].includes(k.localName) && head?.classList.contains('ed-fold') && k.closest('.ed-sec') !== head.parentElement) out.push(`${head.textContent}: ${labelOf(k)}`);
      walk(k);
    }
  };
  walk(tabEl);
  return out;
}

const keyOf = (c: { section: string; id: string; act: string }) => `${c.section} :: ${c.id} -> ${c.act}`;
function multiset(list: { section: string; id: string; act: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of list) m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + 1);
  return m;
}
function sameSet(a: Map<string, number>, b: Map<string, number>): string[] {
  const diff: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) diff.push(`${k} (before ${a.get(k) ?? 0}, now ${b.get(k) ?? 0})`);
  return diff;
}

const tabOf = (root: Element0, cls: string) => root.querySelector(cls)!;
const STATES = ['none', ...TOOLS.map((t) => t.id)];
const secOf = (tabEl: Element0, id: string) => tabEl.querySelectorAll('.ed-sec').find((s) => s.dataset.sec === id) ?? null;
/** The state a Tools-tab section is drawn in: its tool's, else none (the editing's own and the foot both show then). */
const stateOf = (id: string) => {
  const o = toolSectionOwner(id);
  return o === 'always' ? 'none' : o;
};
/** The sections of what a browser keeps that the reload reads, each kept the other way round from how it starts. */
const RELOAD_KEYS = ['tools/sculpt', 'tools/dials:The free camera', 'selected/where'];

// ---------------------------------------------------------------- 0. a reload: what a browser kept, read in a process of its own

if (RELOAD) {
  const store = storage(RELOAD === 'refuse');
  if (RELOAD === 'kept') store.kept.set(EDITOR_FOLDS_KEY, JSON.stringify(Object.fromEntries(RELOAD_KEYS.map((k) => [k, !EDITOR_FOLDED.includes(k)]))));
  if (RELOAD === 'garbage') store.kept.set(EDITOR_FOLDS_KEY, '{not json');
  page.install(store);
  const out: Record<string, unknown> = {};
  try {
    for (const key of RELOAD_KEYS) {
      const [tab, id] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
      const t = tabOf(build(EditorWindow, tab === 'tools' ? stateOf(id) : 'none', 'a', 'row', [], tab).root, tab === 'tools' ? '.ed-tools' : '.ed-sel');
      const s = secOf(t, id);
      out[key] = s ? s.querySelector('.ed-sec-body')!.hidden : null;
      // A heading clicked: what it changes lasts the session whether or not storage takes it.
      if (s && tab === 'selected') {
        page.click(s.querySelector('.ed-h')!);
        out.clicked = s.querySelector('.ed-sec-body')!.hidden;
      }
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
    const text = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, EDITOR_LAYOUT_RELOAD: mode }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const line = text.split(/\r?\n/).find((l) => l.startsWith('RELOAD '));
    return line ? (JSON.parse(line.slice('RELOAD '.length)) as Record<string, unknown>) : { threw: `no answer: ${text.slice(-400)}` };
  } catch (err) {
    return { threw: String((err as { stderr?: string }).stderr || err) };
  }
}

// ---------------------------------------------------------------- 1. the table and the sections it names

{
  const titles = editorDialSet().groups.map((g) => `dials:${g.title}`);
  const missing = titles.filter((t) => !Object.prototype.hasOwnProperty.call(TOOL_SECTIONS, t));
  ok(missing.length === 0, `every group of the editor's sliders is named in the table (${titles.length}${missing.length ? `; missing ${missing.join(', ')}` : ''})`);
  const owners = new Set(Object.values(TOOL_SECTIONS));
  ok([...owners].every((o) => o === 'none' || o === 'always' || TOOLS.some((t) => t.id === o)), `every owner in the table is a tool of the list, none or always (${[...owners].join(', ')})`);
  ok(TOOLS.every((t) => owners.has(t.id)), 'and every tool of the list owns a section of its own');
  ok(toolSectionOwner('sec:A section a later wave adds') === 'always', 'a section the table does not name stands at the foot, never lost from view');
  // The tools the game itself lists, by their ids in their own files.
  const ids = ['editorBrush', 'editorSculpt', 'editorPaint', 'editorWater', 'editorPlaces', 'editorZones', 'editorLights', 'editorCourse'].map((f) => /^\s+id: '(\w+)',$/m.exec(read(`src/editor/${f}.ts`))?.[1]);
  ok(ids.join(',') === TOOLS.map((t) => t.id).join(','), `the tools the table names are the editor's own (${ids.join(', ')})`);
  // What the editor hands the Tools tab of its own, by the titles its own files give it: a line of the table naming a title
  // nothing hands the tab (a title renamed) would leave that section at the foot under every tool, with nothing to say so.
  const entry = read('src/editor/editorEntry.ts');
  ok(/sections: \(tab: 'selected' \| 'here' \| 'tools'\): EditorSection\[\] => \[\.\.\.this\.lightsSections\(tab\), \.\.\.this\.courseSections\(tab\), \.\.\.this\.zones\.sections\(tab\), \.\.\.this\.removals\.sections\(tab\)\],/.test(entry) && /if \(tab === 'tools'\) return this\.lights\.toolsSections\(\);/.test(entry) && /if \(tab === 'tools'\) return this\.course\.toolsSections\(\);/.test(entry), "the editor hands the window the lights tool's sections, the Course tool's, the zones' and the removals' (the files read below)");
  const handed = new Set<string>();
  for (const f of ['src/editor/editorZones.ts', 'src/editor/editorRemovals.ts']) {
    const text = read(f);
    const at = text.indexOf("if (tab === 'tools') {", text.indexOf('  sections(tab'));
    const end = text.indexOf('return out;', at);
    for (const m of text.slice(at, end).matchAll(/title: (?:'([^']*)'|"([^"]*)")/g)) handed.add(m[1] ?? m[2]);
  }
  // The lights tool's (Map-maker II's wave of the rooms' lights) and the Course tool's (the race drawer's first wave): what
  // each one's own `toolsSections` hands the tab.
  for (const f of ['src/editor/editorLights.ts', 'src/editor/editorCourse.ts']) {
    const text = read(f);
    const at = text.indexOf('  toolsSections(): EditorSection[] {');
    const end = text.indexOf('\n  }\n', at);
    for (const m of text.slice(at, end).matchAll(/title: (?:'([^']*)'|"([^"]*)")/g)) handed.add(m[1] ?? m[2]);
  }
  const named = Object.keys(TOOL_SECTIONS).filter((k) => k.startsWith('sec:')).map((k) => k.slice('sec:'.length));
  const unreal = named.filter((t) => !handed.has(t));
  ok(handed.size > 0 && unreal.length === 0, `every section the table names of what the editor hands the Tools tab is one its own files hand it (${[...handed].join(', ')})${unreal.length ? `; not: ${unreal.join(', ')}` : ''}`);
  const made = makeHost('none', 'a', 'row', []).sections('tools').map((s) => s.title);
  ok(made.every((t) => handed.has(t)), `and the made-up editor here hands the Tools tab the very titles the real one does (${made.join(', ')})`);
}

// ---------------------------------------------------------------- 2. the Tools tab: each tool's own, the editing's own, the foot

/** Each of the tab's own and handed sections' id by its heading's words (the sliders' headings repeat three of them). */
const headToId = new Map<string, string>();
const headClash = new Set<string>();

/** Today's Tools tab in every state, held to the table as it stands: what it draws, where, and in what order. */
function toolsTab(label: string): Map<string, string[]> {
  const shown = new Map<string, string[]>();
  for (const variant of ['a', 'b'] as const) {
    const union = new Set<string>();
    for (const armed of STATES) {
      const { root } = build(EditorWindow, armed, variant, 'row', [], 'tools');
      const tab = tabOf(root, '.ed-tools');
      const secs = tab.querySelectorAll('.ed-sec');
      for (const s of secs) {
        const id = s.dataset.sec!;
        if (id.startsWith('dials:')) continue;
        const head = s.querySelector('.ed-h')!.textContent;
        if (headToId.has(head) && headToId.get(head) !== id) headClash.add(`${head}: ${headToId.get(head)} and ${id}`);
        headToId.set(head, id);
      }
      const ids = secs.map((s) => s.dataset.sec!);
      for (const id of ids) union.add(id);
      shown.set(`${variant}/${armed}`, ids);
      const wrong = ids.filter((id) => toolSectionOwner(id) !== armed && toolSectionOwner(id) !== 'always');
      ok(wrong.length === 0, `${label}${variant}, ${armed} armed: only its own sections and the foot are drawn${wrong.length ? ` (also ${wrong.join(', ')})` : ''}`);
      const foot = ids.findIndex((id) => toolSectionOwner(id) === 'always');
      ok(foot < 0 || ids.slice(foot).every((id) => toolSectionOwner(id) === 'always'), `${label}${variant}, ${armed}: the foot stands last`);
      ok(tab.children[0]?.textContent === 'TOOLS' && tab.children[1]?.querySelectorAll('button').length === TOOLS.length, `${label}${variant}, ${armed}: the Tools list stands at the top, a button a tool`);
      const lost = strays(tab);
      ok(lost.length === 0, `${label}${variant}, ${armed}: every control stands inside its own section, so a fold folds all of it${lost.length ? ` (${lost.join(', ')})` : ''}`);
    }
    // The converse: a section the tab draws in some state is drawn in every state its line gives it.
    for (const armed of STATES) {
      const ids = shown.get(`${variant}/${armed}`)!;
      const missing = [...union].filter((id) => (toolSectionOwner(id) === armed || toolSectionOwner(id) === 'always') && !ids.includes(id));
      ok(missing.length === 0, `${label}${variant}, ${armed} armed: every section its line gives it is drawn${missing.length ? ` (not ${missing.join(', ')})` : ''}`);
    }
  }
  return shown;
}

const shownIds = toolsTab('');
ok(headClash.size === 0, `no two of the tab's own sections share a heading, so a heading of the window before names one${headClash.size ? ` (${[...headClash].join('; ')})` : ''}`);

{
  // A click on a tool's button arms it exactly as its key does: the editor is asked for that tool by its id.
  const calls: string[] = [];
  const { root } = build(EditorWindow, 'none', 'a', 'row', calls, 'tools');
  const b = tabOf(root, '.ed-tools').children[1].querySelectorAll('button')[1];
  page.click(b);
  ok(calls[0] === 'setTool [{"tool":"sculpt"}]', `a tool's button asks for it by id, as its key does (${calls[0]})`);
  const armedRoot = build(EditorWindow, 'water', 'a', 'row', [], 'tools').root;
  const waterBtn = tabOf(armedRoot, '.ed-tools').children[1].querySelectorAll('button')[3];
  ok(waterBtn.classList.contains('on') && /: armed$/.test(waterBtn.textContent), `the armed tool is marked (${waterBtn.textContent})`);
}

// ---------------------------------------------------------------- 3. day one: every control of before, in its section, with its act

const DIAL_TITLES = editorDialSet().groups.map((g) => g.title);
let slidersLast = true;

/**
 * The Tools tab of before and today's in every state, under the table as it stands: every control of before in the
 * sections the state shows is drawn once, in the very section (by id) it stood in, with its act. A control of before is
 * told its section by where its heading stands: the window before drew its sliders last, a group a heading in the sliders'
 * order (held), and every other heading is one section's (held in section 2).
 */
function dayOne(label: string): void {
  if (!old) return;
  const unseen = new Set<string>();
  for (const variant of ['a', 'b'] as const) {
    for (const armed of STATES) {
      const before: string[] = [];
      const now: string[] = [];
      const o = build(old.EditorWindow, armed, variant, 'row', before, 'tools');
      const n = build(EditorWindow, armed, variant, 'row', now, 'tools');
      const otab = tabOf(o.root, '.ed-tools');
      const heads = otab.querySelectorAll('.ed-h').map((h) => h.textContent);
      const firstDial = heads.length - DIAL_TITLES.length;
      if (heads.slice(firstDial).join('|') !== DIAL_TITLES.map((t) => t.toUpperCase()).join('|')) slidersLast = false;
      const oc = controls(otab, before).map((c) => ({ ...c, section: c.section === 'TOOLS' ? 'TOOLS' : c.head >= firstDial ? `dials:${DIAL_TITLES[c.head - firstDial]}` : (headToId.get(c.section) ?? `?${c.section}`) }));
      const nc = controls(tabOf(n.root, '.ed-tools'), now).map((c) => ({ ...c, section: c.el.closest('.ed-sec')?.dataset.sec ?? (c.section === 'TOOLS' ? 'TOOLS' : `?${c.section}`) }));
      for (const c of oc) if (c.section.startsWith('?')) unseen.add(c.section.slice(1));
      const kept = oc.filter((c) => c.section === 'TOOLS' || toolSectionOwner(c.section) === armed || toolSectionOwner(c.section) === 'always');
      const diff = sameSet(multiset(kept), multiset(nc));
      ok(diff.length === 0 && nc.length > 0, `${label}${variant}, ${armed} armed: every control of before in its shown sections is drawn once, in its section, with its act (${nc.length} controls)${diff.length ? `\n  ${diff.join('\n  ')}` : ''}`);
      // The comparison is of acts, not of names: every control of the tab asks the editor for something when used.
      const idle = nc.filter((c) => !c.act);
      ok(idle.length === 0, `${label}${variant}, ${armed}: every control drawn asks the editor for something (${nc.length - idle.length} of ${nc.length})${idle.length ? `: ${idle.map((c) => c.id).join(', ')}` : ''}`);
      if (process.env.EDITOR_LAYOUT_DUMP === `${variant}/${armed}`) for (const c of nc) console.log(`  ${keyOf(c)}`);
      // Their order: the sections shown stand in the order they stood.
      const order = (list: { section: string }[]) => [...new Set(list.map((c) => c.section))].filter((s) => s === 'TOOLS' || toolSectionOwner(s) !== 'always');
      ok(order(nc).join('|') === order(kept).join('|'), `${label}${variant}, ${armed}: its own sections stand in the order they stood`);
    }
  }
  ok(slidersLast, `${label}the window before drew its sliders last, a group a heading in the sliders' order, which is how a slider's section is told from the tab's own of the same heading`);
  ok(unseen.size === 0, `${label}every section the Tools tab drew before is drawn under some tool now${unseen.size ? ` (never: ${[...unseen].join(', ')})` : ''}`);
}

if (!old) console.log('note git cannot hand 90d089a over here: the comparison with the window before is skipped');
else {
  dayOne('');

  // The Selected and Here tabs only fold: every control of before, exactly.
  for (const view of ['row', 'mark', 'place', 'lake', 'river'] as const) {
    const before: string[] = [];
    const now: string[] = [];
    const oc = controls(tabOf(build(old.EditorWindow, 'none', 'a', view, before, 'selected').root, '.ed-sel'), before);
    const nc = controls(tabOf(build(EditorWindow, 'none', 'a', view, now, 'selected').root, '.ed-sel'), now);
    const diff = sameSet(multiset(oc), multiset(nc));
    ok(diff.length === 0 && nc.length > 0, `the Selected tab (${view}): every control of before, in its section, with its act (${nc.length})${diff.length ? `\n  ${diff.join('\n  ')}` : ''}`);
    // Its own sections, with nothing the editor hands it drawn first (a place's or a lake's fields stand unheaded after
    // whatever the editor handed, as they always did).
    const parent = page.createElement('div');
    page.body.append(parent);
    const bare = makeHost('none', 'a', view, []);
    const handed = bare.sections;
    bare.sections = (tab) => (tab === 'selected' ? [] : handed(tab));
    const w = new EditorWindow(parent as unknown as HTMLElement, bare as never);
    w.setTab('selected');
    const lost = strays(tabOf(w.root as unknown as Element0, '.ed-sel'));
    ok(lost.length === 0, `the Selected tab (${view}): every control stands inside its own section${lost.length ? ` (${lost.join(', ')})` : ''}`);
  }
  {
    const before: string[] = [];
    const now: string[] = [];
    const oc = controls(tabOf(build(old.EditorWindow, 'none', 'a', 'row', before, 'here').root, '.ed-here'), before);
    const nc = controls(tabOf(build(EditorWindow, 'none', 'a', 'row', now, 'here').root, '.ed-here'), now);
    const diff = sameSet(multiset(oc), multiset(nc));
    ok(diff.length === 0 && nc.length > 0, `the Here tab: every control of before, with its act (${nc.length})${diff.length ? `\n  ${diff.join('\n  ')}` : ''}`);
  }
}

// A regroup is one line of the table, the owner's: each of these sections moved alone (to the first owner named that is not
// its owner now, so the list follows the table whatever it says) still draws every section exactly where the table then
// says, and keeps every control of before once, under the tool its line then names, with its act.
const REGROUPS: readonly (readonly [string, string, string])[] = [
  ['fold', 'always', 'none'],
  ['snapping', 'sculpt', 'none'],
  ['dials:The brush', 'none', 'brush'],
  ["sec:The world's own", 'zones', 'none'],
];
{
  const drawn = new Set([...shownIds.values()].flat());
  ok(REGROUPS.every(([k]) => drawn.has(k)), `the sections the regroups move are sections the tab draws (${REGROUPS.map(([k]) => k).join(', ')})`);
}
for (const [k, first, second] of REGROUPS) {
  const table = TOOL_SECTIONS as Record<string, string>;
  const had = Object.prototype.hasOwnProperty.call(table, k);
  const was = table[k];
  const to = toolSectionOwner(k) === first ? second : first;
  table[k] = to;
  try {
    toolsTab(`${k} moved to ${to}: `);
    dayOne(`${k} moved to ${to}: `);
  } finally {
    if (had) table[k] = was;
    else delete table[k];
  }
}

// ---------------------------------------------------------------- 4. folding, kept in this browser

{
  // The sections each tab draws, so the list of what starts folded can be held to sections that exist.
  const seen = new Map<string, Set<string>>([['tools', new Set([...shownIds.values()].flat())], ['selected', new Set()], ['here', new Set()]]);
  for (const view of ['row', 'mark', 'place', 'lake', 'river'] as const) for (const s of tabOf(build(EditorWindow, 'none', 'a', view, [], 'selected').root, '.ed-sel').querySelectorAll('.ed-sec')) seen.get('selected')!.add(s.dataset.sec!);
  for (const s of tabOf(build(EditorWindow, 'none', 'a', 'row', [], 'here').root, '.ed-here').querySelectorAll('.ed-sec')) seen.get('here')!.add(s.dataset.sec!);
  const unknown = EDITOR_FOLDED.filter((k) => {
    const at = k.indexOf('/');
    return at < 0 || !seen.get(k.slice(0, at))?.has(k.slice(at + 1));
  });
  ok(unknown.length === 0, `every section the list says starts folded is a section a tab draws (${EDITOR_FOLDED.length})${unknown.length ? `; not: ${unknown.join(', ')}` : ''}`);

  const store = storage();
  page.install(store);
  const calls: string[] = [];
  const { root } = build(EditorWindow, 'sculpt', 'a', 'row', calls, 'tools');
  const tab = tabOf(root, '.ed-tools');
  const secs = tab.querySelectorAll('.ed-sec');
  const body = (id: string) => secOf(tab, id)!.querySelector('.ed-sec-body')!;
  const head = (id: string) => secOf(tab, id)!.querySelector('.ed-h')!;
  const starts = (key: string) => EDITOR_FOLDED.includes(key);
  const wrongFold = secs.filter((s) => s.querySelector('.ed-sec-body')!.hidden !== starts(`tools/${s.dataset.sec}`)).map((s) => s.dataset.sec);
  ok(wrongFold.length === 0, `every section starts folded exactly where the list says (${secs.filter((s) => s.querySelector('.ed-sec-body')!.hidden).length} of ${secs.length} with the sculpt brush armed)${wrongFold.length ? `; not: ${wrongFold.join(', ')}` : ''}`);
  const open = secs.find((s) => !starts(`tools/${s.dataset.sec}`) && s.querySelector('.ed-sec-body button'))?.dataset.sec ?? '';
  ok(open !== '', `a section that starts open, with a button, to fold (${open})`);
  page.click(head(open));
  ok(body(open).hidden && head(open).classList.contains('folded'), 'a click on a heading folds its section');
  ok(JSON.parse(store.kept.get(EDITOR_FOLDS_KEY) ?? '{}')[`tools/${open}`] === true, 'and the fold is kept in this browser, by tab and section');
  // Folded, its controls still act.
  const before = calls.length;
  page.click(body(open).querySelector('button')!);
  ok(calls.length === before + 1, `a control in a folded section still acts (${calls[before]})`);
  const shut = secs.find((s) => starts(`tools/${s.dataset.sec}`))?.dataset.sec;
  if (!shut) console.log('note nothing drawn with the sculpt brush armed starts folded: the unfolding of a default fold is not tried');
  else {
    page.click(head(shut));
    ok(!body(shut).hidden && JSON.parse(store.kept.get(EDITOR_FOLDS_KEY) ?? '{}')[`tools/${shut}`] === false, `a section folded by default unfolds and is kept so (${shut})`);
  }
  // A window built again in this session reads what was kept.
  const again = tabOf(build(EditorWindow, 'sculpt', 'a', 'row', [], 'tools').root, '.ed-tools');
  ok(secOf(again, open)!.querySelector('.ed-sec-body')!.hidden, 'a window built again stands folded as it was left');
  // The Selected tab folds the same way.
  const sel = tabOf(build(EditorWindow, 'none', 'a', 'row', [], 'selected').root, '.ed-sel');
  const where = secOf(sel, 'where')!;
  const was = where.querySelector('.ed-sec-body')!.hidden;
  page.click(where.querySelector('.ed-h')!);
  ok(where.querySelector('.ed-sec-body')!.hidden === !was && JSON.parse(store.kept.get(EDITOR_FOLDS_KEY) ?? '{}')['selected/where'] === !was, "the Selected tab's sections fold and are kept the same way");
  const secIds = sel.querySelectorAll('.ed-sec').map((s) => s.dataset.sec);
  ok(["sec:The world's own thing", 'where', 'what', 'look', 'hangs'].every((id) => secIds.includes(id)), `every heading of the Selected tab folds (${secIds.join(', ')})`);
  // Storage that refuses, in this session: the window draws, folds and keeps the fold for the session.
  page.install(storage(true));
  let threw = false;
  try {
    const r = tabOf(build(EditorWindow, stateOf('paint'), 'b', 'row', [], 'tools').root, '.ed-tools');
    const p = secOf(r, 'paint')!;
    const pw = p.querySelector('.ed-sec-body')!.hidden;
    page.click(p.querySelector('.ed-h')!);
    ok(p.querySelector('.ed-sec-body')!.hidden === !pw, 'with storage refusing, a section still folds');
  } catch {
    threw = true;
  }
  ok(!threw, 'and nothing throws');
  page.install(storage());

  // A reload, in a process of its own (the session's reads are cached in this one): what was kept is what stands, each
  // kept the other way from how it starts, so a read that never reaches storage stands at the start and fails.
  const kept = reload('kept');
  ok(!kept.threw && RELOAD_KEYS.every((k) => kept[k] === !EDITOR_FOLDED.includes(k)), `a reload stands every section as the browser kept it (${JSON.stringify(kept)})`);
  const refused = reload('refuse');
  ok(!refused.threw && RELOAD_KEYS.every((k) => refused[k] === EDITOR_FOLDED.includes(k)), `with storage refusing from the first read, the window draws, every section as it starts (${JSON.stringify(refused)})`);
  ok(refused.clicked === !EDITOR_FOLDED.includes('selected/where'), 'and a heading clicked still folds, for the session');
  const garbage = reload('garbage');
  ok(!garbage.threw && RELOAD_KEYS.every((k) => garbage[k] === EDITOR_FOLDED.includes(k)), `with what is kept unreadable, every section as it starts (${JSON.stringify(garbage)})`);
}

// ---------------------------------------------------------------- 5. the scroll stands where it stood

{
  // The mechanism, under a table of this test's own for the length of it (the grouping is the owner's): a made-up editor
  // whose foot can grow (a section the table does not name stands there), and whose sections above Folding can be taken
  // away (the furnish switch, which stands first).
  const table = TOOL_SECTIONS as Record<string, string>;
  const kept = { furnish: table.furnish, attach: table.attach, fold: table.fold };
  Object.assign(table, { furnish: 'none', attach: 'none', fold: 'none' });
  try {
    let extra = 0;
    const calls: string[] = [];
    const parent = page.createElement('div');
    page.body.append(parent);
    const host = makeHost('none', 'a', 'row', calls);
    const baseSections = host.sections;
    host.sections = (tab) => (tab === 'tools' ? [{ title: 'Grows', note: 'n', rows: Array.from({ length: extra }, (_v, i) => ({ words: `row ${i}`, buttons: [] })) }, ...baseSections(tab)] : baseSections(tab));
    const w = new EditorWindow(parent as unknown as HTMLElement, host as never);
    const root = w.root as unknown as Element0;
    root.hidden = false;
    w.setTab('tools');
    const tab = tabOf(root, '.ed-tools');
    tab.clientHeight = 200;
    const secTop = (id: string) => secOf(tab, id)!.getBoundingClientRect().top - tab.getBoundingClientRect().top;
    tab.scrollTop = 300;
    const at = secTop('fold');
    // Drawn again, the same.
    w.refreshEdits();
    ok(Math.abs(secTop('fold') - at) < 1e-9 && tab.scrollTop === 300, `drawn again, the tab stands where it stood (${tab.scrollTop})`);
    // What stands above Folding taken away: the furnish switch's section goes.
    const t0 = host.tools;
    host.tools = () => ({ ...t0(), furnish: undefined, attach: { onto: true } });
    w.refreshEdits();
    ok(Math.abs(secTop('fold') - at) < 1e-9 && tab.scrollTop !== 300, `what stood above shrinking moves nothing under the eye: Folding stands where it stood (scroll ${tab.scrollTop})`);
    host.tools = t0;
    w.refreshEdits();
    // Away to the Selected tab and back: the Tools tab stands where it was left.
    tab.scrollTop = 260;
    const left = secTop('fold');
    w.setTab('selected');
    ok(tab.scrollTop === 0, 'a hidden tab loses its scroll, as a browser loses it');
    w.setTab('tools');
    ok(Math.abs(secTop('fold') - left) < 1e-9 && tab.scrollTop === 260, `come back to, the tab stands where it was left (${tab.scrollTop})`);
    // At the top stays at the top.
    tab.scrollTop = 0;
    extra = 5;
    w.refreshEdits();
    ok(tab.scrollTop === 0, 'at the top, a redraw keeps it at the top');
  } finally {
    Object.assign(table, kept);
  }
  {
    // The rules themselves, on a scroller of their own: what grows above the section looked at moves nothing under the eye,
    // and a scroller at its top stays at its top whatever grows above its first section.
    const { scrollMark, restoreScroll } = await import('../../../src/ui/folds.ts');
    const s = page.createElement('div');
    page.body.append(s);
    s.clientHeight = 60;
    const sec = (id: string, rows: number) => {
      const d = page.createElement('div');
      d.dataset.sec = id;
      for (let i = 0; i < rows; i++) d.append(page.createElement('div'));
      return d;
    };
    s.append(page.createElement('div'), sec('a', 3), sec('b', 4), sec('c', 5));
    s.scrollTop = 0;
    const m0 = scrollMark(s);
    s.insertBefore(page.createElement('div'), s.children[0]);
    restoreScroll(s, m0);
    ok(s.scrollTop === 0, 'a scroller at its top stays at its top when something grows above its first section');
    s.scrollTop = 100;
    const m1 = scrollMark(s);
    const byId = (id: string) => s.children.find((c) => c.dataset.sec === id)!;
    const topOf = (id: string) => byId(id).getBoundingClientRect().top - s.getBoundingClientRect().top;
    const atB = topOf('b');
    s.insertBefore(page.createElement('div'), s.children[0]);
    s.insertBefore(page.createElement('div'), s.children[0]);
    restoreScroll(s, m1);
    ok(m1.id === 'b' && s.scrollTop === 140 && topOf('b') === atB, `scrolled, the section looked at stands where it stood when 40 px grow above it (${m1.id}, ${s.scrollTop})`);
    byId('b').remove();
    restoreScroll(s, m1);
    ok(s.scrollTop === 100, `and with that section gone, the plain scroll comes back (${s.scrollTop})`);
    // The view's top in something no section holds, a section further down the view: the plain scroll is the mark.
    const t = page.createElement('div');
    page.body.append(t);
    t.clientHeight = 100;
    for (let i = 0; i < 6; i++) t.append(page.createElement('div'));
    t.append(sec('d', 3));
    t.scrollTop = 30;
    const m2 = scrollMark(t);
    for (let i = 0; i < 10; i++) t.insertBefore(page.createElement('div'), t.children[6]);
    restoreScroll(t, m2);
    ok(m2.id === null && t.scrollTop === 30, `the view's top in no section, a section on screen below it: the plain scroll is kept, the rows under the eye with it (${m2.id}, ${t.scrollTop})`);
    s.remove();
    t.remove();
  }
  if (old) {
    // Before: the same trip lost the scroll.
    const o = build(old.EditorWindow, 'none', 'a', 'row', [], 'tools');
    const or = o.root;
    or.hidden = false;
    const ot = tabOf(or, '.ed-tools');
    ot.clientHeight = 200;
    ot.scrollTop = 260;
    o.w.setTab('selected');
    o.w.setTab('tools');
    ok(ot.scrollTop === 0, 'and before this wave the same trip put the Tools tab back at its top (the fault mended)');
  }
}

{
  // Every tab, not the Tools tab alone: a write landing or the selection moving draws the Selected tab again, the camera
  // moving draws the Here tab again, and each tab (the library's own list of groups among them) is come back to where it
  // was left.
  let grows = 0;
  let rows = 2;
  const parent = page.createElement('div');
  page.body.append(parent);
  const host = makeHost('none', 'a', 'row', []);
  const handed = host.sections;
  host.sections = (tab) => (tab === 'selected' ? [{ title: 'Grows', note: 'n', rows: Array.from({ length: grows }, (_v, i) => ({ words: `row ${i}`, buttons: [] })) }, ...handed(tab)] : handed(tab));
  host.here = () => Array.from({ length: rows }, (_v, i) => ({ id: `r${i}`, layer: 'world', label: `Row ${i}`, away: `${i} m`, stood: true, bad: null }));
  host.history = () => ({ at: 1, actions: Array.from({ length: 30 }, (_v, i) => `action ${i}`) });
  const w = new EditorWindow(parent as unknown as HTMLElement, host as never);
  const root = w.root as unknown as Element0;
  root.hidden = false;
  const topIn = (tabEl: Element0, id: string) => secOf(tabEl, id)!.getBoundingClientRect().top - tabEl.getBoundingClientRect().top;

  // The Selected tab: the view's top inside WHAT IT IS, a write landing with what stands above it grown.
  w.setTab('selected');
  const sel = tabOf(root, '.ed-sel');
  sel.clientHeight = 100;
  sel.scrollTop = topIn(sel, 'what') + 10;
  const scrolled = sel.scrollTop;
  const what = topIn(sel, 'what');
  grows = 3;
  w.refreshEdits();
  ok(Math.abs(topIn(sel, 'what') - what) < 1e-9 && sel.scrollTop > scrolled, `the Selected tab drawn again with more above: WHAT IT IS stands where it stood (scroll ${scrolled} to ${sel.scrollTop})`);
  w.setTab('tools');
  w.setTab('selected');
  ok(Math.abs(topIn(sel, 'what') - what) < 1e-9, 'and come back to, it stands where it was left');

  // The Here tab: the view's top inside a section the editor hands it, the rows above it grown.
  w.setTab('here');
  const here = tabOf(root, '.ed-here');
  here.clientHeight = 50;
  const rowH = here.querySelector('.ed-row')!.boxHeight;
  here.scrollTop = topIn(here, 'sec:People here') + 5;
  const people = topIn(here, 'sec:People here');
  rows = 6;
  w.refreshHere();
  ok(Math.abs(topIn(here, 'sec:People here') - people) < 1e-9, `the Here tab drawn again with more rows above: the section looked at stands where it stood (scroll ${here.scrollTop})`);
  // The view's top in the rows, the section on screen below them: the rows stay under the eye.
  here.clientHeight = 3 * rowH;
  rows = 4;
  w.refreshHere();
  const inRows = Math.round(1.25 * rowH);
  here.scrollTop = inRows;
  ok(here.scrollTop === inRows && topIn(here, 'sec:People here') > 0 && topIn(here, 'sec:People here') < here.clientHeight!, `with the view in the rows (${here.scrollTop}) and the section on screen below them (${topIn(here, 'sec:People here')} of ${here.clientHeight})`);
  rows = 40;
  w.refreshHere();
  ok(here.scrollTop === inRows, `the rows growing under it leave the view where it was (${here.scrollTop})`);
  // And the section off the screen below (the review's case: six rows, the view 30 px in, forty rows after).
  here.clientHeight = 100;
  rows = 6;
  w.refreshHere();
  here.scrollTop = 30;
  rows = 40;
  w.refreshHere();
  ok(here.scrollTop === 30, `six rows to forty under a view 30 px in: the scroll stays at 30 (${here.scrollTop})`);

  // The History tab (no section: its plain scroll) and the library's list of groups, each come back to where it was left.
  w.setTab('history');
  const hist = tabOf(root, '.ed-hist');
  hist.clientHeight = 100;
  hist.scrollTop = 140;
  w.setTab('tools');
  w.setTab('history');
  ok(hist.scrollTop === 140, `the History tab come back to stands where it was left (${hist.scrollTop})`);
  w.setTab('library');
  const groups = root.querySelector('.lib-groups')!;
  groups.clientHeight = 100;
  for (let i = 0; i < 20; i++) groups.append(page.createElement('div'));
  groups.scrollTop = 150;
  w.setTab('tools');
  ok(groups.scrollTop === 0, "the library's list hidden loses its scroll, as a browser's does");
  w.setTab('library');
  ok(groups.scrollTop === 150, `and the library come back to stands where its list was left (${groups.scrollTop})`);
}

// ---------------------------------------------------------------- 6. the wiring only the editor makes

{
  const win = read('src/ui/editorWindow.ts');
  ok(/for \(const p of parts\) if \(toolSectionOwner\(p\.id\) === armed\) this\.drawPart\(el, 'tools', p\);\n    for \(const p of parts\) if \(toolSectionOwner\(p\.id\) === 'always'\) this\.drawPart\(el, 'tools', p\);/.test(win), "the Tools tab draws the armed tool's own sections, then the foot, by the table");
  ok(/--ed-w/.test(win) && /--ed-h/.test(win) && /draggable\(root, '\.ed-panel', '\.ed-head', 'editor'\);/.test(win), "the window still moves and sizes by `draggable`, its own size from its stylesheet's custom properties");
  const css = /const EDITOR_WINDOW_CSS = `([\s\S]*?)`;/.exec(win)?.[1] ?? '';
  ok(!/z-index/.test(css), 'and its stylesheet carries no z-index');
  ok(css.includes('.ed-sec-body[hidden] { display: none; }'), "a folded section's body is hidden by the stylesheet, since the body is a flex box `hidden` alone would not hide");
  // A key the window reads must never be drawn over a tab that is not showing: the folds are read off `this.folds` alone.
  ok(!/localStorage/.test(win), 'the window touches no storage of its own: its folds are `FoldStore`\'s, every call in a try');
}

console.log(`\neditorLayout: ${checks} checks passed`);
