// The Escape menu: resume, switch character, and the settings pages (the keys, with a primary
// and a secondary for every action, and the graphics, every knob the game has, applied live).
import { DEFAULT_BINDINGS, type Action, type Input } from '../core/input';
import { DEFAULT_SETTINGS, saveSettings, type Settings } from '../core/settings';

type Page = 'main' | 'controls' | 'graphics';

const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump (hold: Force jump)',
  crouch: 'Crouch (tap moving: roll)',
  prone: 'Lie prone',
  kneel: 'Kneel',
  walk: 'Walk (vehicle: boost)',
  attack: 'Attack / fire',
  altAttack: 'Rapid fire (blaster)',
  block: 'Block (saber)',
  saberThrow: 'Throw saber / kick',
  saberToggle: 'Saber on and off',
  saberStyle: 'Next saber style / blaster',
  mount: 'Mount, dismount, elevator',
  switchClass: 'Switch class',
  map: 'Galaxy map',
  help: 'Help',
  inventory: 'Inventory',
  spawner: 'Spawner',
  freeLook: 'Free look (riding)',
  noclip: 'Noclip fly',
  noclipFaster: 'Noclip faster',
  noclipSlower: 'Noclip slower',
  flashlight: 'Flashlight',
  fastForward: 'Fast-forward the day',
  slot1: 'Slot 1',
  slot2: 'Slot 2',
  slot3: 'Slot 3',
  slot4: 'Slot 4',
};

/** "KeyW" reads as "W", "Mouse0" as "Left mouse", "ControlLeft" as "Left Ctrl". */
export function keyName(code: string): string {
  if (!code) return '—';
  const mouse: Record<string, string> = { Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' };
  if (mouse[code]) return mouse[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  m = /^(Control|Shift|Alt|Meta)(Left|Right)$/.exec(code);
  if (m) return `${m[2]} ${m[1] === 'Control' ? 'Ctrl' : m[1]}`;
  m = /^Arrow(.+)$/.exec(code);
  if (m) return `${m[1]} arrow`;
  const named: Record<string, string> = { Space: 'Space', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps Lock' };
  return named[code] ?? code;
}

interface Knob {
  key: keyof Settings;
  label: string;
  hint: string;
  kind: 'range' | 'toggle' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  format?: (v: number) => string;
}

const GRAPHICS: { title: string; knobs: Knob[] }[] = [
  {
    title: 'Picture',
    knobs: [
      { key: 'renderScale', label: 'Render scale', hint: 'Resolution over the screen\'s. Below 1 is the biggest saving there is; above 1 sharpens at a steep cost.', kind: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
      { key: 'fov', label: 'Field of view', hint: 'Degrees, upright. Aiming a blaster narrows it by the same amount as before.', kind: 'range', min: 45, max: 100, step: 1, format: (v) => `${v}°` },
      { key: 'exposure', label: 'Exposure', hint: 'How bright the picture comes out of tone mapping.', kind: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
      { key: 'fog', label: 'Fog', hint: 'Over the planet\'s own fog: thinner shows farther, thicker hides more (and what is hidden still draws).', kind: 'range', min: 0.2, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)}×` },
    ],
  },
  {
    title: 'Shadows',
    knobs: [
      { key: 'shadows', label: 'Shadows', hint: 'The sun\'s cascaded shadow maps. Off is the second biggest saving.', kind: 'toggle' },
      { key: 'shadowMapSize', label: 'Shadow resolution', hint: 'The edge of each cascade\'s map. Each step doubles the memory; 4096 is crisp, 1024 is cheap.', kind: 'select', options: [{ value: 1024, label: '1024' }, { value: 2048, label: '2048' }, { value: 4096, label: '4096' }] },
      { key: 'shadowDistance', label: 'Shadow distance', hint: 'How far the cascades reach. Shorter is cheaper and sharper up close.', kind: 'range', min: 80, max: 800, step: 20, format: (v) => `${v} m` },
      { key: 'shadowSoftness', label: 'Shadow softness', hint: 'Blur in map texels: 1 crisp, 3 soft.', kind: 'range', min: 1, max: 3, step: 0.1, format: (v) => v.toFixed(1) },
      { key: 'shadowCasterRadius', label: 'Smallest shadow caster', hint: 'Placed objects at least this big (radius, metres) cast. Larger leaves out the small props, saving a draw call per cascade each.', kind: 'range', min: 0.5, max: 8, step: 0.1, format: (v) => `${v.toFixed(1)} m` },
    ],
  },
  {
    title: 'Distance and detail',
    knobs: [
      { key: 'objectReach', label: 'Object reach', hint: 'How far buildings and props load, over the game\'s own ranges. Less loads less and streams faster.', kind: 'range', min: 0.4, max: 1.6, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
      { key: 'terrainRadius', label: 'Ground detail radius', hint: 'Detailed ground chunks each way around you. The coarse far ground continues past them.', kind: 'range', min: 3, max: 9, step: 1, format: (v) => `${v} chunks` },
      { key: 'farRadius', label: 'Far ground radius', hint: 'Coarse far tiles each way: the horizon.', kind: 'range', min: 3, max: 9, step: 1, format: (v) => `${v} tiles` },
    ],
  },
];

const CONTROLS: Knob[] = [
  { key: 'sensitivity', label: 'Mouse sensitivity', hint: 'Look speed; 1 is the game\'s own.', kind: 'range', min: 0.2, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
  { key: 'invertY', label: 'Invert mouse Y', hint: 'Push forward to look down.', kind: 'toggle' },
];

export class Menu {
  readonly root: HTMLElement;
  private page: Page = 'main';
  private capturing: { action: Action; slot: number; button: HTMLButtonElement } | null = null;
  onResume: () => void = () => {};
  onSwitchCharacter: () => void = () => {};
  /** A setting moved: the game applies it. */
  onSetting: (key: keyof Settings, value: number | boolean) => void = () => {};

  constructor(parent: HTMLElement, private readonly input: Input, private readonly settings: Settings) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="menu-panel">
        <nav class="menu-nav">
          <h1>SWG3JS</h1>
          <button data-page="main" class="on">Menu</button>
          <button data-page="controls">Controls</button>
          <button data-page="graphics">Graphics</button>
          <div class="menu-spacer"></div>
          <button class="resume-nav">Resume <b>Esc</b></button>
        </nav>
        <div class="menu-body"></div>
      </div>`;
    parent.appendChild(this.root);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.menu-nav button[data-page]')) {
      b.addEventListener('click', () => this.showPage(b.dataset.page as Page));
    }
    this.root.querySelector('.resume-nav')!.addEventListener('click', () => this.onResume());
    // Key capture for the bindings: the next key or mouse button pressed is the one.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('mousedown', (e) => this.onMouse(e), true);
    window.addEventListener('contextmenu', (e) => {
      if (this.capturing) e.preventDefault();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(page: Page = 'main'): void {
    this.root.classList.remove('hidden');
    this.showPage(page);
  }

  hide(): void {
    this.cancelCapture();
    this.root.classList.add('hidden');
  }

  private showPage(page: Page): void {
    this.cancelCapture();
    this.page = page;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.menu-nav button[data-page]')) b.classList.toggle('on', b.dataset.page === page);
    const body = this.root.querySelector<HTMLElement>('.menu-body')!;
    if (page === 'main') {
      body.innerHTML = `
        <h2>Paused</h2>
        <div class="menu-actions">
          <button class="big resume">Resume</button>
          <button class="big switch">Switch character</button>
          <button class="big" data-page="controls">Controls</button>
          <button class="big" data-page="graphics">Graphics</button>
        </div>
        <p class="menu-hint">The world keeps turning behind this; the character stands still. Settings are kept in this browser.</p>`;
      body.querySelector('.resume')!.addEventListener('click', () => this.onResume());
      body.querySelector('.switch')!.addEventListener('click', () => this.onSwitchCharacter());
      for (const b of body.querySelectorAll<HTMLButtonElement>('button[data-page]')) b.addEventListener('click', () => this.showPage(b.dataset.page as Page));
    } else if (page === 'controls') {
      body.innerHTML = `<h2>Controls</h2>${this.knobRows(CONTROLS)}<h3>Keys <span>click a key to change it · Backspace clears it · Esc keeps it</span></h3><div class="keys">${this.keyRows()}</div><div class="menu-actions"><button class="reset-keys">Reset keys to defaults</button></div>`;
      this.wireKnobs(body);
      this.wireKeys(body);
      body.querySelector('.reset-keys')!.addEventListener('click', () => {
        this.input.resetBindings();
        this.showPage('controls');
      });
    } else {
      body.innerHTML = `<h2>Graphics</h2>${GRAPHICS.map((g) => `<h3>${g.title}</h3>${this.knobRows(g.knobs)}`).join('')}<div class="menu-actions"><button class="reset-gfx">Reset graphics to defaults</button></div>`;
      this.wireKnobs(body);
      body.querySelector('.reset-gfx')!.addEventListener('click', () => {
        for (const g of GRAPHICS) for (const k of g.knobs) this.setValue(k.key, DEFAULT_SETTINGS[k.key]);
        this.showPage('graphics');
      });
    }
  }

  private knobRows(knobs: Knob[]): string {
    return knobs
      .map((k) => {
        const v = this.settings[k.key];
        let control: string;
        if (k.kind === 'toggle') control = `<label class="switch"><input type="checkbox" data-key="${k.key}"${v ? ' checked' : ''} /><span></span></label>`;
        else if (k.kind === 'select') control = `<select data-key="${k.key}">${k.options!.map((o) => `<option value="${o.value}"${o.value === v ? ' selected' : ''}>${o.label}</option>`).join('')}</select>`;
        else control = `<input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" /><span class="value">${k.format ? k.format(v as number) : String(v)}</span>`;
        return `<div class="knob"><div class="knob-label">${k.label}<small>${k.hint}</small></div><div class="knob-control">${control}</div></div>`;
      })
      .join('');
  }

  private wireKnobs(body: HTMLElement): void {
    const all = [...CONTROLS, ...GRAPHICS.flatMap((g) => g.knobs)];
    for (const el of body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) {
      const knob = all.find((k) => k.key === el.dataset.key)!;
      const on = () => {
        const value = knob.kind === 'toggle' ? (el as HTMLInputElement).checked : Number(el.value);
        this.setValue(knob.key, value);
        const out = el.parentElement?.querySelector<HTMLElement>('.value');
        if (out && typeof value === 'number') out.textContent = knob.format ? knob.format(value) : String(value);
      };
      el.addEventListener(knob.kind === 'range' ? 'input' : 'change', on);
    }
  }

  private setValue(key: keyof Settings, value: number | boolean): void {
    (this.settings as unknown as Record<string, unknown>)[key] = value;
    saveSettings(this.settings);
    this.onSetting(key, value);
  }

  private keyRows(): string {
    return (Object.keys(DEFAULT_BINDINGS) as Action[])
      .map((a) => {
        const codes = this.input.bindings[a];
        const cell = (slot: number) => `<button class="key${codes[slot] ? '' : ' empty'}" data-action="${a}" data-slot="${slot}">${keyName(codes[slot] ?? '')}</button>`;
        const changed = codes.join() !== DEFAULT_BINDINGS[a].join();
        return `<div class="key-row${changed ? ' changed' : ''}"><span class="key-label">${ACTION_LABELS[a]}</span>${cell(0)}${cell(1)}</div>`;
      })
      .join('');
  }

  private wireKeys(body: HTMLElement): void {
    for (const b of body.querySelectorAll<HTMLButtonElement>('button.key')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cancelCapture();
        this.capturing = { action: b.dataset.action as Action, slot: Number(b.dataset.slot), button: b };
        b.classList.add('capturing');
        b.textContent = 'press a key…';
      });
    }
  }

  private cancelCapture(): void {
    const c = this.capturing;
    if (!c) return;
    this.capturing = null;
    c.button.classList.remove('capturing');
    c.button.textContent = keyName(this.input.bindings[c.action][c.slot] ?? '');
  }

  private assign(code: string | null): void {
    const c = this.capturing;
    if (!c) return;
    this.capturing = null;
    const codes = [...this.input.bindings[c.action]];
    // Two slots on show: the primary and the secondary. Whatever else the default carried (a
    // third key) is kept behind them until the row is edited to two.
    const kept = [codes[0] ?? '', codes[1] ?? ''];
    kept[c.slot] = code ?? '';
    // A key already on another action moves here rather than doing two things.
    if (code) {
      for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
        if (a === c.action) continue;
        const other = this.input.bindings[a];
        if (other.includes(code)) this.input.bind(a, other.filter((x) => x !== code));
      }
    }
    this.input.bind(c.action, kept.filter(Boolean));
    this.showPage('controls');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') this.cancelCapture();
    else if (e.code === 'Backspace' || e.code === 'Delete') this.assign(null);
    else this.assign(e.code);
  }

  private onMouse(e: MouseEvent): void {
    if (!this.capturing) return;
    // The click that started the capture is over; any button after it is the choice.
    if (e.target === this.capturing.button) return;
    e.preventDefault();
    e.stopPropagation();
    this.assign(`Mouse${e.button}`);
  }
}
