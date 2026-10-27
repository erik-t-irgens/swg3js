// The world editor's window (DESIGN.md §2.2, §2.5, §2.6): docked at the left, moved by its header and sized by its corner
// like every window (`draggable`, `WINDOW_MIN.editor`), and five tabs -- **Library**, everything it can put down;
// **Selected**, the inspector of the first picked row (its name, id, file, model, template, raw place, turn, scale,
// clear, guard, solid, state, name and note, its size and its height over the ground), each field written through as an
// action -- its place, turn and scale for the first alone, what it is for every picked row alike; **Here**, the permanent rows standing round the camera with their file, a way to fly to each, to pick one up,
// to take it out of its file, and a box a row to pick it (Shift-click a box picks a run); **Tools**, snapping, the axes,
// game view, holding the world, git's word on the files, from the third wave the fold (Fold now, the automatic fold's
// switch) and the brush (armed, its entries and their weights, its switches), and the editor's dials; and **History**, every action of this
// world's session, a click going back or forward to any of them.
//
// It is not a panel: it stays out of `anyPanelOpen`, so the world goes on simulating under it and the camera flies, and
// it is clickable only in Point mode (in Fly the pointer is locked and nothing on the page is reached). A button gives
// the keyboard back to the page after a click, and a field gives it back when it is left, so WASD still flies; nothing in
// it ever swallows a key unless a text field has the keyboard. The dev server's alone: reached only through the editor's
// own dynamic import. Every colour on it is one of the eighteen.

import { EDITOR_TUNE } from '../editor/editorTune.ts';
import type { DialSet, NumberDial } from './dials.ts';
import { draggable } from './drag.ts';
import { LibraryUi, type LibraryHost } from './libraryUi.ts';

const EDITOR_WINDOW_CSS = `
.ed-panel { position: fixed; left: 12px; top: 64px; width: var(--ed-w, 560px); height: var(--ed-h, 78vh); max-height: calc(100vh - 80px); display: flex; flex-direction: column; gap: 8px; background: var(--panel); border: 1px solid var(--panel-border); border-radius: 4px; padding: 8px 10px 10px; color: var(--ink); font-size: 12px; box-sizing: border-box; }
.ed-panel[hidden] { display: none; }
#ui > .ed-panel { pointer-events: auto; }
#ui > .ed-panel.fly { pointer-events: none; opacity: 0.82; }
.ed-panel.fly * { pointer-events: none; }
.ed-head { display: flex; align-items: center; gap: 10px; cursor: move; user-select: none; }
.ed-head .ed-title { font-size: 11px; letter-spacing: 0.1em; color: var(--accent); }
.ed-head .ed-mode { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); margin-left: auto; }
.ed-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.ed-tabs button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: transparent; border: 1px solid var(--rule); border-radius: 3px; padding: 3px 9px; cursor: pointer; }
.ed-tabs button.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.ed-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.ed-lib { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.ed-body > div[hidden] { display: none; }
.ed-here, .ed-sel, .ed-tools, .ed-hist { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; flex: 1 1 auto; }
.ed-note { font-size: 11px; color: var(--muted); padding: 4px 0; }
.ed-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--rule); padding: 4px 0; }
.ed-row.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.ed-row .ed-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-row .ed-meta { font-size: 10px; color: var(--muted); white-space: nowrap; }
.ed-row .ed-bad { font-size: 10px; color: var(--warn); }
.ed-panel button.ed-b { font: inherit; font-size: 10px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 2px 7px; cursor: pointer; }
.ed-panel button.ed-b:hover { color: var(--ink); border-color: var(--edge); }
.ed-panel button.ed-b.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.ed-row button.ed-del { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 50%, transparent); }
.ed-field { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.ed-field > span { flex: 0 0 96px; font-size: 10px; letter-spacing: 0.05em; color: var(--muted); }
.ed-field input { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 11px; color: var(--ink); background: var(--plate); border: 1px solid var(--rule); border-radius: 3px; padding: 2px 5px; }
.ed-field input[type=checkbox] { flex: 0 0 auto; }
.ed-field input[type=range] { padding: 0; }
.ed-field .ed-val { flex: 0 0 64px; font-size: 10px; color: var(--ink); text-align: right; }
.ed-field .ed-ro { flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-h { font-size: 10px; letter-spacing: 0.1em; color: var(--accent); margin-top: 6px; }
.ed-hist .ed-row { cursor: pointer; }
.ed-hist .ed-row.undone { color: var(--muted); }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = EDITOR_WINDOW_CSS;
  document.head.appendChild(style);
}

/** One permanent row standing near the camera, as the Here tab lists it. */
export interface HereRow {
  id: string;
  layer: string;
  label: string;
  away: string;
  stood: boolean;
  bad: string | null;
}

/** The first picked row as the Selected tab shows it. */
export interface SelectedView {
  count: number;
  id: string;
  label: string;
  file: string;
  model: string;
  template: string;
  /** The raw place (the file's own frame), its turn as yaw, pitch and roll in degrees (the game's frame), and its scale. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: string;
  clear: string;
  guard: string;
  solid: boolean;
  state: string;
  name: string;
  note: string;
  /** Its size (its box times its scale), its height over the ground, and what its stand set aside. */
  size: string;
  height: string;
  note2: string;
}

/** The sculpt brush as the Tools tab shows it (Map-maker II's first wave). */
export interface SculptToolsView {
  armed: boolean;
  mode: 'raise' | 'lower' | 'flatten' | 'smooth';
  /** Flatten's ways (both, raise only, lower only), where its height comes from, and the height. */
  flatMode: 'both' | 'raise' | 'lower';
  target: 'press' | 'sampled' | 'typed' | 'stamp';
  height: number;
  falloff: string;
  falloffs: string[];
  switches: { key: string; words: string; on: boolean }[];
  /** The heights file: how many tiles, how many bytes, git's word, and the walk grid's stale line. */
  file: string;
  note: string;
}

/** The paint brush as the Tools tab shows it (Map-maker II's second wave). */
export interface PaintToolsView {
  armed: boolean;
  layer: 'family' | 'colour';
  /** The palette's entries: their place, name, the alternate each forces, a picture, whether chosen, whether it lays here. */
  entries: { at: number; name: string; child: number | null; picture: string | null; chosen: boolean; lays: boolean }[];
  /** The world's families to choose from, each with its alternates' pictures. */
  families: { name: string; pictures: (string | null)[] }[];
  colour: string;
  /** The world row's switches: the plants following, the alternates, the border masks, the cloud shadows. */
  switches: { key: string; words: string; on: boolean }[];
  /** The colour map's tint mode in force and the modes; the opposite corners' rule. */
  tint: string;
  tints: string[];
  opposite: string;
  /** The chosen family's alternates' weights in this world (its own beside them), or null. */
  weights: { key: string; name: string; values: number[]; own: number[] } | null;
  /** A real-elevation world: its base family (`pack:name`, '' for none) and whether a wash is named. */
  dem: { base: string; wash: boolean } | null;
  file: string;
  note: string;
}

/** What the window needs of the editor beside the library's own. */
export interface EditorWindowHost extends LibraryHost {
  /** The rows standing round the camera, nearest first. */
  here(): HereRow[];
  goTo(id: string): void;
  pickUp(id: string): void;
  remove(id: string, layer: string): void;
  /** Whether a row is picked, and rows picked (Here's boxes): in place of what is picked, added, or taken away. */
  isPicked(id: string): boolean;
  pick(ids: string[], mode: 'set' | 'add' | 'take'): void;
  /** The first picked row, or null. */
  selected(): SelectedView | null;
  /** A field of the first picked row written (`setField`), its place, turn or scale (`setPlace`). */
  setField(fields: Record<string, unknown>): void;
  setPlace(p: Record<string, unknown>): void;
  /** The history: its actions' words, and how many are done; a click goes to any. */
  history(): { at: number; actions: string[] };
  historyTo(n: number): void;
  /**
   * The tools: snapping, the axes, game view, the world held, git's word; from the third wave the fold (how many rows stand
   * drawn one by one and what that costs, a fold under way, the automatic fold's switch) and the brush (armed, its entries
   * with their weights, its switches).
   */
  tools(): {
    snapOn: boolean;
    grid: number;
    angle: number;
    gridSteps: number[];
    angleSteps: number[];
    local: boolean;
    gameView: boolean;
    hold: boolean;
    files: string[];
    branch: string;
    fold?: { rows: number; ms: number; folded: number; folding: boolean; auto: boolean; hint: number };
    /** The Tools list (Map-maker II): every tool, its key and whether it is armed; a click arms one (any other let go) or lets it go. */
    list?: { id: string; label: string; key: string; armed: boolean }[];
    brush?: { armed: boolean; entries: { key: string; name: string; weight: number }[]; switches: { key: string; words: string; on: boolean }[] };
    /** The sculpt brush (Map-maker II's first wave): its mode, flatten's target and its ways, its switches and its file. */
    sculpt?: SculptToolsView;
    /** The paint brush (Map-maker II's second wave): its layer, its palette, the world's families, the world row. */
    paint?: PaintToolsView;
  };
  setTool(t: Record<string, unknown>): void;
  refreshStatus(): void;
  /** The editor's numbers of feel, as sliders. */
  dialSet(): DialSet;
}

type Tab = 'library' | 'selected' | 'here' | 'tools' | 'history';

/** The window. */
export class EditorWindow {
  readonly root: HTMLElement;
  readonly library: LibraryUi;
  private readonly host: EditorWindowHost;
  private readonly els: Record<Tab, HTMLElement>;
  private readonly modeEl: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'library';
  private pointMode = false;
  /** Here's last box clicked, for a Shift-click run. */
  private lastHere = -1;

  constructor(parent: HTMLElement, host: EditorWindowHost) {
    installStyle();
    this.host = host;
    const root = document.createElement('div');
    root.className = 'ed-panel fly';
    root.hidden = true;
    // Its size at its own layout, as custom properties the stylesheet reads: the window frame clears a sized window's
    // own width and height whenever it is put back at its own size, and never these.
    root.style.setProperty('--ed-w', `${EDITOR_TUNE.window.width}px`);
    root.style.setProperty('--ed-h', `${Math.round(EDITOR_TUNE.window.heightShare * 100)}vh`);
    root.innerHTML = '<div class="ed-head"><span class="ed-title">WORLD EDITOR</span><span class="ed-mode"></span></div><div class="ed-tabs"></div><div class="ed-body"><div class="ed-lib"></div><div class="ed-sel" hidden></div><div class="ed-here" hidden></div><div class="ed-tools" hidden></div><div class="ed-hist" hidden></div></div>';
    parent.appendChild(root);
    this.root = root;
    this.modeEl = root.querySelector<HTMLElement>('.ed-mode')!;
    const q = (c: string) => root.querySelector<HTMLElement>(c)!;
    this.els = { library: q('.ed-lib'), selected: q('.ed-sel'), here: q('.ed-here'), tools: q('.ed-tools'), history: q('.ed-hist') };
    const tabsEl = q('.ed-tabs');
    for (const [t, words] of [
      ['library', 'Library'],
      ['selected', 'Selected'],
      ['here', 'Here'],
      ['tools', 'Tools'],
      ['history', 'History'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = words;
      b.addEventListener('click', () => {
        this.setTab(t);
        b.blur();
      });
      tabsEl.appendChild(b);
      this.tabs.set(t, b);
    }
    this.library = new LibraryUi(this.els.library, host);
    this.els.here.addEventListener('click', (e) => this.hereClicked(e));
    this.els.history.addEventListener('click', (e) => this.historyClicked(e));
    draggable(root, '.ed-panel', '.ed-head', 'editor');
    this.setTab('library');
  }

  /** Shown with the editor, in the mode the mouse is in. */
  show(point: boolean): void {
    if (this.root.hidden) this.root.hidden = false;
    this.setPoint(point);
  }

  hide(): void {
    if (!this.root.hidden) this.root.hidden = true;
  }

  /** Clickable in Point mode only. */
  setPoint(point: boolean): void {
    if (point === this.pointMode && this.modeEl.textContent) return;
    this.pointMode = point;
    this.root.classList.toggle('fly', !point);
    this.modeEl.textContent = point ? 'POINT · Tab to fly' : 'FLY · Tab for a cursor';
  }

  setTab(t: Tab | 'library' | 'here'): void {
    this.tab = t;
    for (const [k, b] of this.tabs) b.classList.toggle('on', k === t);
    for (const k of Object.keys(this.els) as Tab[]) this.els[k].hidden = k !== t;
    this.drawTab();
  }

  /** The tab showing drawn again (a write landed, the selection changed, the camera moved far). */
  refreshHere(): void {
    if (!this.root.hidden && this.tab === 'here') this.drawHere();
  }

  /** Whatever the editing changed (the selection, a write, the history, git's word), drawn again where it shows. */
  refreshEdits(): void {
    if (this.root.hidden || this.tab === 'library') return;
    // A field being typed in is not drawn over under the hand.
    const active = document.activeElement as HTMLElement | null;
    if (active && this.root.contains(active) && active.tagName === 'INPUT') return;
    this.drawTab();
  }

  private drawTab(): void {
    if (this.tab === 'here') this.drawHere();
    else if (this.tab === 'selected') this.drawSelected();
    else if (this.tab === 'tools') this.drawTools();
    else if (this.tab === 'history') this.drawHistory();
  }

  private note(el: HTMLElement, words: string): void {
    const n = document.createElement('div');
    n.className = 'ed-note';
    n.textContent = words;
    el.appendChild(n);
  }

  private button(words: string, act: string, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ed-b${cls ? ` ${cls}` : ''}`;
    b.dataset.act = act;
    b.textContent = words;
    return b;
  }

  // ---- Here. ----

  private drawHere(): void {
    const rows = this.host.here();
    const el = this.els.here;
    el.replaceChildren();
    if (!rows.length) {
      this.note(el, 'nothing stands for good round here');
      return;
    }
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = `ed-row${this.host.isPicked(r.id) ? ' on' : ''}`;
      row.dataset.id = r.id;
      row.dataset.layer = r.layer;
      row.dataset.i = String(i);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.host.isPicked(r.id);
      box.dataset.act = 'pick';
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = r.label;
      label.title = r.id;
      const meta = document.createElement('span');
      meta.className = 'ed-meta';
      meta.textContent = `${r.layer} · ${r.away}`;
      row.append(box, label, meta);
      if (r.bad) {
        const bad = document.createElement('span');
        bad.className = 'ed-bad';
        bad.textContent = r.bad;
        row.appendChild(bad);
      }
      row.append(this.button('Go to', 'go'), this.button('Pick up', 'take'), this.button('Delete', 'del', 'ed-del'));
      if (!r.stood) (row.querySelector('[data-act="take"]') as HTMLButtonElement).disabled = true;
      el.appendChild(row);
    });
  }

  private hereClicked(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    const row = t?.closest<HTMLElement>('.ed-row');
    if (!t || !row) return;
    const id = row.dataset.id ?? '';
    const layer = row.dataset.layer ?? '';
    const act = t.dataset.act;
    if (act === 'pick') {
      // A box: this row picked or let go; with Shift every row from the last box clicked to this one.
      const i = Number(row.dataset.i);
      const on = (t as HTMLInputElement).checked;
      if (e.shiftKey && this.lastHere >= 0) {
        const lo = Math.min(this.lastHere, i);
        const hi = Math.max(this.lastHere, i);
        const ids = [...this.els.here.querySelectorAll<HTMLElement>('.ed-row')].filter((r) => {
          const k = Number(r.dataset.i);
          return k >= lo && k <= hi;
        }).map((r) => r.dataset.id ?? '');
        this.host.pick(ids, on ? 'add' : 'take');
      } else this.host.pick([id], on ? 'add' : 'take');
      this.lastHere = i;
      (t as HTMLInputElement).blur();
      this.drawHere();
      return;
    }
    const b = t.closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'go') this.host.goTo(id);
    else if (b.dataset.act === 'take') this.host.pickUp(id);
    else if (b.dataset.act === 'del') this.host.remove(id, layer);
  }

  // ---- Selected: the inspector. ----

  private field(el: HTMLElement, label: string, value: string | number | boolean, write: ((v: string, input: HTMLInputElement) => void) | null, kind: 'text' | 'number' | 'check' = 'text'): void {
    const f = document.createElement('label');
    f.className = 'ed-field';
    const s = document.createElement('span');
    s.textContent = label;
    f.appendChild(s);
    if (!write) {
      const ro = document.createElement('span');
      ro.className = 'ed-ro';
      ro.textContent = String(value);
      ro.title = String(value);
      f.appendChild(ro);
      el.appendChild(f);
      return;
    }
    const input = document.createElement('input');
    if (kind === 'check') {
      input.type = 'checkbox';
      input.checked = !!value;
    } else {
      input.type = kind === 'number' ? 'number' : 'text';
      if (kind === 'number') input.step = 'any';
      input.value = String(value);
    }
    // Written when it is left or Enter is pressed; the keyboard given back to the page either way.
    const commit = () => write(kind === 'check' ? String(input.checked) : input.value, input);
    if (kind === 'check') input.addEventListener('change', () => {
      commit();
      input.blur();
    });
    else {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') input.blur();
      });
    }
    f.appendChild(input);
    el.appendChild(f);
  }

  private drawSelected(): void {
    const el = this.els.selected;
    el.replaceChildren();
    const s = this.host.selected();
    if (!s) {
      this.note(el, 'nothing picked: click a row of the files (Shift adds), draw a box in Point mode, or tick rows on the Here tab');
      return;
    }
    if (s.count > 1) this.note(el, `${s.count} picked: the first is shown; its place, turn and scale are written for it alone, and what it is (clear, guard, solid, state, name, note) for every picked row alike (the keys and the gizmo move them all)`);
    const num = (v: string): number | null => {
      const n = Number(v);
      return v.trim() !== '' && Number.isFinite(n) ? n : null;
    };
    this.field(el, 'Name', s.label, null);
    this.field(el, 'Id', s.id, null);
    this.field(el, 'File', s.file, null);
    this.field(el, 'Model', s.model, null);
    if (s.template) this.field(el, 'Template', s.template, null);
    const h = document.createElement('div');
    h.className = 'ed-h';
    h.textContent = 'WHERE (THE FILE\'S FRAME)';
    el.appendChild(h);
    for (const k of ['x', 'y', 'z'] as const) {
      this.field(el, k.toUpperCase(), s[k], (v) => {
        const n = num(v);
        if (n !== null) this.host.setPlace({ [k]: n });
      }, 'number');
    }
    for (const k of ['yaw', 'pitch', 'roll'] as const) {
      this.field(el, `${k[0].toUpperCase()}${k.slice(1)} °`, Math.round(s[k] * 100) / 100, (v) => {
        const n = num(v);
        if (n !== null) this.host.setPlace({ yaw: s.yaw, pitch: s.pitch, roll: s.roll, [k]: n });
      }, 'number');
    }
    this.field(el, 'Scale', s.scale, (v) => {
      const parts = v.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length === 1 && parts[0] > 0) this.host.setPlace({ scale: parts[0] });
      else if (parts.length === 3 && parts.every((p) => p > 0)) this.host.setPlace({ scale: parts });
    });
    const h2 = document.createElement('div');
    h2.className = 'ed-h';
    h2.textContent = 'WHAT IT IS';
    el.appendChild(h2);
    this.field(el, 'Flora clear m', s.clear, (v) => this.host.setField({ clear: v.trim() === '' ? null : num(v) }), 'number');
    this.field(el, 'Guard m', s.guard, (v) => this.host.setField({ guard: v.trim() === '' ? null : num(v) }), 'number');
    this.field(el, 'Solid', s.solid, (v) => this.host.setField({ solid: v === 'true' }), 'check');
    this.field(el, 'State', s.state, (v) => this.host.setField({ state: v.trim() || null }));
    this.field(el, 'Its name', s.name, (v) => this.host.setField({ name: v.trim() || null }));
    this.field(el, 'Note', s.note, (v) => this.host.setField({ note: v.trim() || null }));
    this.field(el, 'Size', s.size, null);
    this.field(el, 'Over the ground', s.height, null);
    if (s.note2) this.field(el, 'Set aside', s.note2, null);
  }

  // ---- Tools. ----

  private drawTools(): void {
    const el = this.els.tools;
    el.replaceChildren();
    const t = this.host.tools();
    const h = (words: string) => {
      const d = document.createElement('div');
      d.className = 'ed-h';
      d.textContent = words;
      el.appendChild(d);
    };
    const row = (...items: HTMLElement[]) => {
      const r = document.createElement('div');
      r.className = 'ed-row';
      r.append(...items);
      el.appendChild(r);
      return r;
    };
    const toggle = (words: string, on: boolean, set: Record<string, unknown>) => {
      const b = this.button(words, 'tool', on ? 'on' : '');
      b.addEventListener('click', () => {
        this.host.setTool(set);
        b.blur();
        this.drawTools();
      });
      return b;
    };
    // The Tools list (Map-maker II's groundwork): one armed at a time; a click arms one, any other let go first.
    if (t.list?.length) {
      h('TOOLS');
      row(...t.list.map((x) => toggle(`${x.label[0].toUpperCase()}${x.label.slice(1)}${x.key ? ` (${x.key})` : ''}${x.armed ? ': armed' : ''}`, x.armed, { tool: x.id })));
      this.note(el, 'One tool is armed at a time: its buttons are its own, the selection takes no hold meanwhile, and Escape lets it go.');
    }
    // The sculpt brush (Map-maker II's first wave): its mode, flatten's target and ways, its falloff and its switches.
    if (t.sculpt) {
      const s = t.sculpt;
      h('SHAPING THE GROUND');
      row(...(['raise', 'lower', 'flatten', 'smooth'] as const).map((m) => toggle(m[0].toUpperCase() + m.slice(1), s.mode === m, { sculptMode: m })));
      if (s.mode === 'flatten') {
        row(...(['both', 'raise', 'lower'] as const).map((m) => toggle(m === 'both' ? 'Both ways' : m === 'raise' ? 'Raise only' : 'Lower only', s.flatMode === m, { sculptFlat: m })));
        row(...(['press', 'sampled', 'typed', 'stamp'] as const).map((m) => toggle(m === 'press' ? 'Height at the press' : m === 'sampled' ? 'Sampled (Shift+click)' : m === 'typed' ? 'Typed' : 'Every stamp', s.target === m, { sculptTarget: m })));
        const f = document.createElement('label');
        f.className = 'ed-field';
        const sp = document.createElement('span');
        sp.textContent = 'Height m';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(Math.round(s.height * 1000) / 1000);
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (input.value.trim() !== '' && Number.isFinite(n)) this.host.setTool({ sculptHeight: n });
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') input.blur();
        });
        f.append(sp, input);
        el.appendChild(f);
      }
      row(...s.falloffs.map((name) => toggle(name, s.falloff === name, { sculptFalloff: name })));
      row(...s.switches.map((x) => toggle(x.words, x.on, { sculptSwitch: [x.key, !x.on] })));
      this.note(el, s.file);
      if (s.note) this.note(el, s.note);
      this.note(el, 'K arms it: LMB held raises (or flattens, or smooths), RMB held lowers; C held with the wheel sizes it; Shift+click samples the height under it; a stroke is one undo. Its numbers are the sliders under The sculpt brush below.');
    }
    // The paint brush (Map-maker II's second wave): its layer, its palette as the ground's own pictures, the world's families
    // with their alternates, its colour, and the world row's switches and weights (each written into the paint file).
    if (t.paint) {
      const p = t.paint;
      h('PAINTING THE GROUND');
      row(...(['family', 'colour'] as const).map((m) => toggle(m === 'family' ? 'Families' : 'Colour', p.layer === m, { paintLayer: m })));
      const pic = (src: string | null, title: string, on: boolean, set: Record<string, unknown>) => {
        const b = this.button('', 'tool', on ? 'on' : '');
        b.title = title;
        if (src) {
          const img = document.createElement('img');
          img.src = src;
          img.width = 36;
          img.height = 36;
          img.alt = title;
          img.loading = 'lazy';
          b.appendChild(img);
        } else b.textContent = title.slice(0, 10);
        b.addEventListener('click', () => {
          this.host.setTool(set);
          b.blur();
          this.drawTools();
        });
        return b;
      };
      if (p.entries.length) {
        this.note(el, 'The palette (a click chooses what LMB paints):');
        const r = row();
        r.style.flexWrap = 'wrap';
        for (const e of p.entries) r.appendChild(pic(e.picture, `${e.at}: ${e.name}${e.child !== null ? ` (alternate ${e.child})` : ''}${e.lays ? '' : ' (lays nothing here)'}`, e.chosen, { paintEntry: e.at }));
      } else this.note(el, 'The palette is empty: choose a family below, or press the middle button on the ground.');
      if (p.families.length) {
        this.note(el, "The world's families (a click adds one to the palette and chooses it; a small picture forces that alternate):");
        for (const f of p.families) {
          const r = row();
          r.style.flexWrap = 'wrap';
          const label = document.createElement('span');
          label.className = 'ed-label';
          label.textContent = f.name;
          r.appendChild(label);
          r.appendChild(pic(f.pictures[0] ?? null, `${f.name}: the pole's own alternate`, false, { paintAdd: { name: f.name } }));
          if (f.pictures.length > 1) f.pictures.forEach((src, i) => r.appendChild(pic(src, `${f.name}: alternate ${i}`, false, { paintAdd: { name: f.name, child: i } })));
        }
      }
      const cf = document.createElement('label');
      cf.className = 'ed-field';
      const cs = document.createElement('span');
      cs.textContent = 'Colour';
      const ci = document.createElement('input');
      ci.type = 'color';
      ci.value = p.colour;
      ci.addEventListener('change', () => {
        this.host.setTool({ paintColour: ci.value });
        ci.blur();
      });
      cf.append(cs, ci);
      el.appendChild(cf);
      h('THE WORLD ROW');
      row(...p.switches.map((s) => toggle(s.words, s.on, { paintWorld: { [s.key]: !s.on } })));
      row(...p.tints.map((m) => toggle(`Tint ${m}`, p.tint === m, { paintWorld: { tint: m } })));
      row(...(['max', 'add'] as const).map((m) => toggle(`Opposite corners ${m}`, p.opposite === m, { paintWorld: { opposite: m } })));
      if (p.weights) {
        const wt = p.weights;
        this.note(el, `${wt.name}'s alternates' weights in this world (its own: ${wt.own.join(', ')}):`);
        const r = row();
        wt.values.forEach((v, i) => {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = 'any';
          input.min = '0';
          input.value = String(v);
          input.title = `alternate ${i}`;
          input.style.width = '56px';
          input.addEventListener('change', () => {
            const list = [...wt.values];
            const n = Number(input.value);
            if (!Number.isFinite(n) || n < 0) return;
            list[i] = n;
            this.host.setTool({ paintWeight: [wt.key, list] });
            input.blur();
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') input.blur();
          });
          r.appendChild(input);
        });
      }
      if (p.dem) {
        this.note(el, `Base family: ${p.dem.base || 'none (the console names one: groundPaint({ world: { base: { pack, name } } }))'}.`);
        row(toggle(p.dem.wash ? 'Take the wash away' : 'Name a wash', p.dem.wash, { paintWorld: { wash: p.dem.wash ? null : { base: [150, 130, 110] } } }));
        if (p.dem.wash) this.note(el, "The wash's numbers are the sliders under The wash below.");
      }
      this.note(el, p.file);
      if (p.note) this.note(el, p.note);
      this.note(el, 'U arms it: LMB held paints, RMB held erases; Shift+click or the middle button takes what is under it; C held with the wheel sizes it; a stroke is one undo. Its numbers are the sliders under The paint brush below.');
    }
    h('SNAPPING');
    row(toggle(t.snapOn ? 'Snapping on' : 'Snapping off', t.snapOn, { snapOn: !t.snapOn }));
    row(...t.gridSteps.map((g) => toggle(`${g} m`, t.grid === g, { grid: g })));
    row(...t.angleSteps.map((a) => toggle(`${a}°`, t.angle === a, { angle: a })));
    h('VIEW');
    row(toggle(t.local ? 'Local axes' : 'World axes', t.local, { local: !t.local }), toggle('Game view', t.gameView, { gameView: !t.gameView }), toggle('Hold the world', t.hold, { hold: !t.hold }));
    // Folding (the third wave's): the rows drawn one by one, and the short loading screen that folds them.
    if (t.fold) {
      const f = t.fold;
      h('FOLDING');
      this.note(el, f.folding ? 'folding…' : `${f.rows} row${f.rows === 1 ? '' : 's'} drawn one by one (about ${f.ms.toFixed(1)} ms a frame by the measured rate) · ${f.folded} folded into their tiers`);
      row(toggle('Fold now', false, { fold: true }), toggle(f.auto ? 'Automatic fold on' : 'Automatic fold off', f.auto, { autoFold: !f.auto }));
      this.note(el, `Every arrival folds the rows by itself; Fold now does it here behind a short loading screen.${f.auto ? ` The automatic fold waits for a quiet moment with more than ${f.hint} drawn one by one.` : ''}`);
    }
    // The brush (the third wave's): armed or not, its entries (Shift+click them in the library) with their weights, its switches.
    if (t.brush) {
      const b = t.brush;
      h('THE BRUSH');
      row(toggle(b.armed ? 'Armed (B)' : 'Arm (B)', b.armed, { brushArm: !b.armed }));
      if (!b.entries.length) this.note(el, 'no entries: Shift+click things in the library (or arm it with a thing in hand)');
      for (const e of b.entries) {
        const r = document.createElement('div');
        r.className = 'ed-row';
        const label = document.createElement('span');
        label.className = 'ed-label';
        label.textContent = e.name;
        label.title = e.key;
        const w = document.createElement('input');
        w.type = 'number';
        w.step = 'any';
        w.min = '0';
        w.value = String(e.weight);
        w.title = 'its weight among the rest';
        w.style.width = '56px';
        w.addEventListener('change', () => {
          const n = Number(w.value);
          if (Number.isFinite(n) && n >= 0) this.host.setTool({ brushWeight: [e.key, n] });
          w.blur();
        });
        w.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === 'Escape') w.blur();
        });
        const out = this.button('Let go', 'tool');
        out.addEventListener('click', () => {
          this.host.setTool({ brushRemove: e.key });
          out.blur();
          this.drawTools();
        });
        r.append(label, w, out);
        el.appendChild(r);
      }
      row(...b.switches.map((s) => toggle(s.words, s.on, { brushSwitch: [s.key, !s.on] })));
      this.note(el, 'LMB held paints toward the density, counting what of its own stands; RMB held erases; a stroke is one undo. Its numbers are the sliders under The brush below.');
    }
    h('FILES');
    const files = document.createElement('div');
    files.className = 'ed-note';
    files.textContent = t.files.length ? `${t.branch ? `on ${t.branch}: ` : ''}${t.files.join(' · ')}` : 'not asked yet';
    el.appendChild(files);
    const refresh = this.button('Refresh', 'status');
    refresh.addEventListener('click', () => {
      this.host.refreshStatus();
      refresh.blur();
    });
    row(refresh);
    this.note(el, 'Rows reach players once their file is committed and merged to main; the editor never commits.');
    // The editor's numbers of feel, as sliders: each set through `__debug.editor({ tune })`'s own setter.
    for (const g of this.host.dialSet().groups) {
      h(g.title.toUpperCase());
      for (const d of g.dials) {
        if (d.kind !== 'number') continue;
        el.appendChild(this.slider(d));
      }
    }
  }

  private slider(d: NumberDial): HTMLElement {
    const f = document.createElement('label');
    f.className = 'ed-field';
    f.title = d.note ?? '';
    const s = document.createElement('span');
    s.textContent = d.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(d.min);
    input.max = String(d.max);
    input.step = String(d.step);
    input.value = String(d.get());
    const val = document.createElement('span');
    val.className = 'ed-val';
    val.textContent = `${d.get()} ${d.unit ?? ''}`;
    input.addEventListener('input', () => {
      d.set(Number(input.value));
      val.textContent = `${d.get()} ${d.unit ?? ''}`;
    });
    input.addEventListener('change', () => input.blur());
    f.append(s, input, val);
    return f;
  }

  // ---- History. ----

  private drawHistory(): void {
    const el = this.els.history;
    el.replaceChildren();
    const hst = this.host.history();
    if (!hst.actions.length) {
      this.note(el, "nothing done on this world this session: every action is one entry, and a click goes back or forward to it");
      return;
    }
    const start = document.createElement('div');
    start.className = `ed-row${hst.at === 0 ? ' on' : ''}`;
    start.dataset.n = '0';
    start.textContent = 'before any of it';
    el.appendChild(start);
    hst.actions.forEach((words, i) => {
      const r = document.createElement('div');
      r.className = `ed-row${i + 1 === hst.at ? ' on' : ''}${i + 1 > hst.at ? ' undone' : ''}`;
      r.dataset.n = String(i + 1);
      r.textContent = `${i + 1}. ${words}`;
      el.appendChild(r);
    });
  }

  private historyClicked(e: MouseEvent): void {
    const r = (e.target as HTMLElement | null)?.closest<HTMLElement>('.ed-row');
    if (!r || r.dataset.n === undefined) return;
    this.host.historyTo(Number(r.dataset.n));
  }

  dispose(): void {
    this.library.dispose();
    this.root.remove();
  }
}
