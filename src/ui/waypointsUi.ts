// The Waypoints window: every waypoint the character keeps, this world's first by distance and then every
// other world's grouped under its name, each with its colour, whether it is switched on, whether it is
// the one tracked, its name to change, the thirteen colours to pick from, a way to take it away and a
// way to see it on the map; and at the top, a way to mark where you stand.
//
// It is a panel: it frees the mouse and the game does not simulate while it is up, so nothing in it runs
// on a frame and the distances it shows are the ones you had when it opened. What it shows is a model it
// is handed and every change is asked of the game, which asks the story book, which applies it at once
// when this browser holds the book and asks the server when a server does; the window is drawn again
// from the book when the change has come back.
//
// The name box keeps the chat line's rule for Escape: inside it, Escape puts the name back and is the
// box's alone, so the same press does not also shut the window behind it. Enter keeps the new name.
//
// Every colour on it is one of the eighteen, and the thirteen swatches are the waypoint colours by name.

import { escapeHtml } from './catalogue.ts';
import { WAYPOINT_COLOURS } from '../story/waypoints.ts';

/** One row as the window shows it. */
export interface WaypointRow {
  id: string;
  name: string;
  /** The world it is on (the pack id) and that world's name in words. */
  world: string;
  worldName: string;
  /** On the world you are standing on. */
  here: boolean;
  /** How far, in metres, on this world; Infinity on another. */
  d: number;
  /** How far, in words; empty on another world. */
  distance: string;
  colour: string;
  on: boolean;
  tracked: boolean;
  /** The room it was set in, or ''. */
  room: string;
}

/** What the window is handed. */
export interface WaypointsModel {
  rows: WaypointRow[];
  /** How many of the hundred are used, and the hundred. */
  count: number;
  max: number;
  /** Why "Mark here" cannot be pressed now, or ''. */
  markWhy: string;
  /** A line under the list: who holds the book, or why nothing can change just now. */
  note: string;
}

/**
 * The rows in the order the window shows them: this world's first, nearest first, then every other
 * world's together, the worlds by name and each world's rows by name. A new array; the window is a
 * panel and builds this when it is drawn, never in a frame.
 */
export function orderRows(rows: readonly WaypointRow[]): WaypointRow[] {
  return [...rows].sort((a, b) => {
    if (a.here !== b.here) return a.here ? -1 : 1;
    if (a.here) return a.d - b.d || a.name.localeCompare(b.name);
    return a.worldName.localeCompare(b.worldName) || a.name.localeCompare(b.name);
  });
}

const WAYPOINTS_CSS = `
#waypoints .waypoints-panel { width: min(640px, 94vw); }
#waypoints .wp-list { max-height: min(58vh, 520px); overflow-y: auto; }
#waypoints .waypoints-panel.win-sized .wp-list { max-height: none; }
#waypoints .wp-head { margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
#waypoints .wp-head:first-child { margin-top: 0; }
#waypoints .wp-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--ink) 5%, transparent); font-size: 12px; }
#waypoints .wp-row.off .wp-name { color: var(--muted); }
#waypoints .wp-row.tracked .wp-name { color: var(--accent); }
/* Two classes deep, so the row's own button rule (an id, a class and an element) does not dress a swatch as a button. */
#waypoints .wp-row .wp-sw, #waypoints .wp-colours .wp-sw { flex: none; width: 12px; height: 12px; padding: 0; border: 1px solid var(--edge); transform: rotate(45deg); border-radius: 1px; cursor: pointer; }
#waypoints .wp-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
#waypoints .wp-name input { width: 100%; box-sizing: border-box; padding: 2px 6px; font: inherit; color: var(--text); background: color-mix(in srgb, var(--void) 45%, transparent); border: 1px solid var(--accent); border-radius: 3px; }
#waypoints .wp-where { flex: none; width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--muted); text-align: right; }
#waypoints .wp-row label { flex: none; display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--muted); cursor: pointer; }
#waypoints .wp-row button { flex: none; padding: 3px 7px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--pool) 30%, transparent); border: 1px solid var(--panel-border); border-radius: 4px; cursor: pointer; }
#waypoints .wp-row button:hover:not(:disabled) { border-color: var(--accent); }
#waypoints .wp-row button:disabled { opacity: 0.4; cursor: default; }
#waypoints .wp-colours { display: flex; flex-wrap: wrap; gap: 9px; padding: 6px 4px 8px 22px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 5%, transparent); }
#waypoints .wp-colours .wp-sw.on, #waypoints .wp-row .wp-sw.on { outline: 1px solid var(--ink); outline-offset: 2px; }
#waypoints .ship-header .mark:disabled { opacity: 0.45; cursor: default; }
#waypoints .wp-empty { font-size: 12px; color: var(--muted); padding: 8px 0; }
#waypoints .wp-sw.wp-sw-accent { background: var(--accent); }
#waypoints .wp-sw.wp-sw-ink { background: var(--ink); }
#waypoints .wp-sw.wp-sw-muted { background: var(--muted); }
#waypoints .wp-sw.wp-sw-good { background: var(--good); }
#waypoints .wp-sw.wp-sw-warn { background: var(--warn); }
#waypoints .wp-sw.wp-sw-bad { background: var(--bad); }
#waypoints .wp-sw.wp-sw-hot { background: var(--hot); }
#waypoints .wp-sw.wp-sw-shield { background: var(--shield); }
#waypoints .wp-sw.wp-sw-armour { background: var(--armour); }
#waypoints .wp-sw.wp-sw-chassis { background: var(--chassis); }
#waypoints .wp-sw.wp-sw-component { background: var(--component); }
#waypoints .wp-sw.wp-sw-health { background: var(--health); }
#waypoints .wp-sw.wp-sw-pool { background: var(--pool); }
`;

let styled = false;
function installStyle(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = WAYPOINTS_CSS;
  document.head.appendChild(style);
}

/** The swatch class for a colour name; one of the thirteen, or the first of them. */
function swatch(colour: string): string {
  return `wp-sw wp-sw-${(WAYPOINT_COLOURS as readonly string[]).includes(colour) ? colour : WAYPOINT_COLOURS[0]}`;
}

export class WaypointsUi {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  onMark: () => void = () => {};
  onRename: (id: string, name: string) => void = () => {};
  onColour: (id: string, colour: string) => void = () => {};
  onSwitch: (id: string, on: boolean) => void = () => {};
  onTrack: (id: string | null) => void = () => {};
  onRemove: (id: string) => void = () => {};
  onShowOnMap: (id: string) => void = () => {};

  private readonly list: HTMLElement;
  private readonly title: HTMLElement;
  private readonly note: HTMLElement;
  private readonly markButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private model: WaypointsModel = { rows: [], count: 0, max: 0, markWhy: '', note: '' };
  /** The row whose colours are open under it, and the row being renamed. */
  private picking = '';
  private renaming = '';
  /** A model that came while a name was being typed, drawn once the box is done with. */
  private waiting = false;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'waypoints';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel waypoints-panel">
        <div class="ship-header">
          <h2>Waypoints</h2>
          <span class="ship-title"></span>
          <button class="mark">Mark here</button>
          <button class="close">Close</button>
        </div>
        <div class="ship-body">
          <div class="wp-list"></div>
          <p class="menu-hint wp-note"></p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.wp-list')!;
    this.title = this.root.querySelector('.ship-title')!;
    this.note = this.root.querySelector('.wp-note')!;
    this.markButton = this.root.querySelector('.mark')!;
    this.closeButton = this.root.querySelector('.close')!;
    this.closeButton.addEventListener('click', () => this.onClose());
    this.markButton.addEventListener('click', () => this.onMark());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** The key that opens and shuts it, as a cap (`keyLabel`), on the close button. Told again on a rebind. */
  setKey(cap: string): void {
    this.closeButton.textContent = `Close (${cap})`;
  }

  show(model: WaypointsModel): void {
    this.root.classList.remove('hidden');
    this.update(model);
  }

  /** A new model while it is open: drawn now, or once a name being typed is kept or given up. */
  update(model: WaypointsModel): void {
    this.model = model;
    if (!this.open) return;
    if (this.renaming) {
      this.waiting = true;
      return;
    }
    this.draw();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.renaming = '';
    this.picking = '';
    this.waiting = false;
  }

  /** What the window shows, for the console. */
  report(): { open: boolean; rows: number; renaming: string; picking: string } {
    return { open: this.open, rows: this.model.rows.length, renaming: this.renaming, picking: this.picking };
  }

  private draw(): void {
    const m = this.model;
    this.title.textContent = `${m.count} of ${m.max}`;
    this.markButton.disabled = !!m.markWhy;
    this.markButton.title = m.markWhy;
    this.note.textContent = m.note;
    const rows = orderRows(m.rows);
    if (!rows.length) {
      this.list.innerHTML = '<div class="wp-empty">No waypoints yet. Mark where you stand, or right-click the planet&rsquo;s map.</div>';
      return;
    }
    let html = '';
    let group = '';
    for (const r of rows) {
      const head = r.here ? 'This world' : r.worldName;
      if (head !== group) {
        group = head;
        html += `<div class="wp-head">${escapeHtml(head)}</div>`;
      }
      const id = escapeHtml(r.id);
      const where = r.here ? `${r.distance}${r.room ? ` · ${escapeHtml(r.room)}` : ''}` : escapeHtml(r.worldName);
      html +=
        `<div class="wp-row${r.on ? '' : ' off'}${r.tracked ? ' tracked' : ''}" data-id="${id}">` +
        `<button class="${swatch(r.colour)}" data-act="pick" title="Colour"></button>` +
        `<span class="wp-name">${escapeHtml(r.name)}</span>` +
        `<span class="wp-where">${where}</span>` +
        `<label><input type="checkbox" data-act="on"${r.on ? ' checked' : ''}> on</label>` +
        `<label><input type="radio" name="wp-track" data-act="track"${r.tracked ? ' checked' : ''}> track</label>` +
        `<button data-act="rename">Rename</button>` +
        `<button data-act="map"${r.here ? '' : ' disabled title="on another world"'}>Show on map</button>` +
        `<button data-act="gone">Delete</button>` +
        `</div>`;
      if (r.id === this.picking) {
        html += `<div class="wp-colours" data-id="${id}">`;
        for (const c of WAYPOINT_COLOURS) html += `<button class="${swatch(c)}${c === r.colour ? ' on' : ''}" data-colour="${c}" title="${c}"></button>`;
        html += '</div>';
      }
    }
    this.list.innerHTML = html;
    for (const row of this.list.querySelectorAll<HTMLElement>('.wp-row')) {
      const id = row.dataset.id!;
      for (const el of row.querySelectorAll<HTMLElement>('[data-act]')) {
        const act = el.dataset.act;
        if (act === 'on') el.addEventListener('change', () => this.onSwitch(id, (el as HTMLInputElement).checked));
        else if (act === 'track') el.addEventListener('click', () => this.onTrack(this.model.rows.find((r) => r.id === id)?.tracked ? null : id));
        else
          el.addEventListener('click', () => {
            if (act === 'pick') {
              this.picking = this.picking === id ? '' : id;
              this.draw();
            } else if (act === 'rename') this.rename(row, id);
            else if (act === 'map') this.onShowOnMap(id);
            else if (act === 'gone') this.onRemove(id);
          });
      }
    }
    for (const box of this.list.querySelectorAll<HTMLElement>('.wp-colours')) {
      const id = box.dataset.id!;
      for (const b of box.querySelectorAll<HTMLElement>('[data-colour]')) {
        b.addEventListener('click', () => {
          this.picking = '';
          this.onColour(id, b.dataset.colour!);
        });
      }
    }
  }

  /** The name turned into a box: Enter keeps what is typed, Escape and leaving it put the name back. */
  private rename(row: HTMLElement, id: string): void {
    const cell = row.querySelector<HTMLElement>('.wp-name');
    const r = this.model.rows.find((x) => x.id === id);
    if (!cell || !r) return;
    this.renaming = id;
    const box = document.createElement('input');
    box.type = 'text';
    box.maxLength = 48;
    box.value = r.name;
    cell.textContent = '';
    cell.appendChild(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      this.renaming = '';
      const name = box.value.trim();
      if (keep && name && name !== r.name) {
        // The new name shows at once; the book's own answer draws the row again when it comes back.
        cell.textContent = name;
        this.onRename(id, name);
      }
      if (this.waiting || !keep || !name || name === r.name) {
        this.waiting = false;
        this.draw();
      }
    };
    box.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        // The box's alone: the game's own Escape would shut the window behind it.
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    });
    box.addEventListener('blur', () => finish(false));
  }
}
