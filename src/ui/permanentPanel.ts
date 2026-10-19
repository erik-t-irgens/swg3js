// The dev server's placement editor in the Props and Housing tabs: a switch in the header, **Yours | Permanent**,
// and while it is on Permanent, over the tab's own list, what this world stands for good -- the rows of that
// tab's kind, nearest first, each with its layer, why it is not standing when it is not, and whether the ground
// under it has moved since it was put there -- with what can be done to one: go to it, pick it up as the
// pick-up key does, delete it from its file (asked in the page, the answer shut for a moment as the Housing
// tab's take-down is), rename it, give it a name and a note, turn its solidity, and copy a story object or an
// area naming it. The Housing tab adds every building the gallery has with rooms, which a double-click takes in
// hand by its model alone, deed or not.
//
// Nothing here decides anything: the game hands it rows and is told what was pressed. Made only on the dev
// server, so a release carries none of it; it wears the eighteen colours and nothing else.

import { escapeHtml } from './catalogue.ts';
import { HOUSING_TUNE } from '../world/myBuildings.ts';
import type { PlacementLayer } from '../story/placements.ts';

const PERMANENT_PANEL_CSS = `
.edit-head { flex: none; display: flex; gap: 0; }
.edit-head:empty { display: none; }
.edit-head .perm-switch button { border-radius: 0; padding: 4px 9px; color: var(--muted); }
.edit-head .perm-switch button:first-child { border-radius: 4px 0 0 4px; }
.edit-head .perm-switch button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
.edit-head .perm-switch button.on { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.edit-body { flex: none; max-height: 44vh; overflow-y: auto; padding: 6px 14px 8px; border-bottom: 1px solid var(--rule); display: flex; flex-direction: column; gap: 4px; }
.edit-body[hidden] { display: none; }
.perm-dest { font-size: 11px; color: var(--muted); letter-spacing: 0.03em; }
.perm-dest b { color: var(--accent); font-weight: 400; }
.perm-h { margin: 6px 0 2px; font-size: 12px; letter-spacing: 0.1em; color: var(--accent); font-weight: 600; }
.perm-h span { color: var(--muted); font-weight: 400; margin-left: 6px; letter-spacing: 0; }
.perm-models { display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto; }
.perm-model { padding: 2px 7px; font-size: 11px; color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; cursor: pointer; user-select: none; }
.perm-model:hover { border-color: var(--edge); }
.perm-row { display: flex; flex-direction: column; gap: 4px; padding: 5px 8px; border: 1px solid var(--rule); border-radius: 4px; cursor: pointer; }
.perm-row:hover { border-color: var(--edge); }
.perm-row.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); cursor: default; }
.perm-line { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.perm-name { color: var(--ink); }
.perm-id { color: var(--muted); font-size: 11px; }
.perm-layer { color: var(--accent); font-size: 10px; letter-spacing: 0.08em; }
.perm-away { margin-left: auto; color: var(--muted); font-size: 11px; }
.perm-bad { color: var(--bad); font-size: 11px; }
.perm-drift { color: var(--warn); font-size: 11px; }
.perm-acts, .perm-fields, .perm-ask { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.perm-row button { padding: 3px 8px; font-size: 11px; background: color-mix(in srgb, var(--pool) 30%, transparent); color: var(--ink); border: 1px solid var(--panel-border); border-radius: 3px; cursor: pointer; }
.perm-row button:hover { border-color: var(--accent); }
.perm-row button[disabled] { opacity: 0.45; cursor: default; }
.perm-row button.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 60%, transparent); }
.perm-row input { padding: 3px 6px; font-size: 11px; background: color-mix(in srgb, var(--void) 30%, transparent); color: var(--ink); border: 1px solid var(--panel-border); border-radius: 3px; }
.perm-row input.perm-note { flex: 1 1 200px; }
.perm-ask span { color: var(--warn); font-size: 11px; }
.perm-more { color: var(--muted); font-size: 11px; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = PERMANENT_PANEL_CSS;
  document.head.appendChild(style);
}

/**
 * The two places the panel fills in a tab (the Props tab's or the Housing tab's own `root`), made here and only
 * on the dev server: a slot in the header before its count for the switch, and one under the header over the
 * tab's list. The tabs carry neither, so a release lays its header out exactly as it always did.
 */
export function editSlots(root: HTMLElement): { head: HTMLElement; body: HTMLElement } {
  const header = root.querySelector<HTMLElement>('.wardrobe-header')!;
  const head = document.createElement('span');
  head.className = 'edit-head';
  header.insertBefore(head, header.querySelector('.count'));
  const body = document.createElement('div');
  body.className = 'edit-body';
  body.hidden = true;
  header.after(body);
  return { head, body };
}

/** One row of what this world stands for good, as the panel shows it. */
export interface PermanentRowView {
  id: string;
  layer: PlacementLayer;
  /** What it is called in words. */
  label: string;
  /** How far off it is, in words. */
  away: string;
  /** Why it does not stand, or null. */
  bad: string | null;
  /** How far the ground under it has moved since it was put there, in words, or null. */
  drift: string | null;
  /** Whether it is solid as it stands, its row's own word or the default. */
  solid: boolean;
  name: string;
  note: string;
  /** Whether it stands, so it can be gone to and picked up. */
  stood: boolean;
  /** Whether it is in the editor's hand now: nothing here changes it until it is put down. */
  held: boolean;
  /** The world state it stands in (`restuss=ruins`), '' for every state, and that in words. */
  state: string;
  stateText: string;
}

/** What the panel shows. */
export interface PermanentPanelModel {
  layer: 'yours' | 'permanent';
  /** Where a thing taken now would be kept, in words. */
  dest: string;
  /** The key that moves where the thing in hand is kept, as the bindings spell it now. */
  layerKey: string;
  rows: PermanentRowView[];
  /** How many rows further off are not listed. */
  more: number;
  /** The gallery's buildings with rooms, for the Housing tab; null for the Props tab. */
  models: { id: string; name: string }[] | null;
  /** What to say when there are no rows. */
  note: string;
  /**
   * The world states a row may be kept to on this world (`restuss=living`, `restuss=ruins`), offered as a State
   * choice on each row; null on a world with none, where there is nothing to choose.
   */
  states: string[] | null;
}

export class PermanentPanel {
  onLayer: (layer: 'yours' | 'permanent') => void = () => {};
  onGo: (id: string) => void = () => {};
  onTake: (id: string) => void = () => {};
  onDelete: (id: string) => void = () => {};
  onRename: (id: string, to: string) => void = () => {};
  onWords: (id: string, name: string, note: string) => void = () => {};
  onSolid: (id: string, solid: boolean) => void = () => {};
  /** The State button pressed: the row's world state moved to the next choice (the game works out which). */
  onState: (id: string) => void = () => {};
  onCopy: (id: string, what: 'object' | 'area') => void = () => {};
  /** A gallery building, double-clicked: take it in hand by its model. */
  onModel: (model: string) => void = () => {};

  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly kind: 'prop' | 'building';
  private model: PermanentPanelModel = { layer: 'yours', dest: '', layerKey: '', rows: [], more: 0, models: null, note: '', states: null };
  /** What the body was last drawn from (the model, the row opened, the question asked), so a refresh that changes none of it draws nothing. */
  private drawn = '';
  /** The row opened for its actions, by id. */
  private picked = '';
  /** The row whose delete is being asked about, and whether its answer is open yet. */
  private asking = '';
  private armed = false;
  private armTimer = 0;
  /** What has been typed into a row's fields, kept across a redraw, by `<id>|<field>`. */
  private readonly typed = new Map<string, string>();

  constructor(head: HTMLElement, body: HTMLElement, kind: 'prop' | 'building') {
    installStyle();
    this.head = head;
    this.body = body;
    this.kind = kind;
    head.innerHTML = `<span class="perm-switch"><button data-layer="yours">Yours</button><button data-layer="permanent">Permanent</button></span>`;
    head.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-layer]');
      if (b) this.onLayer(b.dataset.layer === 'permanent' ? 'permanent' : 'yours');
    });
    body.addEventListener('click', (e) => this.clicked(e));
    body.addEventListener('dblclick', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('.perm-model[data-model]');
      if (m) this.onModel(m.dataset.model!);
    });
    body.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const row = t.closest<HTMLElement>('.perm-row[data-id]');
      if (row && t.dataset.field) this.typed.set(`${row.dataset.id}|${t.dataset.field}`, t.value);
    });
  }

  /**
   * What there is to show; the body is drawn only while the switch is on Permanent, and only when something it
   * draws has changed. A save asks for the panels again as it stands its answer and once more for each word that
   * its file changed, a moment apart, and a body written again each time took the focus out of a field being
   * typed in and handed the keys to the game.
   */
  show(model: PermanentPanelModel): void {
    this.model = model;
    for (const b of this.head.querySelectorAll<HTMLElement>('button[data-layer]')) b.classList.toggle('on', b.dataset.layer === model.layer);
    if (this.asking && !model.rows.some((r) => r.id === this.asking && !r.held)) this.stopAsking();
    this.body.hidden = model.layer !== 'permanent';
    if (!this.body.hidden) this.draw();
  }

  private stopAsking(): void {
    window.clearTimeout(this.armTimer);
    this.asking = '';
    this.armed = false;
  }

  private typedOr(id: string, field: string, value: string): string {
    return this.typed.get(`${id}|${field}`) ?? value;
  }

  /**
   * The body written from the model, unless it would read exactly as it does (`drawn`). Written again, the field
   * the player was typing in is focused again with its caret where it was, so a redraw between two keys loses
   * neither the words (`typed`) nor the keys to the game.
   */
  private draw(): void {
    const m = this.model;
    const key = JSON.stringify([m, this.picked, this.asking, this.armed]);
    if (key === this.drawn) return;
    this.drawn = key;
    const active = document.activeElement as HTMLInputElement | null;
    const focus = active && this.body.contains(active) && active.dataset.field ? { id: active.closest<HTMLElement>('.perm-row[data-id]')?.dataset.id ?? '', field: active.dataset.field, from: active.selectionStart, to: active.selectionEnd } : null;
    const out: string[] = [];
    out.push(`<div class="perm-dest">Permanent: what you take now is saved to <b>${escapeHtml(m.dest)}</b> (${escapeHtml(m.layerKey)} in hand changes it)</div>`);
    if (m.models) {
      const cells = m.models.map((d) => `<span class="perm-model" data-model="${escapeHtml(d.id)}" title="${escapeHtml(d.id)}">${escapeHtml(d.name)}</span>`).join('');
      out.push(`<h3 class="perm-h">Every building the gallery has <span>double-click one to put it down for good, deed or not</span></h3><div class="perm-models">${cells || '<span class="perm-more">the gallery pack is not converted</span>'}</div>`);
    }
    out.push(`<h3 class="perm-h">Standing here <span>${m.rows.length ? `${m.rows.length + m.more} on this world, nearest first` : escapeHtml(m.note)}</span></h3>`);
    for (const r of m.rows) out.push(this.rowHtml(r));
    if (m.more) out.push(`<div class="perm-more">and ${m.more} more further off</div>`);
    const scroll = this.body.scrollTop;
    this.body.innerHTML = out.join('');
    this.body.scrollTop = scroll;
    if (focus) {
      const again = [...this.body.querySelectorAll<HTMLInputElement>(`input[data-field="${focus.field}"]`)].find((i) => i.closest<HTMLElement>('.perm-row[data-id]')?.dataset.id === focus.id);
      if (again) {
        again.focus();
        if (focus.from !== null && focus.to !== null) again.setSelectionRange(focus.from, focus.to);
      }
    }
  }

  private rowHtml(r: PermanentRowView): string {
    const on = r.id === this.picked;
    const id = escapeHtml(r.id);
    const line = `<div class="perm-line"><span class="perm-name">${escapeHtml(r.label)}</span><span class="perm-id">${id}</span><span class="perm-layer">${r.layer === 'story' ? 'STORY' : 'WORLD EDIT'}</span><span class="perm-away">${escapeHtml(r.away)}</span></div>`;
    const bad = r.held ? `<div class="perm-drift">in your hand: put it down, or give it up, before it is changed here</div>` : r.bad ? `<div class="perm-bad">not standing: ${escapeHtml(r.bad)}</div>` : '';
    const drift = r.drift ? `<div class="perm-drift">${escapeHtml(r.drift)}</div>` : '';
    if (!on) return `<div class="perm-row" data-id="${id}">${line}${bad}${drift}</div>`;
    const asking = this.asking === r.id && !r.held;
    const del = asking
      ? `<div class="perm-ask"><span>Take ${id} out of its file? Every player stops seeing it once that is committed.</span><button data-act="keep">Keep it</button><button class="danger" data-act="really"${this.armed ? '' : ' disabled'}>Delete it</button></div>`
      : '';
    // A row in hand is the hand's: its save writes the row it carries, so nothing here may change it meanwhile.
    const held = r.held ? ' disabled' : '';
    const acts =
      `<div class="perm-acts">` +
      `<button data-act="go"${r.stood ? '' : ' disabled'}>Go to</button>` +
      `<button data-act="take"${r.stood ? '' : ' disabled'}>Pick up</button>` +
      `<button class="danger" data-act="del"${held}>Delete</button>` +
      `<button data-act="solid"${held}>Solid: ${r.solid ? 'yes' : 'no'}</button>` +
      // On a world with states (Restuss), which one it stands in: every state, or one only.
      (this.model.states ? `<button data-act="state"${held}>State: ${escapeHtml(r.stateText)}</button>` : '') +
      `<button data-act="object">Copy as story object</button>` +
      `<button data-act="area">Copy as area</button>` +
      `</div>`;
    const fields =
      `<div class="perm-fields">` +
      `<input data-field="id" value="${escapeHtml(this.typedOr(r.id, 'id', r.id))}" spellcheck="false" size="22"${held} />` +
      `<button data-act="rename"${held}>Rename</button>` +
      `<input data-field="name" placeholder="name" value="${escapeHtml(this.typedOr(r.id, 'name', r.name))}" size="18"${held} />` +
      `<input class="perm-note" data-field="note" placeholder="note" value="${escapeHtml(this.typedOr(r.id, 'note', r.note))}"${held} />` +
      `<button data-act="words"${held}>Save name and note</button>` +
      `</div>`;
    return `<div class="perm-row on" data-id="${id}">${line}${bad}${drift}${acts}${fields}${del}</div>`;
  }

  private clicked(e: Event): void {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.perm-row[data-id]');
    if (!row) return;
    const id = row.dataset.id!;
    const act = t.closest<HTMLElement>('button[data-act]')?.dataset.act;
    if (!act) {
      if (t.closest('input')) return;
      if (this.picked !== id) {
        this.picked = id;
        this.stopAsking();
        this.draw();
      }
      return;
    }
    const r = this.model.rows.find((x) => x.id === id);
    if (!r) return;
    if (r.held && act !== 'go' && act !== 'take' && act !== 'object' && act !== 'area') return;
    const field = (f: string) => row.querySelector<HTMLInputElement>(`input[data-field="${f}"]`)?.value ?? '';
    switch (act) {
      case 'go':
        this.onGo(id);
        return;
      case 'take':
        this.onTake(id);
        return;
      case 'del':
        this.asking = id;
        this.armed = false;
        window.clearTimeout(this.armTimer);
        this.draw();
        // Shut for a moment, so the click that asked cannot also answer.
        this.armTimer = window.setTimeout(() => {
          if (this.asking !== id) return;
          this.armed = true;
          const b = this.body.querySelector<HTMLButtonElement>('button[data-act="really"]');
          if (b) b.disabled = false;
        }, HOUSING_TUNE.armMs);
        return;
      case 'keep':
        this.stopAsking();
        this.draw();
        return;
      case 'really':
        if (!this.armed || this.asking !== id) return;
        this.stopAsking();
        this.onDelete(id);
        return;
      case 'solid':
        this.onSolid(id, !r.solid);
        return;
      case 'state':
        this.onState(id);
        return;
      case 'object':
      case 'area':
        this.onCopy(id, act);
        return;
      case 'rename': {
        const to = field('id').trim();
        this.typed.delete(`${id}|id`);
        if (to && to !== id) {
          this.picked = to;
          this.onRename(id, to);
        }
        return;
      }
      case 'words':
        this.typed.delete(`${id}|name`);
        this.typed.delete(`${id}|note`);
        this.onWords(id, field('name').trim(), field('note').trim());
        return;
    }
  }

  /** The kind of row it lists, for the game. */
  get rowKind(): 'prop' | 'building' {
    return this.kind;
  }
}
