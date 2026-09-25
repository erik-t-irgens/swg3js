// The travel terminal: the window that stands in a starport and sells a ticket.
//
// It is the game's own arrangement rather than a list of places to jump to. A terminal shows **this
// world's** ports on this world's own map, each one selectable, with the fare from where you are
// standing; and it has a galaxy side, where a world is picked first and then a port on that world,
// before the fare is confirmed. Nothing travels when a ticket is bought: a ticket is bought at the
// terminal and handed in at the collector outside, when a shuttle is there.
//
// The map is the world's own picture with the ports dotted on it as a share of the picture, which is
// exactly how the galaxy map's own thumbnails place theirs -- so the picture's size on the panel
// does not matter and no canvas or WebGL is involved at all.
//
// It knows nothing about credits, clocks, worlds or shuttles: it says what was picked and what was
// pressed. Every colour on it is one of the eighteen.

import { escapeHtml } from './catalogue';

/** One port a terminal can sell a ticket to. */
export interface TerminalPort {
  /** What to call it: the game's own name for the place. */
  name: string;
  /** Its place in the **destination world's** own map frame, for the dot. */
  x: number;
  z: number;
  kind: 'starport' | 'shuttleport';
  /** What a ticket there costs from where the player is standing. */
  price: number;
  /** In words, for the panel. */
  fare: string;
  /** How far off it is, in words; empty for another world. */
  away: string;
  /** Why it cannot be bought, or empty. */
  why: string;
}

/** One world a terminal can sell a ticket to. */
export interface TerminalWorld {
  /** The pack id, which is what the game is told. */
  pack: string;
  name: string;
  price: number;
  fare: string;
}

export interface TerminalModel {
  /** What the terminal calls itself: the port it stands in. */
  title: string;
  /** Which side is showing. */
  stage: 'here' | 'worlds' | 'there';
  /** The world whose ports are shown: this one on `here`, the picked one on `there`. */
  mapUrl: string | null;
  /** How wide a ground that picture covers, metres. */
  mapWidth: number;
  ports: TerminalPort[];
  worlds: TerminalWorld[];
  /** The world picked on the galaxy side, for the heading. */
  picked: string;
  /** What the player has to spend, in words. */
  credits: string;
  /** A line under everything: what the last press did, or what is wrong. */
  note: string;
  /** A ticket already held, in words, or empty. */
  ticket: string;
}

const TERMINAL_CSS = `
#terminal .ship-panel { width: min(880px, 96vw); }
#terminal .terminal-body { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 12px; padding: 8px 14px 12px; min-height: 0; }
#terminal .terminal-map { position: relative; align-self: start; border: 1px solid var(--panel-border); border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--void) 40%, transparent); aspect-ratio: 1 / 1; }
#terminal .terminal-map img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0.8; }
#terminal .terminal-map .none { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--muted); text-align: center; padding: 0 20px; }
#terminal .dot { position: absolute; transform: translate(-50%, -50%); width: 13px; height: 13px; padding: 0; border-radius: 50%; border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 45%, transparent); cursor: pointer; }
#terminal .dot.star { border-radius: 2px; width: 12px; height: 12px; }
#terminal .dot.on { border-color: var(--good); background: var(--good); }
#terminal .dot:hover { border-color: var(--ink); }
#terminal .terminal-side { min-height: 0; display: flex; flex-direction: column; gap: 6px; }
#terminal .terminal-list { min-height: 0; max-height: 40vh; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
#terminal .terminal-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: baseline; padding: 5px 8px; border: 1px solid var(--panel-border); border-radius: 3px; cursor: pointer; font-size: 12px; color: var(--text); }
#terminal .terminal-row:hover { border-color: var(--edge); }
#terminal .terminal-row.on { border-color: var(--good); background: color-mix(in srgb, var(--good) 12%, transparent); }
#terminal .terminal-row.cannot { color: var(--muted); }
#terminal .terminal-row .fare { font-size: 11px; color: var(--muted); }
#terminal .terminal-note { font-size: 11px; color: var(--muted); min-height: 1.3em; }
#terminal .terminal-note.bad { color: var(--warn); }
#terminal .terminal-credits { font-size: 11px; color: var(--accent); letter-spacing: 0.04em; }
#terminal .terminal-ticket { font-size: 11px; color: var(--good); }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = TERMINAL_CSS;
  document.head.appendChild(style);
}

export class TerminalUi {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  /** A port picked, by its name. */
  onPort: (name: string) => void = () => {};
  /** A world picked on the galaxy side, by its pack. */
  onWorld: (pack: string) => void = () => {};
  /** Which side to show. */
  onStage: (stage: 'here' | 'worlds') => void = () => {};
  /** Buy what is picked. */
  onBuy: () => void = () => {};

  private model: TerminalModel | null = null;
  private pickedPort = '';

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'terminal';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel">
        <div class="ship-header">
          <h2>Travel</h2>
          <span class="ship-title"></span>
          <button class="close">Close (Esc)</button>
        </div>
        <div class="terminal-body">
          <div class="terminal-map"></div>
          <div class="terminal-side"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Which port is picked, for whoever is going to sell it. */
  get picked(): string {
    return this.pickedPort;
  }

  show(model: TerminalModel): void {
    this.model = model;
    if (!model.ports.some((p) => p.name === this.pickedPort)) this.pickedPort = '';
    this.draw();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.pickedPort = '';
  }

  private draw(): void {
    const m = this.model;
    if (!m) return;
    this.root.querySelector('.ship-title')!.textContent = m.title;
    const map = this.root.querySelector<HTMLElement>('.terminal-map')!;
    const side = this.root.querySelector<HTMLElement>('.terminal-side')!;
    // The map, with the ports dotted on it as a share of the picture: the same placing the galaxy
    // map's own thumbnails use, so the size on the panel does not matter.
    if (m.stage === 'worlds' || !m.mapUrl) {
      map.innerHTML = `<div class="none">${escapeHtml(m.stage === 'worlds' ? 'pick a world, then a port on it' : 'this world has no map converted: the list beside is the whole of it')}</div>`;
    } else {
      const e = m.mapWidth;
      map.innerHTML =
        `<img src="${escapeHtml(m.mapUrl)}" alt="">` +
        m.ports
          .map((p) => {
            const left = (p.x + e / 2) / e;
            const top = (e / 2 - p.z) / e;
            if (!(left >= 0 && left <= 1 && top >= 0 && top <= 1)) return '';
            return `<button type="button" class="dot ${p.kind === 'starport' ? 'star' : ''}${p.name === this.pickedPort ? ' on' : ''}" style="left:${(left * 100).toFixed(2)}%;top:${(top * 100).toFixed(2)}%" data-port="${escapeHtml(p.name)}" title="${escapeHtml(`${p.name} — ${p.fare}`)}"></button>`;
          })
          .join('');
    }
    const rows =
      m.stage === 'worlds'
        ? m.worlds.map((w) => `<div class="terminal-row" data-world="${escapeHtml(w.pack)}"><span>${escapeHtml(w.name)}</span><span class="fare">${escapeHtml(w.fare)}</span></div>`).join('')
        : m.ports
            .map(
              (p) =>
                `<div class="terminal-row${p.name === this.pickedPort ? ' on' : ''}${p.why ? ' cannot' : ''}" data-port="${escapeHtml(p.name)}"><span>${escapeHtml(p.name)}</span><span class="fare">${escapeHtml(p.why || p.fare)}${p.away ? ` · ${escapeHtml(p.away)}` : ''}</span></div>`,
            )
            .join('');
    const picked = m.ports.find((p) => p.name === this.pickedPort) ?? null;
    side.innerHTML =
      `<div class="tabs"><button class="tab${m.stage === 'here' ? ' on' : ''}" data-stage="here">This world</button><button class="tab${m.stage !== 'here' ? ' on' : ''}" data-stage="worlds">Galaxy</button></div>` +
      `${m.stage === 'there' ? `<p class="terminal-note">${escapeHtml(m.picked)}: pick a port</p>` : ''}` +
      `<div class="terminal-list">${rows || '<p class="terminal-note">nowhere to go from here</p>'}</div>` +
      `<div class="terminal-credits">${escapeHtml(m.credits)}</div>` +
      `${m.ticket ? `<div class="terminal-ticket">${escapeHtml(m.ticket)}</div>` : ''}` +
      `<div class="terminal-note${m.note && !picked ? ' bad' : ''}">${escapeHtml(m.note)}</div>` +
      `<div class="ship-action"><button class="buy"${picked && !picked.why ? '' : ' disabled'}>${picked ? `Purchase — ${escapeHtml(picked.fare)}` : 'Purchase'}</button></div>` +
      `<p class="menu-hint">A ticket is taken at the collector outside, when a shuttle has landed.</p>`;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-port]')) {
      b.addEventListener('click', () => {
        this.pickedPort = b.dataset.port!;
        this.onPort(this.pickedPort);
        this.draw();
      });
    }
    for (const b of side.querySelectorAll<HTMLElement>('[data-world]')) b.addEventListener('click', () => this.onWorld(b.dataset.world!));
    for (const b of side.querySelectorAll<HTMLElement>('[data-stage]')) b.addEventListener('click', () => this.onStage(b.dataset.stage as 'here' | 'worlds'));
    side.querySelector('.buy')?.addEventListener('click', () => this.onBuy());
  }
}
