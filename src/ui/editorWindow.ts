// The world editor's window (DESIGN.md §2.2, §2.5): docked at the left, moved by its header and sized by its corner like
// every window (`draggable`, `WINDOW_MIN.editor`), and two tabs this wave -- **Library**, everything it can put down, and
// **Here**, the permanent rows standing round the camera with their file, a way to fly to each, to pick one up into the
// hand and to take it out of its file.
//
// It is not a panel: it stays out of `anyPanelOpen`, so the world goes on simulating under it and the camera flies, and
// it is clickable only in Point mode (in Fly the pointer is locked and nothing on the page is reached). A button gives
// the keyboard back to the page after a click, so WASD still flies. The dev server's alone: reached only through the
// editor's own dynamic import. Every colour on it is one of the eighteen.

import { EDITOR_TUNE } from '../editor/editorTune.ts';
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
.ed-tabs { display: flex; gap: 4px; }
.ed-tabs button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: transparent; border: 1px solid var(--rule); border-radius: 3px; padding: 3px 9px; cursor: pointer; }
.ed-tabs button.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.ed-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.ed-lib { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.ed-body > div[hidden] { display: none; }
.ed-here { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; flex: 1 1 auto; }
.ed-here .ed-note { font-size: 11px; color: var(--muted); padding: 4px 0; }
.ed-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--rule); padding: 4px 0; }
.ed-row .ed-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-row .ed-meta { font-size: 10px; color: var(--muted); white-space: nowrap; }
.ed-row .ed-bad { font-size: 10px; color: var(--warn); }
.ed-row button { font: inherit; font-size: 10px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 2px 7px; cursor: pointer; }
.ed-row button:hover { color: var(--ink); border-color: var(--edge); }
.ed-row button.ed-del { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 50%, transparent); }
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

/** What the window needs of the editor beside the library's own. */
export interface EditorWindowHost extends LibraryHost {
  /** The rows standing round the camera, nearest first. */
  here(): HereRow[];
  goTo(id: string): void;
  pickUp(id: string): void;
  remove(id: string, layer: string): void;
}

/** The window. */
export class EditorWindow {
  readonly root: HTMLElement;
  readonly library: LibraryUi;
  private readonly host: EditorWindowHost;
  private readonly hereEl: HTMLElement;
  private readonly libEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly tabs = new Map<'library' | 'here', HTMLButtonElement>();
  private tab: 'library' | 'here' = 'library';
  private pointMode = false;

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
    root.innerHTML = '<div class="ed-head"><span class="ed-title">WORLD EDITOR</span><span class="ed-mode"></span></div><div class="ed-tabs"></div><div class="ed-body"><div class="ed-lib"></div><div class="ed-here" hidden></div></div>';
    parent.appendChild(root);
    this.root = root;
    this.modeEl = root.querySelector<HTMLElement>('.ed-mode')!;
    this.libEl = root.querySelector<HTMLElement>('.ed-lib')!;
    this.hereEl = root.querySelector<HTMLElement>('.ed-here')!;
    const tabsEl = root.querySelector<HTMLElement>('.ed-tabs')!;
    for (const [t, words] of [
      ['library', 'Library'],
      ['here', 'Here'],
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
    this.library = new LibraryUi(this.libEl, host);
    this.hereEl.addEventListener('click', (e) => this.hereClicked(e));
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

  setTab(t: 'library' | 'here'): void {
    this.tab = t;
    for (const [k, b] of this.tabs) b.classList.toggle('on', k === t);
    this.libEl.hidden = t !== 'library';
    this.hereEl.hidden = t !== 'here';
    if (t === 'here') this.drawHere();
  }

  /** The Here tab drawn again, if it is the one showing (a write landed, the camera moved far). */
  refreshHere(): void {
    if (this.tab === 'here' && !this.root.hidden) this.drawHere();
  }

  private drawHere(): void {
    const rows = this.host.here();
    this.hereEl.replaceChildren();
    if (!rows.length) {
      const n = document.createElement('div');
      n.className = 'ed-note';
      n.textContent = 'nothing stands for good round here';
      this.hereEl.appendChild(n);
      return;
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'ed-row';
      row.dataset.id = r.id;
      row.dataset.layer = r.layer;
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = r.label;
      label.title = r.id;
      const meta = document.createElement('span');
      meta.className = 'ed-meta';
      meta.textContent = `${r.layer} · ${r.away}`;
      row.append(label, meta);
      if (r.bad) {
        const bad = document.createElement('span');
        bad.className = 'ed-bad';
        bad.textContent = r.bad;
        row.appendChild(bad);
      }
      for (const [act, words] of [
        ['go', 'Go to'],
        ['take', 'Pick up'],
        ['del', 'Delete'],
      ] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.textContent = words;
        if (act === 'del') b.className = 'ed-del';
        if (act === 'take' && !r.stood) b.disabled = true;
        row.appendChild(b);
      }
      this.hereEl.appendChild(row);
    }
  }

  private hereClicked(e: MouseEvent): void {
    const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-act]');
    const row = b?.closest<HTMLElement>('.ed-row');
    if (!b || !row) return;
    b.blur();
    const id = row.dataset.id ?? '';
    const layer = row.dataset.layer ?? '';
    if (b.dataset.act === 'go') this.host.goTo(id);
    else if (b.dataset.act === 'take') this.host.pickUp(id);
    else if (b.dataset.act === 'del') this.host.remove(id, layer);
  }

  dispose(): void {
    this.library.dispose();
    this.root.remove();
  }
}
