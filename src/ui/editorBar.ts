// The world editor's bar at the foot of the screen (DESIGN.md §2.2): what mode the mouse is in, how fast the eye flies,
// what is in hand and which file a click writes into, the room the camera is in, every rule a player would have been
// refused by (as notes: the editor places all the same), what the last write said, and the keys. It stands in place of
// the on-foot bars, cells, hands and the action bar while the editor is on.
//
// It builds its own element and is handed one kept record a frame; a part is written only when its words change, so a
// steady frame writes nothing. Every colour on it is one of the eighteen. The dev server's alone: reached only through
// the editor's own dynamic import.

const EDITOR_BAR_CSS = `
#editor-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; max-width: 92vw; }
#editor-bar[hidden] { display: none; }
#editor-bar .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; background: color-mix(in srgb, var(--plate) 70%, transparent); border: 1px solid var(--rule); border-radius: 4px; padding: 5px 10px; font-size: 11px; letter-spacing: 0.04em; color: var(--muted); }
#editor-bar .mode { color: var(--accent); letter-spacing: 0.08em; }
#editor-bar .hand { color: var(--ink); }
#editor-bar .dest { color: var(--muted); }
#editor-bar .room { color: var(--muted); }
#editor-bar .notes { color: var(--warn); font-size: 11px; letter-spacing: 0.03em; text-align: center; min-height: 1.2em; }
#editor-bar .said { font-size: 11px; letter-spacing: 0.03em; color: var(--good); text-align: center; min-height: 1.2em; }
#editor-bar .said.bad { color: var(--bad); }
#editor-bar .hint { font-size: 10px; letter-spacing: 0.04em; color: var(--muted); text-align: center; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = EDITOR_BAR_CSS;
  document.head.appendChild(style);
}

/** What the bar says this frame: one record, written by the editor, read by the bar. */
export interface EditorBarView {
  mode: string;
  speed: string;
  hand: string;
  dest: string;
  room: string;
  notes: string;
  said: string;
  saidOk: boolean;
  hint: string;
}

/** A view with nothing in it. */
export function editorBarView(): EditorBarView {
  return { mode: '', speed: '', hand: '', dest: '', room: '', notes: '', said: '', saidOk: true, hint: '' };
}

/** The bar. */
export class EditorBar {
  readonly root: HTMLElement;
  private readonly parts: Record<keyof EditorBarView, HTMLElement | null>;
  private readonly last = editorBarView();
  /** How many times a part was written (the steady frame's proof: none). */
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    const root = document.createElement('div');
    root.id = 'editor-bar';
    root.hidden = true;
    root.innerHTML = '<div class="notes"></div><div class="said"></div><div class="row"><span class="mode"></span><span class="speed"></span><span class="hand"></span><span class="dest"></span><span class="room"></span></div><div class="hint"></div>';
    parent.appendChild(root);
    this.root = root;
    const q = (c: string) => root.querySelector<HTMLElement>(`.${c}`);
    this.parts = { mode: q('mode'), speed: q('speed'), hand: q('hand'), dest: q('dest'), room: q('room'), notes: q('notes'), said: q('said'), saidOk: null, hint: q('hint') };
  }

  /** Show the bar with this frame's words; only what changed is written. */
  show(v: EditorBarView): void {
    if (this.root.hidden) this.root.hidden = false;
    for (const k of ['mode', 'speed', 'hand', 'dest', 'room', 'notes', 'said', 'hint'] as const) {
      if (v[k] === this.last[k]) continue;
      this.last[k] = v[k];
      const el = this.parts[k];
      if (el) el.textContent = v[k];
      this.writes++;
    }
    if (v.saidOk !== this.last.saidOk) {
      this.last.saidOk = v.saidOk;
      this.parts.said?.classList.toggle('bad', !v.saidOk);
      this.writes++;
    }
  }

  hide(): void {
    if (!this.root.hidden) this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}
