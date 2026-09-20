// The Escape menu: resume, switch character, and the settings pages (the keys, with a primary
// and a secondary for every action, and the graphics, every knob the game has, applied live).
import { DEFAULT_BINDINGS, type Action, type Input } from '../core/input';
import { DEFAULT_SETTINGS, saveSettings, type Settings } from '../core/settings';
import { FX_KNOBS, fxPassDef, fxProductDef } from '../core/fxRegistry.ts';
import { INTERFACE, notifyBindingsChanged, type Knob } from './hudPage.ts';

// The Interface page's knobs and the rebind note live in `hudPage.ts` so that a node test can read
// them without a browser; they are theirs to change and everything else's to import from here.
export { onBindingsChanged, notifyBindingsChanged } from './hudPage.ts';

type Page = 'main' | 'controls' | 'graphics' | 'interface' | 'sound' | 'emotes' | 'multiplayer';

/** What the multiplayer page needs from the game: the relay's address and state, and who is here. */
export interface NetSource {
  url(): string;
  status(): string;
  peers(): string[];
  connect(url: string): void;
  disconnect(): void;
}

/** What the emotes page needs from the game: the rig's emote clips, and the wheel's slots to read and write. */
export interface EmoteSource {
  choices(): { clip: string; label: string }[];
  slots(): (string | null)[];
  set(index: number, clip: string | null): void;
}

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
  ship: 'Ship menu (in a ship)',
  switchClass: 'Switch class',
  map: 'Galaxy map',
  help: 'Help',
  inventory: 'Inventory',
  spawner: 'Spawner',
  freeLook: 'Free look (riding)',
  target: 'Next target (ship)',
  noclip: 'Noclip fly',
  noclipFaster: 'Noclip faster',
  noclipSlower: 'Noclip slower',
  flashlight: 'Flashlight',
  fastForward: 'Fast-forward the day',
  altFire: 'Alternate fire (guns)',
  slot1: 'Slot 1',
  slot2: 'Slot 2',
  slot3: 'Slot 3',
  slot4: 'Slot 4',
  slot5: 'Slot 5',
  slot6: 'Slot 6',
  emoteWheel: 'Emote wheel (hold)',
  emote1: 'Emote 1',
  emote2: 'Emote 2',
  emote3: 'Emote 3',
  emote4: 'Emote 4',
  brake: 'Brake (adrift in space)',
  rollLeft: 'Roll left (adrift in space)',
  rollRight: 'Roll right (adrift in space)',
  wings: 'Open and close the wings (flying a ship)',
};

/**
 * The two tables `keyName` looks a code up in. They are out here rather than inside it because the
 * name of a key is asked for on the frame path, and a table built inside the call is two objects
 * built again every time it is asked.
 */
const MOUSE_NAMES: Record<string, string> = { Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' };
const KEY_NAMES: Record<string, string> = { Space: 'Space', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps Lock' };

/** "KeyW" reads as "W", "Mouse0" as "Left mouse", "ControlLeft" as "Left Ctrl". */
export function keyName(code: string): string {
  if (!code) return '—';
  if (MOUSE_NAMES[code]) return MOUSE_NAMES[code];
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
  return KEY_NAMES[code] ?? code;
}

const GRAPHICS: { title: string; knobs: readonly Knob[] }[] = [
  {
    title: 'Picture',
    knobs: [
      { key: 'renderScale', label: 'Render scale', hint: 'Resolution over the screen\'s. Below 1 is the biggest saving there is; above 1 sharpens at a steep cost.', kind: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
      { key: 'fov', label: 'Field of view', hint: 'Degrees, upright. Aiming a blaster narrows it by the same amount as before.', kind: 'range', min: 45, max: 100, step: 1, format: (v) => `${v}°` },
      { key: 'exposure', label: 'Exposure', hint: 'How bright the picture comes out of tone mapping.', kind: 'range', min: 0.5, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
      { key: 'normalStrength', label: 'Normal map strength', hint: 'How strongly the surface detail maps bend the lighting: 0 is flat, 1 as the game has them, 2 doubled.', kind: 'range', min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2) },
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
    // Straight from the effects registry, so a knob and its setting can never drift apart. An
    // effect that is not written yet keeps its key but hides its knob.
    title: 'Effects',
    knobs: FX_KNOBS.filter((k) => (k.pass === null || fxPassDef(k.pass).live) && (!k.product || fxProductDef(k.product).live)),
  },
  {
    // Scene content, not an effect: it works with the effects off, and nothing here recompiles a shader.
    title: 'Weather',
    knobs: [
      { key: 'weather', label: 'Weather', kind: 'toggle', requires: [], hint: 'Rain, dust storms and snow where and when the planet has them, from the game\'s own environment rows. It changes every so often, the same for everyone at the same moment. Off, the sky still follows the area you stand in.' },
      { key: 'weatherDensity', label: 'Rain and dust density', kind: 'range', min: 0.25, max: 1.5, step: 0.05, format: (v) => `${v.toFixed(2)}×`, requires: ['weather'], hint: 'How much falls around you: 1 as the game has it. Heavy rain seen from below is the costliest thing the weather draws.' },
      { key: 'rainOpacity', label: 'Rain opacity', kind: 'range', min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, requires: ['weather'], hint: 'How solid the falling rain looks. 100% is the game\'s own sheets, which hide a lot of the view in a heavy storm; lower lets the world show through. Dust and snow are not changed.' },
      { key: 'wetSurfaces', label: 'Wet ground', kind: 'toggle', requires: ['weather'], hint: 'Rain darkens and glosses what it falls on, leaves puddles with rings, and dries slowly after. Snow settles on what faces up. Nothing under a roof gets wet.' },
      { key: 'weatherShadows', label: 'Storms dim shadows', kind: 'toggle', requires: ['weather'], hint: 'Where the game\'s storm rows turn shadows off, they fade out as the storm comes. Clear weather always keeps them.' },
      { key: 'weatherForce', label: 'Hold the weather', kind: 'select', requires: ['weather'], options: [{ value: -1, label: 'As the planet has it' }, { value: 0, label: 'Clear' }, { value: 1, label: 'Light' }, { value: 2, label: 'Moderate' }, { value: 3, label: 'Heavy' }, { value: 4, label: 'Storm' }], hint: 'Holds one level of the area\'s own rows (Mustafar has three). Others on the relay keep the shared schedule; the corner of the screen says it is held.' },
      { key: 'weatherKind', label: 'Weather kind', kind: 'select', requires: ['weather'], options: [{ value: 0, label: 'The area\'s own' }, { value: 1, label: 'Rain' }, { value: 2, label: 'Dust storm' }, { value: 3, label: 'Snow' }], hint: 'Falls this kind instead of the area\'s own, at the same level: rain on Tatooine, snow anywhere. The sky and fog stay the area\'s own.' },
      { key: 'lifeDay', label: 'Life Day', kind: 'select', requires: ['weather'], options: [{ value: -1, label: 'In season (15 Dec to 5 Jan)' }, { value: 1, label: 'Always' }, { value: 0, label: 'Never' }], hint: 'The Life Day areas (a snowy corner of Corellia around Doaba Guerfel) with their own sky and snow.' },
    ],
  },
  {
    // Space: scene content again, and nothing here recompiles a shader.
    title: 'Space',
    knobs: [
      { key: 'nebulaLightningDamage', label: 'Nebula lightning damages ships', kind: 'toggle', hint: 'A strike inside a nebula takes shields and armour off the ship it hits, at a quarter of the numbers the game\'s own tables carry. Off, lightning only flashes.' },
    ],
  },
  {
    title: 'Distance and detail',
    knobs: [
      { key: 'objectReach', label: 'Object reach', hint: 'How far buildings and props load, over the game\'s own ranges. Less loads less and streams faster.', kind: 'range', min: 0.4, max: 1.6, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
      { key: 'terrainRadius', label: 'Ground detail radius', hint: 'Detailed ground chunks each way around you. The coarse far ground continues past them.', kind: 'range', min: 3, max: 9, step: 1, format: (v) => `${v} chunks` },
      { key: 'farRadius', label: 'Far ground radius', hint: 'Coarse far tiles each way: the horizon.', kind: 'range', min: 3, max: 9, step: 1, format: (v) => `${v} tiles` },
      { key: 'mobileCap', label: 'Spawned creatures and NPCs', hint: 'How many the spawner may have out at once. Each one is a body, a skeleton and its animation.', kind: 'range', min: 5, max: 150, step: 5, format: (v) => `${v}` },
      { key: 'mobileAnimRange', label: 'Creature animation range', hint: 'Past this they hold their pose until they come nearer. Their shadows and their movement carry on.', kind: 'range', min: 60, max: 400, step: 20, format: (v) => `${v} m` },
    ],
  },
];

/**
 * Sound. A master and a slider per layer, so the beds can be turned down without losing the feet,
 * and the switches are the things a player may simply not want at all. Sound starts on the first
 * click, which the browser requires; until then the beds keep their own clocks and come in where
 * they have reached.
 */
const SOUND: { title: string; knobs: readonly Knob[] }[] = [
  {
    title: 'Volume',
    knobs: [
      { key: 'soundMaster', label: 'Master', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, hint: 'Everything. At 0 the game is silent.' },
      { key: 'soundAmbience', label: 'Ambience', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'The area\'s own day and night beds, the rooms\' beds, and the sounds the game places in the world: crowds, cantina bands, fires, waterfalls, machinery.' },
      { key: 'soundEffects', label: 'Effects', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'Weapons, explosions, machines and things you use.' },
      { key: 'soundVoices', label: 'Creatures and voices', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'Creatures, people and droids, and your own emotes.' },
      { key: 'soundFootsteps', label: 'Footsteps', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'Feet on sand, rock, metal, wood, snow and water, yours and everyone else\'s.' },
      { key: 'soundVehicles', label: 'Vehicles and ships', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'Speeder and ship engines, and the sounds a ship makes around you.' },
      { key: 'soundInterface', label: 'Interface', kind: 'range', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, requires: ['soundMaster'], hint: 'The panels\' own clicks, from the game\'s own interface table. These never give way to a fight.' },
    ],
  },
  {
    title: 'How it sounds',
    knobs: [
      { key: 'soundHeadphones', label: 'Headphones', kind: 'toggle', hint: 'Places each sound around your head rather than across two speakers. It costs a little more, and it is worth it on headphones only.' },
      { key: 'soundRoomEcho', label: 'Room echo', kind: 'toggle', hint: 'A little echo indoors, stronger in the tall halls. The game marks which rooms are halls; how much echo they get is ours, so turn it off if it sounds wrong.' },
      { key: 'soundInBackground', label: 'Keep playing in the background', kind: 'toggle', hint: 'Off, the game falls silent when you switch to another tab and picks up where it was when you come back.' },
      { key: 'soundSabers', label: 'Lightsaber sounds', kind: 'choice', choices: [{ value: 'jka', label: 'Jedi Academy\'s' }, { value: 'swg', label: 'The game\'s own' }], hint: 'Which hums, ignitions and swings the blades use. Both are converted.' },
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
  onSetting: (key: keyof Settings, value: number | boolean | string) => void = () => {};
  /** A panel's own click, played by the game's interface sounds. */
  onUiSound: (action: 'panelOpen' | 'panelClose' | 'confirm' | 'select' | 'rollover' | 'increment') => void = () => {};

  /** The emotes page's source, given by the game once a character is up. */
  emotes: EmoteSource | null = null;
  /** The multiplayer page's source. */
  net: NetSource | null = null;

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
          <button data-page="interface">Interface</button>
          <button data-page="sound">Sound</button>
          <button data-page="emotes">Emotes</button>
          <button data-page="multiplayer">Multiplayer</button>
          <div class="menu-spacer"></div>
          <button class="resume-nav">Resume <b>Esc</b></button>
        </nav>
        <div class="menu-body"></div>
      </div>`;
    parent.appendChild(this.root);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.menu-nav button[data-page]')) {
      b.addEventListener('click', () => {
        this.onUiSound('select');
        this.showPage(b.dataset.page as Page);
      });
      b.addEventListener('pointerenter', () => this.onUiSound('rollover'));
    }
    this.root.querySelector('.resume-nav')!.addEventListener('click', () => {
      this.onUiSound('confirm');
      this.onResume();
    });
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
    const was = this.open;
    this.root.classList.remove('hidden');
    this.showPage(page);
    if (!was) this.onUiSound('panelOpen');
  }

  hide(): void {
    const was = this.open;
    this.cancelCapture();
    this.root.classList.add('hidden');
    if (was) this.onUiSound('panelClose');
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
          <button class="big" data-page="interface">Interface</button>
          <button class="big" data-page="sound">Sound</button>
          <button class="big" data-page="emotes">Emotes</button>
          <button class="big" data-page="multiplayer">Multiplayer</button>
        </div>
        <p class="menu-hint">The world keeps turning behind this; the character stands still. Settings are kept in this browser.</p>`;
      body.querySelector('.resume')!.addEventListener('click', () => {
        this.onUiSound('confirm');
        this.onResume();
      });
      body.querySelector('.switch')!.addEventListener('click', () => {
        this.onUiSound('confirm');
        this.onSwitchCharacter();
      });
      for (const b of body.querySelectorAll<HTMLButtonElement>('button[data-page]')) {
        b.addEventListener('click', () => {
          this.onUiSound('select');
          this.showPage(b.dataset.page as Page);
        });
      }
    } else if (page === 'controls') {
      body.innerHTML = `<h2>Controls</h2>${this.knobRows(CONTROLS)}<h3>Keys <span>click a key to change it · Backspace clears it · Esc keeps it</span></h3><div class="keys">${this.keyRows()}</div><div class="menu-actions"><button class="reset-keys">Reset keys to defaults</button></div>`;
      this.wireKnobs(body);
      this.wireKeys(body);
      body.querySelector('.reset-keys')!.addEventListener('click', () => {
        this.input.resetBindings();
        notifyBindingsChanged();
        this.showPage('controls');
      });
    } else if (page === 'multiplayer') {
      const net = this.net;
      const peers = net?.peers() ?? [];
      body.innerHTML = `<h2>Multiplayer</h2>
        <p class="menu-hint">A start: a relay passes everyone's place and pose to everyone else, and each player is shown as their own character where they stand, doing what they do. Each player's vehicle or ship is carried across with them on it. No combat between players yet, no bolts or damage across the relay, nothing kept on it. Run one with <code>node server/relay.mjs</code> (port 8787) and give its address here; <code>?server=ws://host:8787</code> in the page's address does the same.</p>
        <div class="knob"><div class="knob-label">Relay address<small>ws://host:8787, or wss:// behind a proxy with TLS</small></div><div class="knob-control"><input type="text" class="server" value="${(net?.url() ?? '').replace(/"/g, '&quot;')}" placeholder="ws://localhost:8787" spellcheck="false" /></div></div>
        <div class="menu-actions"><button class="connect">Connect</button><button class="disconnect">Disconnect</button><span class="menu-hint net-status">${net?.status() ?? 'off'}</span></div>
        <h3>Here <span>${peers.length} on this world</span></h3>${peers.length ? `<ul class="peer-list">${peers.map((n) => `<li>${n.replace(/</g, '&lt;')}</li>`).join('')}</ul>` : '<p class="menu-hint">Nobody else here.</p>'}`;
      const input = body.querySelector<HTMLInputElement>('.server')!;
      body.querySelector('.connect')!.addEventListener('click', () => {
        net?.connect(input.value.trim());
        window.setTimeout(() => this.showPage('multiplayer'), 600);
      });
      body.querySelector('.disconnect')!.addEventListener('click', () => {
        net?.disconnect();
        this.showPage('multiplayer');
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') body.querySelector<HTMLButtonElement>('.connect')!.click();
      });
    } else if (page === 'sound') {
      body.innerHTML = `<h2>Sound</h2><p class="menu-hint">Sound starts on your first click, as browsers require. Every sample, and every volume, pitch and gap inside it, is the game's own; how loudness falls off with distance, how many sounds play at once and the room echo are ours.</p>${SOUND.map((g) => `<h3>${g.title}</h3>${this.knobRows(g.knobs)}`).join('')}<div class="menu-actions"><button class="reset-sound">Reset sound to defaults</button></div>`;
      this.wireKnobs(body);
      body.querySelector('.reset-sound')!.addEventListener('click', () => {
        for (const g of SOUND) for (const k of g.knobs) this.setValue(k.key, DEFAULT_SETTINGS[k.key] as number | boolean | string);
        this.showPage('sound');
      });
    } else if (page === 'interface') {
      body.innerHTML = `<h2>Interface</h2><p class="menu-hint">None of the game's own interface is used: every line, arc, bar, square and glyph on the screen is drawn here, and every number on this page is ours. The keys a slot or an action shows are the keys you have bound, which you set under Controls.</p>${INTERFACE.map((g) => `<h3>${g.title}</h3>${this.knobRows(g.knobs)}`).join('')}<div class="menu-actions"><button class="reset-hud">Reset the display to defaults</button></div>`;
      this.wireKnobs(body);
      body.querySelector('.reset-hud')!.addEventListener('click', () => {
        for (const g of INTERFACE) for (const k of g.knobs) this.setValue(k.key, DEFAULT_SETTINGS[k.key] as number | boolean | string);
        this.showPage('interface');
      });
    } else if (page === 'emotes') {
      const src = this.emotes;
      if (!src) {
        body.innerHTML = '<h2>Emotes</h2><p class="menu-hint">No character is up yet.</p>';
        return;
      }
      const choices = src.choices();
      const slots = src.slots();
      body.innerHTML = `<h2>Emotes</h2><p class="menu-hint">Hold <b>${keyName(this.input.bindings.emoteWheel[0] ?? '')}</b> for the wheel and move the mouse to a slot; slots 1 to 4 also play on their own keys (the arrows). ${choices.length} emotes and dances in the rig.</p>${slots
        .map((clip, i) => `<div class="knob"><div class="knob-label">Slot ${i + 1}<small>${i < 4 ? `also ${keyName(this.input.bindings[`emote${i + 1}` as Action][0] ?? '')}` : 'wheel only'}</small></div><div class="knob-control"><select data-slot="${i}"><option value="">— empty —</option>${choices.map((c) => `<option value="${c.clip}"${c.clip === clip ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div></div>`)
        .join('')}`;
      for (const sel of body.querySelectorAll<HTMLSelectElement>('select[data-slot]')) sel.addEventListener('change', () => src.set(Number(sel.dataset.slot), sel.value || null));
    } else {
      body.innerHTML = `<h2>Graphics</h2>${GRAPHICS.map((g) => `<h3>${g.title}</h3>${this.knobRows(g.knobs)}`).join('')}<div class="menu-actions"><button class="reset-gfx">Reset graphics to defaults</button></div>`;
      this.wireKnobs(body);
      body.querySelector('.reset-gfx')!.addEventListener('click', () => {
        for (const g of GRAPHICS) for (const k of g.knobs) this.setValue(k.key, DEFAULT_SETTINGS[k.key]);
        this.showPage('graphics');
      });
    }
  }

  private knobRows(knobs: readonly Knob[]): string {
    return knobs
      .map((k) => {
        const v = this.settings[k.key];
        let control: string;
        if (k.kind === 'toggle') control = `<label class="switch"><input type="checkbox" data-key="${k.key}"${v ? ' checked' : ''} /><span></span></label>`;
        else if (k.kind === 'select') control = `<select data-key="${k.key}">${k.options!.map((o) => `<option value="${o.value}"${o.value === v ? ' selected' : ''}>${o.label}</option>`).join('')}</select>`;
        else if (k.kind === 'choice') control = `<select data-key="${k.key}">${k.choices!.map((o) => `<option value="${o.value}"${o.value === v ? ' selected' : ''}>${o.label}</option>`).join('')}</select>`;
        else control = `<input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" /><span class="value">${k.format ? k.format(v as number) : String(v)}</span>`;
        // What this knob waits on: it is greyed, and says so, while any of them is off.
        const off = k.requires?.filter((key) => !this.settings[key]) ?? [];
        const labels = off.map((key) => this.labelOf(key));
        const hint = labels.length ? `${k.hint} (off while ${labels.join(' and ')} ${labels.length > 1 ? 'are' : 'is'} off)` : k.hint;
        return `<div class="knob${labels.length ? ' disabled' : ''}"><div class="knob-label">${k.label}<small>${hint}</small></div><div class="knob-control">${control}</div></div>`;
      })
      .join('');
  }

  /** The name a key is shown under, for the "off while X is off" note. */
  private labelOf(key: keyof Settings): string {
    for (const g of [...GRAPHICS, ...SOUND, ...INTERFACE]) for (const k of g.knobs) if (k.key === key) return k.label;
    return String(key);
  }

  private wireKnobs(body: HTMLElement): void {
    const all = [...CONTROLS, ...GRAPHICS.flatMap((g) => g.knobs), ...SOUND.flatMap((g) => g.knobs), ...INTERFACE.flatMap((g) => g.knobs)];
    for (const el of body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) {
      const knob = all.find((k) => k.key === el.dataset.key)!;
      const on = () => {
        const value = knob.kind === 'toggle' ? (el as HTMLInputElement).checked : knob.kind === 'choice' ? el.value : Number(el.value);
        this.setValue(knob.key, value);
        const out = el.parentElement?.querySelector<HTMLElement>('.value');
        if (out && typeof value === 'number') out.textContent = knob.format ? knob.format(value) : String(value);
        // A switch other knobs wait on: draw the page again so they grey or come back. Ranges
        // never do this, so a drag is never interrupted.
        if (knob.kind === 'toggle' && all.some((k) => k.requires?.includes(knob.key))) {
          const scroll = body.scrollTop;
          this.showPage(this.page);
          const again = this.root.querySelector<HTMLElement>('.menu-body');
          if (again) again.scrollTop = scroll;
        }
      };
      el.addEventListener(knob.kind === 'range' ? 'input' : 'change', on);
      // A slider's own tick, from the game's own table. It is on `change`, not `input`: `input`
      // fires for every pixel of a drag, and the row is the one the game used for a single step.
      if (knob.kind === 'range') el.addEventListener('change', () => this.onUiSound('increment'));
    }
  }

  private setValue(key: keyof Settings, value: number | boolean | string): void {
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
    // The key moved: the display's slot row and the action bar show the key you have bound, so they
    // are told once, here, rather than reading the bindings on the frame path.
    notifyBindingsChanged();
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
