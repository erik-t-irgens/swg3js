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
import { DyePicker, hexOf, rawFromHex, type PickerRow, type PickerSource } from './dyePicker.ts';
import { isRawColour, rawRgb } from '../player/texrender.ts';

const EDITOR_WINDOW_CSS = `
.ed-panel { position: fixed; left: 12px; top: 64px; width: var(--ed-w, 560px); height: var(--ed-h, 78vh); max-height: calc(100vh - 80px); display: flex; flex-direction: column; gap: 8px; background: var(--panel); border: 1px solid var(--panel-border); border-radius: 4px; padding: 8px 10px 10px; color: var(--ink); font-size: 12px; box-sizing: border-box; }
.ed-panel[hidden] { display: none; }
.ed-swatch { width: 24px; height: 24px; flex: none; border: 1px solid var(--panel-border); border-radius: 2px; }
/* While the minimap shows, the window docks under the display's top-left block rather than over the circle, at the very
   place the help block stands by (hud.css: 12 and 212 on the HUD scale, the block's own sum), with a gap of 8; the minimap's
   own layout is never touched, and a window moved or sized by hand stands where it was put. */
#hud.minimap-on ~ .ed-panel { top: calc(20px + 212px * var(--hud-scale)); max-height: calc(100vh - 36px - 212px * var(--hud-scale)); }
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
.ed-row select { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 11px; color: var(--ink); background: var(--plate); border: 1px solid var(--rule); border-radius: 3px; padding: 2px 5px; }
.ed-row select option { color: var(--ink); background: var(--plate); }
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
  /** Map-maker II's seventh wave: whether it is a mark (attachments and no model). */
  mark?: boolean;
  /**
   * Its model's materials, each name once, with the look each wears in words, its tint (`#rrggbb` or ''), a little picture of
   * it and why a look would not go on it ('' for nothing); null where its model is not loaded or it is a mark.
   */
  materials?: { name: string; look: string; tint: string; picture: HTMLCanvasElement | null }[] | null;
  /** The look picker armed, in words ('' for not). */
  picking?: string;
  /** A library entry's materials offered while the picker is armed: a click on one takes its picture or material. */
  offered?: { entry: string; materials: { name: string; ref: string; map: boolean }[] } | null;
  /** Its attachments: each one's kind and what it names, its place in its model's frame, an effect's size, whether picked. */
  attachments?: { i: number; words: string; at: string; size: string; picked: boolean }[];
}

/** A colour's look: the tint picker's palettes (the wardrobe's garments and the creator's table), read once. */
export type LookPickerSource = PickerSource;

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

/**
 * The paint brush's plants layer as the Tools tab shows it (Map-maker II's fourth wave): the recipes (a click chooses one),
 * the recipe being built (what it does to each class, the family an add or a remove names among the class's own), and
 * how the plants layer goes with the families' `follow`.
 */
export interface PlantsToolsView {
  recipes: { at: number; words: string; chosen: boolean; paints: boolean }[];
  /** The draft, a class at a time: its op, the family named, and the class's families to choose from. */
  draft: { cls: string; label: string; op: string; family: string; families: string[] }[];
  roads: boolean;
  note: string;
}

/** The paint brush as the Tools tab shows it (Map-maker II's second wave). */
export interface PaintToolsView {
  armed: boolean;
  layer: 'family' | 'colour' | 'plants';
  /** The plants layer (the fourth wave), or null where the world has no flora tables to paint from. */
  plants: PlantsToolsView | null;
  /** The palette's entries: their place, name, the alternate each forces, a picture, whether chosen, whether it lays here. */
  entries: { at: number; name: string; child: number | null; picture: string | null; chosen: boolean; lays: boolean }[];
  /**
   * The families to choose from, each with its alternates' pictures: this world's own, or (Map-maker II's third wave) the
   * browsed pack's, each saying whether it is lent this world's ground already.
   */
  families: { pack: string; name: string; pictures: (string | null)[]; lent: boolean }[];
  /** The installed worlds whose families the list can show (this world's first), the one it shows marked. */
  packs: { id: string; words: string; on: boolean }[];
  /** What the list says of the browsed pack (being read, why not, how lending goes), or ''. */
  browseNote: string;
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

/** The water tool as the Tools tab shows it (Map-maker II's fifth wave). */
export interface WaterToolsView {
  armed: boolean;
  mode: 'clicks' | 'trace' | 'fall' | 'river';
  levelFrom: 'lowest' | 'first' | 'typed';
  height: number;
  /** Where a river's points stand (the sixth wave): each on its ground, or never higher than the one before. */
  riverHeights: 'ground' | 'level';
  /** What a river's reach past its slope limit is (`RIVER_TUNE.steep`). */
  steep: 'effects' | 'fall' | 'refuse';
  /** Points in the clicked outline (or river) under way, whether a fall's top is set, the lake or river picked. */
  draft: number;
  fallTop: boolean;
  picked: string | null;
  /** The world's lakes and rivers of ours and the file in words, and what the tool says of itself. */
  lakes: number;
  rivers: number;
  file: string;
  note: string;
}

/** A lake of ours picked, as the Selected tab shows it (Map-maker II's fifth wave): its fields, and its look's own numbers ('' for its shader's). */
export interface LakeView {
  id: string;
  name: string;
  h: number;
  points: number;
  area: string;
  shader: string;
  color: string;
  opacity: string;
  ripple: string;
  drift: string;
  /** Lava, drawn, what stands under it, in words. */
  note: string;
  /** A river's own fields (the sixth wave), absent on a lake: its width, velocity and slope limit ('' for the tune's), its length and its steep reaches in words. */
  river?: { width: string; velocity: string; fallFrom: string; length: string; steep: string };
}

/**
 * A place of ours picked, as the Selected tab shows it (Map-maker II's eighth wave): its words, its kind and shape, whether it
 * is drawn, said and built in (and whether each is its own or its kind's), its loading lines (one a line) and its story area.
 */
export interface PlaceView {
  id: string;
  name: string;
  kind: string;
  shape: string;
  map: boolean;
  say: boolean;
  build: boolean;
  own: { map: boolean; say: boolean; build: boolean };
  desc: string;
  note: string;
  loading: string;
  state: string;
  snippet: string;
  words: string;
}

/** The places tool as the Tools tab shows it (Map-maker II's eighth wave). */
export interface PlacesToolsView {
  armed: boolean;
  mode: 'circle' | 'rect' | 'outline';
  kind: string;
  radius: number;
  /** Points in the outline under way, the place picked. */
  draft: number;
  picked: string | null;
  /** The world row: the game's own cities kept clear of players' building, and its loading lines (one a line). */
  cities: boolean;
  worldLoading: string;
  file: string;
  note: string;
}

/** What the window needs of the editor beside the library's own. */
export interface EditorWindowHost extends LibraryHost {
  /** The place of ours the places tool has picked, or null (Map-maker II's eighth wave); its fields written (`copy` copies its story area). */
  place?(): PlaceView | null;
  setPlaceRow?(fields: Record<string, unknown>): void;
  /** The lake of ours the water tool has picked, or null (Map-maker II's fifth wave); its fields written. */
  lake?(): LakeView | null;
  setLake?(fields: Record<string, unknown>): void;
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
    /** The water tool (Map-maker II's fifth wave): its mode, where a lake's level comes from, the draft and the lake picked. */
    water?: WaterToolsView;
    /** The places tool (Map-maker II's eighth wave): what a click draws, the kind written, the world row's switch and lines. */
    places?: PlacesToolsView;
    /** The seventh wave's effects and sounds: whether one put down hangs on the row the aim meets (else it stands a mark). */
    attach?: { onto: boolean };
  };
  setTool(t: Record<string, unknown>): void;
  refreshStatus(): void;
  /** The editor's numbers of feel, as sliders. */
  dialSet(): DialSet;
  /**
   * The seventh wave's looks on the picked rows: a material's tint set (`#rrggbb`, '' takes it off), the picker armed to
   * take a picture or a material from what is clicked next, one offered material chosen, or a material's look cleared.
   */
  look?(act: 'tint' | 'texture' | 'material' | 'clear' | 'choose', of: string, value?: string): void;
  /** The tint picker's palettes, read once (null: none to offer). */
  lookPalettes?(): Promise<LookPickerSource | null>;
  /** One attachment of the first picked row picked by its handle, moved (`x y z` in its model's frame), sized or taken off. */
  attachment?(act: 'pick' | 'at' | 'size' | 'remove', i: number, value?: string): void;
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
    // A place of ours the places tool has picked (Map-maker II's eighth wave): its words, kind and switches, its loading
    // lines and its story area, each written as it is left (one undo each).
    const place = this.host.place?.() ?? null;
    if (place && this.host.setPlaceRow) {
      const set = this.host.setPlaceRow.bind(this.host);
      this.field(el, 'Place', place.id, null);
      this.field(el, 'Its name', place.name, (v) => set({ name: v.trim() || null }));
      const kf = document.createElement('label');
      kf.className = 'ed-field';
      const ks = document.createElement('span');
      ks.textContent = 'Kind';
      const sel = document.createElement('select');
      for (const k of ['city', 'place', 'landmark', 'area', 'zone']) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = k;
        if (k === place.kind) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        set({ kind: sel.value });
        sel.blur();
      });
      kf.append(ks, sel);
      el.appendChild(kf);
      this.field(el, 'Shape', place.shape, null);
      if (place.state) this.field(el, 'State', place.state, null);
      const sw = (label: string, key: 'map' | 'say' | 'build', on: boolean, own: boolean): void => {
        this.field(el, `${label}${own ? '' : " (its kind's)"}`, on, (v) => set({ [key]: v === 'true' }), 'check');
        if (own) {
          const b = this.button(`${label}: its kind's again`, 'place');
          b.addEventListener('click', () => {
            set({ [key]: null });
            b.blur();
          });
          el.appendChild(b);
        }
      };
      sw('Drawn on the maps', 'map', place.map, place.own.map);
      sw('Name said walking in', 'say', place.say, place.own.say);
      sw('Players may build', 'build', place.build, place.own.build);
      this.field(el, 'Tooltip', place.desc, (v) => set({ desc: v.trim() || null }));
      this.field(el, 'Note (never shown)', place.note, (v) => set({ note: v.trim() || null }));
      const lf = document.createElement('label');
      lf.className = 'ed-field';
      const ls = document.createElement('span');
      ls.textContent = 'Loading lines (one a line)';
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = place.loading;
      ta.addEventListener('change', () => set({ loading: ta.value.split('\n') }));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') ta.blur();
      });
      lf.append(ls, ta);
      el.appendChild(lf);
      if (place.words) this.note(el, place.words);
      const h3 = document.createElement('div');
      h3.className = 'ed-h';
      h3.textContent = 'AS A STORY AREA';
      el.appendChild(h3);
      const pre = document.createElement('pre');
      pre.className = 'ed-note';
      pre.textContent = place.snippet;
      el.appendChild(pre);
      const copy = this.button('Copy it', 'place');
      copy.addEventListener('click', () => {
        set({ copy: true });
        copy.blur();
      });
      el.appendChild(copy);
      this.note(el, 'Drag its square to move it, C held with the wheel sizes it, Delete takes it out; Escape lets it go.');
      return;
    }
    // A lake of ours the water tool has picked (Map-maker II's fifth wave): its name, its shader and its look's own numbers,
    // each written as it is left; an empty look field takes that number back to its shader's (or the planet's) own.
    const lake = this.host.lake?.() ?? null;
    if (lake && this.host.setLake) {
      const set = this.host.setLake.bind(this.host);
      const r = lake.river;
      this.field(el, r ? 'River' : 'Lake', lake.id, null);
      this.field(el, 'Its name', lake.name, (v) => set({ name: v.trim() || null }));
      if (r) {
        // A river (the sixth wave): its width, velocity and slope limit written as each is left ('' takes the limit back to the tune's).
        this.field(el, 'Middle m', lake.h, null);
        this.field(el, 'Points', `${lake.points} · ${r.length}`, null);
        const num = (label: string, value: string, key: 'width' | 'velocity' | 'fallFrom'): void =>
          this.field(el, label, value, (v) => {
            const n = Number(v);
            if (key === 'fallFrom' && v.trim() === '') set({ fallFrom: null });
            else if (v.trim() !== '' && Number.isFinite(n)) set({ [key]: n });
          });
        num('Width m', r.width, 'width');
        num('Velocity m/s', r.velocity, 'velocity');
        num('A fall past °', r.fallFrom, 'fallFrom');
        if (r.steep) this.note(el, r.steep);
      } else {
        this.field(el, 'Level m', lake.h, null);
        this.field(el, 'Points', `${lake.points} · ${lake.area}`, null);
      }
      this.field(el, 'Shader', lake.shader, (v) => set({ shader: v.trim() || null }));
      const h3 = document.createElement('div');
      h3.className = 'ed-h';
      h3.textContent = "ITS LOOK (EMPTY: ITS SHADER'S OWN)";
      el.appendChild(h3);
      this.field(el, 'Colour #rrggbb', lake.color, (v) => set({ look: { color: v.trim() || null } }));
      for (const [k, words] of [['opacity', 'Opacity 0-1'], ['ripple', 'Ripple 0-8'], ['drift', 'Drift 0-8']] as const) {
        this.field(el, words, lake[k], (v) => {
          const n = Number(v);
          set({ look: { [k]: v.trim() === '' ? null : Number.isFinite(n) ? n : v } });
        });
      }
      if (lake.note) this.note(el, lake.note);
      this.note(el, 'Drag its square to move it, hold F with the mouse (or the wheel) to raise it, Delete takes it out; Escape lets it go.');
      return;
    }
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
    // A mark (the seventh wave) is no thing: no size, no flora clearing, no guard and never solid (its effects are sized on
    // their own handles).
    if (!s.mark) {
      this.field(el, 'Scale', s.scale, (v) => {
        const parts = v.split(/[\s,]+/).filter(Boolean).map(Number);
        if (parts.length === 1 && parts[0] > 0) this.host.setPlace({ scale: parts[0] });
        else if (parts.length === 3 && parts.every((p) => p > 0)) this.host.setPlace({ scale: parts });
      });
    }
    const h2 = document.createElement('div');
    h2.className = 'ed-h';
    h2.textContent = 'WHAT IT IS';
    el.appendChild(h2);
    if (!s.mark) {
      this.field(el, 'Flora clear m', s.clear, (v) => this.host.setField({ clear: v.trim() === '' ? null : num(v) }), 'number');
      this.field(el, 'Guard m', s.guard, (v) => this.host.setField({ guard: v.trim() === '' ? null : num(v) }), 'number');
      this.field(el, 'Solid', s.solid, (v) => this.host.setField({ solid: v === 'true' }), 'check');
    }
    this.field(el, 'State', s.state, (v) => this.host.setField({ state: v.trim() || null }));
    this.field(el, 'Its name', s.name, (v) => this.host.setField({ name: v.trim() || null }));
    this.field(el, 'Note', s.note, (v) => this.host.setField({ note: v.trim() || null }));
    this.field(el, 'Size', s.size, null);
    this.field(el, 'Over the ground', s.height, null);
    if (s.note2) this.field(el, 'Set aside', s.note2, null);
    this.drawLooks(el, s);
    this.drawAttachments(el, s);
  }

  /** The material whose tint picker is open (drawn again with the tab), '' for none. */
  private tintOpen = '';
  private tintPicker: DyePicker | null = null;
  private lookSource: Promise<LookPickerSource | null> | null = null;

  /**
   * The seventh wave's looks on the Selected tab: the first picked row's materials, each with a little picture, its look in
   * words and its buttons (Tint opens the dye picker under it, Picture from… and Material from… arm the picker, Clear takes
   * its look off), every one written on every picked row; and while the picker is armed, a library entry's materials offered.
   */
  private drawLooks(el: HTMLElement, s: SelectedView): void {
    const look = this.host.look?.bind(this.host);
    if (!look) return;
    this.tintPicker?.close();
    this.tintPicker = null;
    if (s.mark) {
      this.note(el, 'A mark: an effect or a sound of its own, with no model. Click its handle to pick it; it moves with the gizmo, R and F held, and the arrows.');
      return;
    }
    const h = document.createElement('div');
    h.className = 'ed-h';
    h.textContent = 'ITS LOOK (EVERY PICKED ROW)';
    el.appendChild(h);
    if (s.picking) this.note(el, s.picking);
    if (s.offered) {
      this.note(el, `${s.offered.entry}'s materials: a click takes one`);
      const r = document.createElement('div');
      r.className = 'ed-row';
      r.style.flexWrap = 'wrap';
      for (const m of s.offered.materials) {
        const b = this.button(m.name + (m.map ? '' : ' (no picture)'), 'tool');
        b.title = m.ref;
        b.addEventListener('click', () => {
          b.blur();
          look('choose', '', m.ref);
        });
        r.appendChild(b);
      }
      el.appendChild(r);
    }
    if (!s.materials) {
      this.note(el, 'its model is not loaded yet: aim at it, or come nearer');
      return;
    }
    const lines: { name: string; row: HTMLElement; tint: string }[] = [];
    for (const m of [{ name: '*', look: '', tint: '', picture: null as HTMLCanvasElement | null }, ...s.materials]) {
      const r = document.createElement('div');
      r.className = 'ed-row';
      r.style.flexWrap = 'wrap';
      if (m.picture) {
        m.picture.className = 'ed-swatch';
        r.appendChild(m.picture);
      }
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = m.name === '*' ? 'every material' : m.name;
      label.title = m.name;
      r.appendChild(label);
      if (m.look) {
        const meta = document.createElement('span');
        meta.className = 'ed-meta';
        meta.textContent = m.look;
        r.appendChild(meta);
      }
      const act = (words: string, a: 'tint' | 'texture' | 'material' | 'clear') => {
        const b = this.button(words, 'tool', a === 'tint' && this.tintOpen === m.name ? 'on' : '');
        b.addEventListener('click', () => {
          b.blur();
          if (a === 'tint') {
            this.tintOpen = this.tintOpen === m.name ? '' : m.name;
            this.drawSelected();
          } else look(a, m.name);
        });
        return b;
      };
      r.append(act('Tint', 'tint'), act('Picture from…', 'texture'), act('Material from…', 'material'), act('Clear', 'clear'));
      el.appendChild(r);
      lines.push({ name: m.name, row: r, tint: m.tint });
    }
    const open = lines.find((l) => l.name === this.tintOpen);
    if (open) void this.openTint(open.row, open.name, open.tint);
    else this.tintOpen = '';
  }

  /** The dye picker under a material's row: its colours from the wardrobe and the creator, a pick written as the material's tint. */
  private async openTint(after: HTMLElement, of: string, tint: string): Promise<void> {
    const look = this.host.look?.bind(this.host);
    if (!look || !this.host.lookPalettes) return;
    this.lookSource ??= this.host.lookPalettes().catch(() => null);
    const source = await this.lookSource;
    if (!source || this.tintOpen !== of || !after.isConnected) return;
    let now = rawFromHex(tint) ?? 0;
    const row: PickerRow = {
      label: of,
      kind: 'dye',
      colors: [],
      layout: { creation: 0, columns: 8, more: 0, moreColumns: 8 },
      defaultValue: 0,
      current: () => now,
      pick: (v) => {
        now = v;
        look('tint', of, isRawColour(v) ? hexOf(rawRgb(v)) : '');
      },
    };
    const p = new DyePicker(row, source);
    p.onClose = () => {
      this.tintOpen = '';
      p.close();
      this.tintPicker = null;
    };
    this.tintPicker?.close();
    this.tintPicker = p;
    p.mount(after);
  }

  /** The seventh wave's attachments on the Selected tab: each one's kind, its place and size as fields, Pick and Remove. */
  private drawAttachments(el: HTMLElement, s: SelectedView): void {
    const at = this.host.attachment?.bind(this.host);
    if (!at || !s.attachments) return;
    const h = document.createElement('div');
    h.className = 'ed-h';
    h.textContent = 'WHAT HANGS ON IT';
    el.appendChild(h);
    if (!s.attachments.length) {
      this.note(el, 'nothing: take an effect or a sound from the library and click on it');
      return;
    }
    for (const a of s.attachments) {
      const r = document.createElement('div');
      r.className = `ed-row${a.picked ? ' on' : ''}`;
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = `${a.i + 1}: ${a.words}`;
      label.title = a.words;
      r.appendChild(label);
      const pick = this.button('Pick', 'tool', a.picked ? 'on' : '');
      pick.addEventListener('click', () => {
        pick.blur();
        at('pick', a.i);
      });
      const rem = this.button('Remove', 'del', 'ed-del');
      rem.addEventListener('click', () => {
        rem.blur();
        at('remove', a.i);
      });
      r.append(pick, rem);
      el.appendChild(r);
      this.field(el, `${a.i + 1}: at x y z`, a.at, (v) => at('at', a.i, v));
      if (a.size) this.field(el, `${a.i + 1}: size`, a.size, (v) => at('size', a.i, v), 'number');
    }
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
    // The seventh wave's effects and sounds out of the library: hung on the row the aim meets, or stood as marks.
    if (t.attach) {
      h('EFFECTS AND SOUNDS');
      row(toggle(t.attach.onto ? 'Hang it on the row it lands on' : 'Stand it as a mark', t.attach.onto, { attachOnto: !t.attach.onto }));
      this.note(el, "Take an effect or a sound from the library's Effects and Sounds groups and click: it hangs on the row of the files the aim meets (with this on), else stands as a mark of its own. A handle marks each one; click it, then R, F or C held with the mouse turns, raises or sizes it, the arrows nudge it and Delete takes it off.");
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
      row(...(['family', 'colour', 'plants'] as const).map((m) => toggle(m === 'family' ? 'Families' : m === 'colour' ? 'Colour' : 'Plants', p.layer === m, { paintLayer: m })));
      // The plants layer (Map-maker II's fourth wave): the recipes, and one built a class at a time.
      if (p.layer === 'plants' && p.plants) {
        const pl = p.plants;
        if (pl.recipes.length) {
          this.note(el, 'The recipes (a click chooses what LMB paints):');
          const r = row();
          r.style.flexWrap = 'wrap';
          for (const rc of pl.recipes) r.appendChild(toggle(`${rc.at}: ${rc.words}${rc.paints ? '' : ' (paints nothing here)'}`, rc.chosen, { floraRecipe: rc.at }));
        } else this.note(el, 'No recipe yet: build one below and paint with it.');
        this.note(el, 'A recipe, a class at a time:');
        for (const d of pl.draft) {
          const r = row();
          r.style.flexWrap = 'wrap';
          const label = document.createElement('span');
          label.className = 'ed-label';
          label.textContent = d.label;
          r.appendChild(label);
          for (const op of ['keep', 'clear', 'thin', 'add', 'remove']) r.appendChild(toggle(op[0].toUpperCase() + op.slice(1), d.op === op, { floraClass: [d.cls, op] }));
          if (d.op === 'add' || d.op === 'remove') {
            const sel = document.createElement('select');
            for (const name of ['', ...d.families]) {
              const o = document.createElement('option');
              o.value = name;
              o.textContent = name || '(a family)';
              if (name === d.family) o.selected = true;
              sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
              this.host.setTool({ floraFamily: [d.cls, sel.value] });
              sel.blur();
            });
            r.appendChild(sel);
          }
        }
        row(toggle(pl.roads ? 'Paints roads and rivers too' : 'Keeps off roads and rivers', pl.roads, { floraRoads: !pl.roads }), toggle('Paint with this recipe', false, { floraUse: true }));
        if (pl.note) this.note(el, pl.note);
      }
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
      // Every installed world's families (Map-maker II's third wave), a pack at a time: this world's own first.
      this.note(el, 'Families of:');
      const pr = row();
      pr.style.flexWrap = 'wrap';
      for (const k of p.packs) pr.appendChild(toggle(k.words, k.on, { paintBrowse: k.id }));
      if (p.browseNote) this.note(el, p.browseNote);
      if (p.families.length) {
        this.note(el, 'A click adds a family to the palette and chooses it; a small picture forces that alternate:');
        for (const f of p.families) {
          const r = row();
          r.style.flexWrap = 'wrap';
          const label = document.createElement('span');
          label.className = 'ed-label';
          label.textContent = f.lent ? f.name : `${f.name} (not lent yet)`;
          r.appendChild(label);
          r.appendChild(pic(f.pictures[0] ?? null, `${f.name}: the pole's own alternate`, false, { paintAdd: { pack: f.pack, name: f.name } }));
          if (f.pictures.length > 1) f.pictures.forEach((src, i) => r.appendChild(pic(src, `${f.name}: alternate ${i}`, false, { paintAdd: { pack: f.pack, name: f.name, child: i } })));
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
    // The water tool (Map-maker II's fifth wave): what a click does, where a lake's level comes from, the draft and the lake picked.
    if (t.water) {
      const wt = t.water;
      h('LAKES, FALLS AND RIVERS');
      row(...(['clicks', 'trace', 'fall', 'river'] as const).map((m) => toggle(m === 'clicks' ? 'A lake by clicks' : m === 'trace' ? 'A lake traced' : m === 'fall' ? 'A fall' : 'A river', wt.mode === m, { waterMode: m })));
      if (wt.mode === 'river') {
        // The sixth wave's: where a river's points stand, and what a reach past the slope limit becomes (the owner's switch).
        row(...(['level', 'ground'] as const).map((m) => toggle(m === 'level' ? 'Never runs uphill' : 'Each point on its ground', wt.riverHeights === m, { waterRiverHeights: m })));
        row(...(['effects', 'fall', 'refuse'] as const).map((m) => toggle(m === 'effects' ? 'Steep: fall effects' : m === 'fall' ? 'Steep: a fall row' : 'Steep: not water', wt.steep === m, { riverSteep: m })));
        if (wt.draft >= 2) row(toggle(`Write the river (${wt.draft} points)`, false, { waterRiverFinish: true }), toggle('Give it up', false, { waterGiveUp: true }));
        else if (wt.draft) row(toggle('Give up the draft', false, { waterGiveUp: true }));
      } else if (wt.mode !== 'fall') {
        row(...(['lowest', 'first', 'typed'] as const).map((m) => toggle(m === 'lowest' ? 'Level: the lowest ground' : m === 'first' ? "Level: the first point's" : 'Level: typed', wt.levelFrom === m, { waterLevelFrom: m })));
        const f = document.createElement('label');
        f.className = 'ed-field';
        const sp = document.createElement('span');
        sp.textContent = 'Level m';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(Math.round(wt.height * 1000) / 1000);
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (input.value.trim() !== '' && Number.isFinite(n)) this.host.setTool({ waterHeight: n });
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') input.blur();
        });
        f.append(sp, input);
        el.appendChild(f);
      }
      if (wt.mode !== 'river') {
        if (wt.draft >= 3) row(toggle(`Close the outline (${wt.draft} points)`, false, { waterClose: true }), toggle('Give it up', false, { waterGiveUp: true }));
        else if (wt.draft || wt.fallTop) row(toggle('Give up the draft', false, { waterGiveUp: true }));
      }
      if (wt.picked) row(toggle(`Let ${wt.picked} go`, true, { waterPick: null }), toggle('Take it out', false, { waterRemove: wt.picked }));
      this.note(el, wt.file);
      if (wt.note) this.note(el, wt.note);
      this.note(el, "Z arms it. A lake by clicks: LMB a point, a click near the first closes it, RMB takes one back. Traced: LMB a seed in its basin, flooded to the seed's ground and a little more (or the typed level). A fall: LMB its top, then its bottom. A river: LMB its points from its source down, a click near the last writes it, RMB takes one back. A click on a lake's or a river's ring picks it; its look (and a river's width and velocity) is on the Selected tab. Each is one undo. Its numbers are the sliders under The water tool below, and the rivers' own under rivers in the debug menu.");
    }
    // The places tool (Map-maker II's eighth wave): what a click draws, the kind written, a circle's radius, the draft and
    // the place picked, and the world row (the game's own cities kept clear of players' building, its loading lines).
    if (t.places) {
      const pl = t.places;
      h('PLACES ON THE MAP');
      row(...(['circle', 'rect', 'outline'] as const).map((m) => toggle(m === 'circle' ? 'A circle' : m === 'rect' ? 'A rectangle' : 'An outline', pl.mode === m, { placesMode: m })));
      row(...['city', 'place', 'landmark', 'area', 'zone'].map((k) => toggle(k[0].toUpperCase() + k.slice(1), pl.kind === k, { placesKind: k })));
      if (pl.mode === 'circle') {
        const f = document.createElement('label');
        f.className = 'ed-field';
        const sp = document.createElement('span');
        sp.textContent = 'Radius m';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(pl.radius);
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (input.value.trim() !== '' && Number.isFinite(n)) this.host.setTool({ placesRadius: n });
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') input.blur();
        });
        f.append(sp, input);
        el.appendChild(f);
      }
      if (pl.draft >= 3) row(toggle(`Close the outline (${pl.draft} points)`, false, { placesClose: true }), toggle('Give it up', false, { placesGiveUp: true }));
      else if (pl.draft) row(toggle('Give up the outline', false, { placesGiveUp: true }));
      if (pl.picked) row(toggle(`Let ${pl.picked} go`, true, { placesPick: null }), toggle('Take it out', false, { placesRemove: pl.picked }));
      h('THE WORLD ROW OF PLACES');
      row(toggle(pl.cities ? "The game's own cities: no building" : "The game's own cities: players may build", pl.cities, { placesCities: !pl.cities }));
      this.note(el, "Off by default: the game's own cities, its no-build areas and the client's no-build radii are open to players' houses and props. On, players are kept off them as the server kept them.");
      const lf = document.createElement('label');
      lf.className = 'ed-field';
      const ls = document.createElement('span');
      ls.textContent = 'Loading lines in no place';
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = pl.worldLoading;
      ta.addEventListener('change', () => this.host.setTool({ placesWorldLoading: ta.value }));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') ta.blur();
      });
      lf.append(ls, ta);
      el.appendChild(lf);
      this.note(el, pl.file);
      if (pl.note) this.note(el, pl.note);
      this.note(el, "P arms it. A circle: LMB at its middle (C held with the wheel sizes the next one). A rectangle: LMB held from corner to corner. An outline: LMB a point, a click near the first closes it, RMB takes one back. A click on a place's ring picks it; its name, kind, switches and loading lines are on the Selected tab. Each change is one undo. A place players may not build in is drawn in red.");
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
