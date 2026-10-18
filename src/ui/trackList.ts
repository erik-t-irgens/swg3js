// The track editor's list in the debug menu (the dev server's alone): every track of this world with what can be done
// to it, and the track in hand a row a gate -- Go to (stand at it), Here (move it to where you stand, facing your
// travel), Insert after, the nudge buttons (along, across, up, and a turn either way), its width and height, Delete --
// under the track's own row with its name, kind, laps, kinds, clear and Save. Every button calls the very function
// `__debug.track` calls, through `act`, and the list is drawn again from the game's model after each one, so the list
// and the console can never mean two different things. Nothing here runs in a frame.
//
// Every colour is one of the palette's eighteen names: `hudPage.test.ts` reads this file's stylesheet string and holds
// it to that rule.

import type { DebugListSource } from './debugMenu.ts';

/** One track of this world's file, as the list names it. */
export interface TrackListEntry {
  id: string;
  name: string;
  kind: string;
  laps: number;
  gates: number;
  /** The lap's length on the ground, metres. */
  length: number;
}

/** A gate of the track in hand, as its row shows it. */
export interface TrackListGate {
  w: number;
  h: number;
  /** Metres from the gate before it (the grid before gate 0). */
  from: number;
  /** Metres from where you stand. */
  away: number;
}

/** What the list shows: the world, its file's tracks, and the track in hand with its gates. */
export interface TrackListModel {
  world: string;
  file: string;
  tracks: TrackListEntry[];
  /** Why the file could not be read, or ''. */
  problem: string;
  held: null | {
    id: string;
    name: string;
    kind: 'circuit' | 'sprint';
    laps: number;
    for: string[];
    clear: number;
    /** Not in the file as it stands: a new track, or one edited since it was saved. */
    unsaved: boolean;
    gates: TrackListGate[];
  };
}

/** What a button asks: the same shapes `__debug.track` takes. */
export type TrackListAct = Record<string, unknown>;

export interface TrackListDeps {
  model(): TrackListModel;
  act(o: TrackListAct): string | Promise<string>;
  /** The nudge's step and turn now (`TRACK_TUNE.nudge`, `nudgeTurn`). */
  nudge(): { m: number; deg: number };
}

const TRACK_LIST_CSS = `
.trk-head { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; padding: 4px 0 6px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
.trk-head b { color: var(--accent); font: 600 12px/1.4 ui-monospace, Menlo, Consolas, monospace; }
.trk-head label { color: var(--muted); font-size: 11px; display: inline-flex; gap: 3px; align-items: center; }
.trk-head input.trk-name { width: 180px; }
.trk-head input.trk-num { width: 52px; }
.trk-row { display: grid; grid-template-columns: 42px minmax(70px, auto) 1fr; gap: 2px 6px; align-items: center; padding: 2px 0; border-bottom: 1px solid color-mix(in srgb, var(--rule) 50%, transparent); }
.trk-row .trk-n { color: var(--accent); font: 600 12px/1.4 ui-monospace, Menlo, Consolas, monospace; }
.trk-row .trk-d { color: var(--muted); font-size: 11px; white-space: nowrap; }
.trk-row .trk-b { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.trk-row input.trk-num { width: 44px; }
.trk-list { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; align-items: center; }
.trk-list .trk-d { color: var(--muted); font-size: 11px; }
.trk-note { color: var(--muted); font-size: 11px; margin: 4px 0; }
.trk-warn { color: var(--warn); font-size: 11px; margin: 4px 0; }
.dbg-panel button.trk-x { padding: 1px 5px; font-size: 11px; }
.dbg-panel button.trk-del:hover { color: var(--bad); border-color: var(--bad); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The track editor's list, handed to the debug menu for `track`. */
export class TrackList implements DebugListSource {
  readonly label = 'Gates';
  private readonly deps: TrackListDeps;

  constructor(deps: TrackListDeps) {
    this.deps = deps;
    if (!document.getElementById('track-list-style')) {
      const style = document.createElement('style');
      style.id = 'track-list-style';
      style.textContent = TRACK_LIST_CSS;
      document.head.appendChild(style);
    }
  }

  draw(into: HTMLElement, say: (text: string, tone: '' | 'ok' | 'bad' | 'warn') => void, redraw: () => void): void {
    const m = this.deps.model();
    const run = (o: TrackListAct) => {
      say(`track(${JSON.stringify(o)}) …`, '');
      Promise.resolve(this.deps.act(o))
        .then((words) => {
          say(words, /refus|not |no |cannot|could not|fail/i.test(words) ? 'warn' : 'ok');
          redraw();
        })
        .catch((err: unknown) => {
          say(err instanceof Error ? err.message : String(err), 'bad');
          redraw();
        });
    };
    const btn = (text: string, title: string, o: TrackListAct, cls = 'trk-x'): HTMLButtonElement => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', () => run(o));
      return b;
    };
    into.append(el('div', 'trk-note', `${m.file}${m.problem ? `: ${m.problem}` : ''}`));
    if (!m.held) {
      // No track in hand: this world's tracks, and a new one begun where you ride.
      const list = el('div', 'trk-list');
      for (const t of m.tracks) {
        list.append(el('div', 'trk-d', `${t.id} · ${t.name} · ${t.kind}${t.kind === 'circuit' ? ` ×${t.laps}` : ''} · ${t.gates} gates · ${(t.length / 1000).toFixed(2)} km`));
        const b = el('span', 'trk-b');
        b.append(btn('Edit', 'take it in hand to edit its gates', { edit: t.id }), btn('Go to', 'stand at its grid, on what you ride', { go: t.id }), btn('Start', 'run it on what you ride', { start: t.id }), btn('Check', 'what stands in its corridor', { check: t.id }));
        list.append(b);
      }
      if (!m.tracks.length) into.append(el('div', 'trk-note', 'No track on this world yet.'));
      into.append(list);
      const begin = el('div', 'trk-head');
      const id = el('input', 'trk-name');
      id.placeholder = 'new track id: a-z, 0-9, _ and -';
      id.spellcheck = false;
      const go = el('button', 'trk-x', 'Begin here');
      go.type = 'button';
      go.title = 'a new track: its grid where you ride now; then Numpad0 drops a gate where you ride, facing your travel';
      go.addEventListener('click', () => run({ begin: id.value.trim() }));
      begin.append(id, go);
      into.append(begin);
      return;
    }
    const h = m.held;
    const head = el('div', 'trk-head');
    head.append(el('b', '', `${h.id}${h.unsaved ? ' (not saved)' : ''}`));
    const name = el('input', 'trk-name');
    name.value = h.name;
    name.title = 'its name';
    name.addEventListener('change', () => run({ set: { name: name.value } }));
    const kind = el('select');
    for (const k of ['circuit', 'sprint']) {
      const o = el('option', '', k);
      o.value = k;
      o.selected = k === h.kind;
      kind.append(o);
    }
    kind.addEventListener('change', () => run({ set: { kind: kind.value } }));
    const laps = el('input', 'trk-num');
    laps.type = 'number';
    laps.value = String(h.laps);
    laps.title = 'laps of a circuit';
    laps.addEventListener('change', () => run({ set: { laps: Number(laps.value) } }));
    const clear = el('input', 'trk-num');
    clear.type = 'number';
    clear.value = String(h.clear);
    clear.title = 'metres of plants kept off either side of the line (32 at most)';
    clear.addEventListener('change', () => run({ set: { clear: Number(clear.value) } }));
    const kinds = el('span');
    for (const [k, word] of [['podracer', 'pods'], ['speederbike', 'bikes']] as const) {
      const l = el('label');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = h.for.includes(k);
      c.addEventListener('change', () => {
        const want = new Set(h.for);
        if (c.checked) want.add(k);
        else want.delete(k);
        run({ set: { for: [...want] } });
      });
      l.append(c, document.createTextNode(word));
      kinds.append(l);
    }
    const lapsL = el('label');
    lapsL.append(document.createTextNode('laps'), laps);
    const clearL = el('label');
    clearL.append(document.createTextNode('clear'), clear);
    head.append(name, kind, lapsL, clearL, kinds, btn('Save', `write it into ${m.file} (the first save this session asks twice)`, { save: true }), btn('Grid here', 'its grid where you ride, facing your travel', { grid: 'here' }), btn('Go to grid', 'stand at its grid', { go: h.id }), btn('Let go', 'put it down without saving', { drop: true }));
    into.append(head);
    if (!h.gates.length) into.append(el('div', 'trk-note', 'No gate yet: Numpad0 drops one where you ride, facing your travel, or Insert after below.'));
    const step = this.deps.nudge();
    h.gates.forEach((g, i) => {
      const row = el('div', 'trk-row');
      row.append(el('span', 'trk-n', `#${i}`), el('span', 'trk-d', `${Math.round(g.from)} m on · ${Math.round(g.away)} m off`));
      const b = el('span', 'trk-b');
      const w = el('input', 'trk-num');
      w.type = 'number';
      w.value = String(g.w);
      w.title = 'width (m)';
      w.addEventListener('change', () => run({ gate: i, size: { w: Number(w.value) } }));
      const hh = el('input', 'trk-num');
      hh.type = 'number';
      hh.value = String(g.h);
      hh.title = 'height (m)';
      hh.addEventListener('change', () => run({ gate: i, size: { h: Number(hh.value) } }));
      b.append(
        btn('Go to', 'stand at it, facing through it', { gate: i, go: true }),
        btn('Here', 'move it to where you ride, facing your travel', { gate: i, here: true }),
        btn('Insert after', 'a new gate where you ride, after this one', { gate: i, insert: true }),
        btn('◀', `${step.m} m to the left`, { gate: i, move: { x: -step.m } }),
        btn('▶', `${step.m} m to the right`, { gate: i, move: { x: step.m } }),
        btn('▲', `${step.m} m ahead`, { gate: i, move: { z: step.m } }),
        btn('▼', `${step.m} m back`, { gate: i, move: { z: -step.m } }),
        btn('↑', `${step.m} m up`, { gate: i, move: { y: step.m } }),
        btn('↓', `${step.m} m down`, { gate: i, move: { y: -step.m } }),
        btn('⟲', `turned ${step.deg}° to the left`, { gate: i, move: { yaw: step.deg } }),
        btn('⟳', `turned ${step.deg}° to the right`, { gate: i, move: { yaw: -step.deg } }),
        w,
        hh,
        btn('Delete', 'take this gate out', { gate: i, delete: true }, 'trk-x trk-del'),
      );
      row.append(b);
      into.append(row);
    });
  }
}
