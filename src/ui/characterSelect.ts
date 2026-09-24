// The first screen: the characters kept in this browser as a list down the left, the chosen one
// standing on a dark stage in the middle, dressed and made up as it was saved, and what its record
// says about it on the right. One to play, one to rename, one to delete, and room to make another.
//
// The figure is the player's own rig, loaded and dressed by the very steps `App.play` takes (the
// species, the look, the outfit), so pressing Play finds all of it already there instead of loading it
// twice. It is drawn by a `CharacterPreview` of its own: a WebGL context apart from the world's, so
// nothing here touches the world renderer or compiles a program the game will later need, and it draws
// only while this screen is up. The details are words written once when an entry is chosen; nothing on
// this screen is written in a frame.
//
// A choice that is overtaken before its figure arrives is dropped by a generation number, so moving
// quickly down the list can never leave the wrong character standing on the stage.

import * as THREE from 'three';
import { MAX_CHARACTERS, prettySpecies, upsertCharacter, type SavedCharacter } from '../core/characters.ts';
import { PLANETS } from '../data/planets.ts';
import type { Character } from '../player/character.ts';
import { DEFAULT_SABER_COLOR } from '../player/player.ts';
import { CharacterPreview } from './characterPreview.ts';
import { loadSceneLibrary, SceneBar } from './sceneBar.ts';
import { installIcons } from './hudIcons.ts';
import { agoWords, classGlyph, classWords, cleanName, initialIndex, keyAction, NAME_MAX, placeWords, safeColour, slotsFor, stepIndex, type Slot } from './selectModel.ts';

/** The figure the game hands back for a character: its own rig, dressed, and the idle it stands in. */
export interface SelectFigure {
  character: Character;
  idle: THREE.AnimationClip | null;
}

/** A figure; a reason there is none; or null when the choice was overtaken while it loaded. */
export type SelectFigureAnswer = SelectFigure | { error: string } | null;

/**
 * The doll the screen draws with. Beyond what every doll does it uses three things `CharacterPreview`
 * carries for it: a hook each drawn frame (the idle is played there, on the clone), a way to frame a
 * new figure afresh (a Wookiee after a Rodian), and a way to let go of the clone when the game starts.
 */
type PreviewHooks = CharacterPreview;

/** Every number of ours on this screen, in one place. */
export const SELECT_TUNE = {
  /** How long an entry must stay chosen before its figure starts loading, in ms: arrowing past one loads nothing. */
  dwellMs: 180,
  /** How long the delete button stays shut after the question is asked, in ms, so a double-click cannot answer it. */
  armMs: 700,
  /** The figure's turn when it first stands, radians: a little of its side shows, which reads better than square on. */
  yaw: 0.28,
};

type FigureState = 'none' | 'waiting' | 'loading' | 'ready' | 'error';

export class CharacterSelect {
  readonly root: HTMLElement;
  private list: SavedCharacter[] = [];
  private slots: Slot[] = [];
  private index = -1;
  /** The character chosen last, by id, so the list opens on it again. */
  private chosenId: string | null = null;

  onPlay: (c: SavedCharacter) => void = () => {};
  onCreate: () => void = () => {};
  onDelete: (c: SavedCharacter) => void = () => {};
  /**
   * Set by the game: put the player's own rig in this character's species, look and clothes, exactly
   * as `play` does, and hand it back. `alive()` says whether the choice still stands; a load that finds
   * it does not answers null.
   */
  loadFigure: ((c: SavedCharacter, alive: () => boolean) => Promise<SelectFigureAnswer>) | null = null;
  /** Set by the game: a weapon's own name, by its id. */
  weaponName: ((id: string) => Promise<string>) | null = null;

  private readonly listEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly figureBox: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly card: HTMLElement;
  private readonly go: HTMLElement;
  private readonly confirmEl: HTMLElement;

  private preview: PreviewHooks | null = null;
  /** The row of places and hours under the figure; null until the doll is built, and idle with no backdrops rendered. */
  private sceneBar: SceneBar | null = null;
  private gen = 0;
  private figure: FigureState = 'none';
  private figureError = '';
  /** Whose figure is on the doll now, by id. */
  private figureFor: string | null = null;
  private dwell = 0;
  private armTimer = 0;
  private renaming = false;
  private confirming = false;
  /** Play or Create was pressed and the game is on its way: nothing more is taken. */
  private busy = false;
  private idle: THREE.AnimationClip | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private mixerRoot: THREE.Object3D | null = null;
  private loadsStarted = 0;
  private loadsDropped = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'start';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="cs">
        <header class="cs-head">
          <div class="cs-brand">
            <h1>SWG3JS</h1>
            <div class="sub">Star Wars Galaxies, rebuilt for the browser.</div>
          </div>
          <div class="cs-count" aria-live="polite"></div>
        </header>
        <div class="cs-main">
          <section class="cs-roster" aria-label="Characters">
            <div class="cs-title">Characters</div>
            <div class="cs-list" role="listbox" aria-label="Characters"></div>
          </section>
          <section class="cs-stage is-none" aria-label="The chosen character">
            <div class="cs-figure"></div>
            <div class="cs-state" aria-live="polite"></div>
            <div class="cs-hint">drag to turn · right-drag to slide · wheel to zoom · double-click to frame again</div>
            <div class="cs-go"></div>
            <div class="cs-confirm hidden" role="alertdialog" aria-live="assertive"></div>
          </section>
          <section class="cs-card" aria-label="About this character"></section>
        </div>
        <footer class="cs-foot">
          <div class="cs-keys"><b>↑ ↓</b> choose · <b>Enter</b> play · <b>F2</b> rename · <b>Delete</b> delete</div>
          <div class="cs-controls"><b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom (all the way in: first person) · <b>Space</b> jump · <b>Ctrl</b> crouch · <b>Shift</b> walk · <b>LMB</b> attack · <b>RMB</b> block or rapid fire · <b>I</b> inventory · <b>B</b> spawner · <b>M</b> galaxy map · <b>H</b> help · <b>Esc</b> release mouse</div>
        </footer>
      </div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.listEl = q('.cs-list');
    this.countEl = q('.cs-count');
    this.stage = q('.cs-stage');
    this.figureBox = q('.cs-figure');
    this.stateEl = q('.cs-state');
    this.card = q('.cs-card');
    this.go = q('.cs-go');
    this.confirmEl = q('.cs-confirm');
    // The class marks and the pencil are the interface's own sheet; the hud installs it too, and a
    // second call is the first call's promise.
    void installIcons();

    this.listEl.addEventListener('click', (e) => {
      const entry = (e.target as HTMLElement).closest<HTMLElement>('.cs-entry');
      if (!entry || this.busy) return;
      const i = Number(entry.dataset.i);
      if (this.slots[i]?.kind === 'empty') {
        this.choose(i, true);
        this.create();
        return;
      }
      this.choose(i, true);
    });
    this.listEl.addEventListener('dblclick', (e) => {
      const entry = (e.target as HTMLElement).closest<HTMLElement>('.cs-entry');
      if (!entry || this.busy) return;
      const s = this.slots[Number(entry.dataset.i)];
      if (s?.kind === 'char') this.play();
    });
    this.go.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || this.busy) return;
      if (b.dataset.act === 'play') this.play();
      else if (b.dataset.act === 'create') this.create();
      else if (b.dataset.act === 'delete') this.askDelete();
    });
    this.confirmEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.act === 'keep') this.closeDelete(true);
      else if (b.dataset.act === 'really' && !b.disabled) this.reallyDelete();
    });
    this.card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || this.busy) return;
      if (b.dataset.act === 'rename') this.startRename();
      else if (b.dataset.act === 'create') this.create();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ---- showing and hiding -------------------------------------------------------------------------

  /** Show the list as it is now. */
  show(list: SavedCharacter[]): void {
    const wasOpen = this.open;
    this.list = list;
    this.slots = slotsFor(list, MAX_CHARACTERS);
    this.busy = false;
    this.root.classList.remove('is-busy');
    this.closeDelete(false);
    this.renaming = false;
    if (!wasOpen) {
      // Coming back from the world or the creator: whatever stood on the doll may have changed clothes since.
      this.figureFor = null;
      this.root.classList.remove('hidden');
    }
    const prefer = this.chosenId ?? (this.index >= 0 && this.slots[this.index]?.kind === 'char' ? (this.slots[this.index] as { c: SavedCharacter }).c.id : null);
    let i = initialIndex(this.slots, prefer);
    // A character just deleted leaves its neighbour chosen, not the top of the list.
    if (prefer && !list.some((c) => c.id === prefer) && this.index >= 0) i = Math.min(this.index, Math.max(0, this.slots.length - 1));
    this.renderList();
    this.countEl.textContent = `${list.length} of ${MAX_CHARACTERS}`;
    this.preview?.start();
    this.choose(i, false, !wasOpen);
    this.focusChosen();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.gen++;
    window.clearTimeout(this.dwell);
    window.clearTimeout(this.armTimer);
    this.confirming = false;
    this.renaming = false;
    this.figureFor = null;
    this.setFigure('none');
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.mixerRoot = null;
    this.idle = null;
    // The doll stops drawing, and the clone goes: its buffers in the preview's own context are the one
    // thing here worth giving back while the world is played.
    this.preview?.release();
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  // ---- the list -----------------------------------------------------------------------------------

  private renderList(): void {
    const now = Date.now();
    this.listEl.innerHTML = this.slots
      .map((s, i) => {
        if (s.kind === 'empty') {
          const label = s.first ? 'Create new character' : 'Empty slot';
          const sub = s.first ? 'pick a species, shape and dress it, choose its world' : 'room for another character';
          return `<button class="cs-entry cs-empty${s.first ? ' first' : ''}" type="button" role="option" aria-selected="false" tabindex="-1" data-i="${i}">
            <svg class="ic cs-entry-ic" aria-hidden="true"><use href="#ic-plus"/></svg>
            <span class="cs-entry-text"><span class="cs-entry-name">${label}</span><span class="cs-entry-line">${sub}</span></span>
          </button>`;
        }
        const c = s.c;
        const where = placeWords(c, PLANETS);
        const blade = c.class === 'jedi' ? (safeColour(c.saber?.color) ?? DEFAULT_SABER_COLOR) : null;
        return `<button class="cs-entry" type="button" role="option" aria-selected="false" tabindex="-1" data-i="${i}">
          <svg class="ic cs-entry-ic" aria-hidden="true"><use href="#${classGlyph(c.class)}"/></svg>
          <span class="cs-entry-text">
            <span class="cs-entry-name"><span class="cs-entry-label">${escapeHtml(c.name)}</span>${blade ? `<i class="cs-swatch" title="saber colour" style="background-color:${blade}"></i>` : ''}</span>
            <span class="cs-entry-line">${escapeHtml(prettySpecies(c.species))} · ${classWords(c.class)}</span>
            <span class="cs-entry-line muted">${escapeHtml(where.line)}${where.fresh ? ' · new' : ''} · ${agoWords(c.played, now)}</span>
          </span>
        </button>`;
      })
      .join('');
  }

  /** Choose a place in the list: the entry is marked, the details written, and the figure asked for. */
  private choose(i: number, byUser: boolean, immediate = false): void {
    if (i < 0 || i >= this.slots.length) {
      this.index = -1;
      this.renderCard();
      this.renderGo();
      this.setFigure('none');
      return;
    }
    const changed = i !== this.index;
    this.index = i;
    const s = this.slots[i];
    if (s.kind === 'char') this.chosenId = s.c.id;
    for (const el of this.listEl.querySelectorAll<HTMLElement>('.cs-entry')) {
      const on = Number(el.dataset.i) === i;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.tabIndex = on ? 0 : -1;
    }
    if (changed || !byUser) {
      this.closeDelete(false);
      this.renaming = false;
      this.renderCard();
      this.renderGo();
    }
    if (s.kind === 'empty') {
      this.gen++;
      window.clearTimeout(this.dwell);
      this.figureFor = null;
      this.setFigure('none');
      return;
    }
    if (this.figureFor === s.c.id && (this.figure === 'ready' || this.figure === 'loading' || this.figure === 'waiting')) return;
    this.requestFigure(s.c, immediate ? 0 : SELECT_TUNE.dwellMs);
  }

  private focusChosen(): void {
    const el = this.listEl.querySelector<HTMLElement>(`.cs-entry[data-i="${this.index}"]`);
    el?.focus({ preventScroll: false });
  }

  // ---- the figure ----------------------------------------------------------------------------------

  private requestFigure(c: SavedCharacter, delay: number): void {
    const gen = ++this.gen;
    window.clearTimeout(this.dwell);
    this.figureFor = c.id;
    this.setFigure('waiting', `${c.name}…`);
    const go = () => {
      if (gen !== this.gen || !this.open) return;
      void this.fetchFigure(c, gen);
    };
    if (delay > 0) this.dwell = window.setTimeout(go, delay);
    else go();
  }

  private async fetchFigure(c: SavedCharacter, gen: number): Promise<void> {
    const alive = () => gen === this.gen && this.open;
    if (!this.loadFigure) {
      this.setFigure('error', 'no figure: the game has not wired the preview');
      return;
    }
    this.loadsStarted++;
    this.setFigure('loading', `bringing ${c.name} in…`);
    let answer: SelectFigureAnswer;
    try {
      answer = await this.loadFigure(c, alive);
    } catch (err) {
      answer = { error: `could not load ${prettySpecies(c.species)}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!alive() || answer === null) {
      this.loadsDropped++;
      return;
    }
    if ('error' in answer) {
      this.figureFor = c.id;
      this.setFigure('error', answer.error);
      return;
    }
    const preview = this.previewFor();
    this.idle = answer.idle;
    // A new figure is framed afresh, whatever the last one's height was; a figure whose framing the
    // viewer has turned and zoomed keeps it only for as long as it is on the stage.
    preview.reframe(SELECT_TUNE.yaw);
    preview.refresh(answer.character);
    preview.start();
    this.figureFor = c.id;
    // The first frame of a new clone links its programs in the preview's own context: the figure is
    // shown on the frame after, so it fades in rather than popping in half drawn.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (alive()) this.setFigure('ready');
      }),
    );
  }

  private previewFor(): PreviewHooks {
    if (this.preview) return this.preview;
    const p: PreviewHooks = new CharacterPreview();
    // The picture goes in first and the canvas over it: neither carries a z-index, so two
    // positioned boxes in one stacking context paint in tree order and the figure is drawn on the
    // place rather than under it.
    this.figureBox.appendChild(p.backdrop);
    p.canvas.classList.add('cs-canvas');
    this.figureBox.appendChild(p.canvas);
    // The row that offers the places, over both. With no backdrops rendered on this machine the
    // library answers null, the row hides itself and the screen is exactly what it always was.
    this.sceneBar = new SceneBar(
      (scene) => p.setScene(scene),
      (on) => p.setFaceLight(on),
    );
    this.figureBox.appendChild(this.sceneBar.element);
    void loadSceneLibrary().then((lib) => this.sceneBar?.setLibrary(lib));
    // The idle is played on the clone, not on the character: the clone has its own skeleton, so the
    // rig the world will use stays exactly as it was dressed. The mixer is made once per clone.
    p.onFrame = (dt, model) => {
      if (model !== this.mixerRoot) {
        this.mixer?.stopAllAction();
        this.mixer = null;
        this.mixerRoot = model;
        if (this.idle) {
          this.mixer = new THREE.AnimationMixer(model);
          this.mixer.clipAction(this.idle).play();
        }
      }
      this.mixer?.update(dt);
    };
    this.preview = p;
    return p;
  }

  private setFigure(state: FigureState, words = ''): void {
    this.figure = state;
    this.figureError = state === 'error' ? words : '';
    const cls = `is-${state}`;
    for (const s of ['is-none', 'is-waiting', 'is-loading', 'is-ready', 'is-error']) this.stage.classList.toggle(s, s === cls);
    let text = '';
    if (state === 'waiting' || state === 'loading') text = words;
    else if (state === 'error') text = words;
    else if (state === 'none') text = this.slots.length && this.index >= 0 && this.slots[this.index]?.kind === 'empty' ? 'a new character will stand here' : '';
    if (this.stateEl.textContent !== text) this.stateEl.textContent = text;
  }

  // ---- the details ---------------------------------------------------------------------------------

  private get chosen(): SavedCharacter | null {
    const s = this.slots[this.index];
    return s && s.kind === 'char' ? s.c : null;
  }

  private renderCard(): void {
    const c = this.chosen;
    if (!c) {
      const none = !this.list.length;
      this.card.innerHTML = `
        <div class="cs-card-empty">
          <h2>${none ? 'No characters yet' : 'An empty slot'}</h2>
          <p>${none ? 'Make one: pick a species, shape and dress it, and choose the world it starts on.' : `There is room for ${MAX_CHARACTERS - this.list.length} more. A new character starts on the world you choose for it.`}</p>
        </div>`;
      return;
    }
    const where = placeWords(c, PLANETS);
    const blade = safeColour(c.saber?.color);
    const rows: [string, string][] = [
      ['Species', escapeHtml(prettySpecies(c.species))],
      ['Class', classWords(c.class)],
      ['Where', `${escapeHtml(where.world)}${where.within ? ` <span class="muted">· ${escapeHtml(where.within)}</span>` : ''}${where.fresh ? ' <span class="muted">· not yet stood there</span>' : ''}`],
      ['Created', c.created ? dateWords(c.created) : '<span class="muted">not recorded</span>'],
      ['Last played', c.played ? `${agoWords(c.played, Date.now())} <span class="muted">· ${dateWords(c.played)}</span>` : '<span class="muted">never</span>'],
      ['In hand', `<span class="cs-held">${this.heldWords(c, null)}</span>`],
    ];
    if (c.class === 'jedi') {
      rows.push(['Saber', `<i class="cs-swatch big" style="background-color:${blade ?? DEFAULT_SABER_COLOR}"></i> ${blade ? blade.toUpperCase() : '<span class="muted">the default blue</span>'}`]);
    }
    if (c.mood) rows.push(['Mood', escapeHtml(c.mood)]);
    this.card.innerHTML = `
      <div class="cs-name-row">
        <h2 class="cs-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</h2>
        <button class="cs-rename" type="button" data-act="rename" title="Rename (F2)"><svg class="ic" aria-hidden="true"><use href="#ic-pencil"/></svg><span>Rename</span></button>
      </div>
      <div class="cs-classline"><svg class="ic" aria-hidden="true"><use href="#${classGlyph(c.class)}"/></svg><span>${classWords(c.class)}</span></div>
      <dl class="cs-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    // The weapons' own names come from the rack, which may still be arriving: the ids stand until they do.
    const held = c.held;
    if (this.weaponName && (held?.right || held?.left)) {
      const card = this.card.querySelector('.cs-facts');
      const ask = (w?: string) => (w ? this.weaponName!(w).catch(() => w) : Promise.resolve(''));
      void Promise.all([ask(held.right), ask(held.left)]).then(([r, l]) => {
        // Only onto the very card it was asked for: a card written since is another character's, or this one's again.
        if (!this.open || !card || !card.isConnected) return;
        const el = card.querySelector<HTMLElement>('.cs-held');
        if (el) el.innerHTML = this.heldWords(c, { right: r, left: l });
      });
    }
  }

  private heldWords(c: SavedCharacter, names: { right: string; left: string } | null): string {
    const r = c.held?.right;
    const l = c.held?.left;
    if (!r && !l) return '<span class="muted">empty hands</span>';
    const word = (id: string | undefined, name: string | undefined) => (id ? escapeHtml(name || prettyId(id)) : '');
    const right = word(r, names?.right);
    const left = word(l, names?.left);
    if (right && left) return `${right} <span class="muted">(right)</span>, ${left} <span class="muted">(left)</span>`;
    return right ? right : `${left} <span class="muted">(left)</span>`;
  }

  /** The row under the stage: Play and a quieter Delete for a character, Create for an empty place. */
  private renderGo(): void {
    const s = this.slots[this.index];
    if (!s) {
      this.go.innerHTML = '';
      return;
    }
    if (s.kind === 'empty') {
      this.go.innerHTML = `<button class="cs-play" type="button" data-act="create">Create new character</button>`;
      return;
    }
    this.go.innerHTML = `
      <button class="cs-play" type="button" data-act="play">Play ${escapeHtml(s.c.name)}</button>
      <button class="cs-delete" type="button" data-act="delete" title="Delete this character (Delete)">Delete…</button>`;
  }

  // ---- play, create -----------------------------------------------------------------------------------

  private play(): void {
    const c = this.chosen;
    if (!c || this.busy || this.renaming || this.confirming) return;
    this.busy = true;
    this.root.classList.add('is-busy');
    if (this.figure !== 'ready') this.setFigure('loading', `${c.name} is on the way…`);
    this.onPlay(c);
  }

  private create(): void {
    if (this.busy || this.list.length >= MAX_CHARACTERS) return;
    this.busy = true;
    this.root.classList.add('is-busy');
    this.onCreate();
  }

  // ---- rename -------------------------------------------------------------------------------------------

  private startRename(): void {
    const c = this.chosen;
    if (!c || this.busy || this.confirming || this.renaming) return;
    const row = this.card.querySelector<HTMLElement>('.cs-name-row');
    if (!row) return;
    this.renaming = true;
    row.innerHTML = `
      <input class="cs-name-input" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" aria-label="New name" />
      <div class="cs-name-help">Enter keeps it · Escape leaves it</div>`;
    const input = row.querySelector<HTMLInputElement>('input')!;
    input.value = c.name;
    input.focus();
    input.select();
    const help = row.querySelector<HTMLElement>('.cs-name-help')!;
    const finish = (keep: boolean) => {
      if (!this.renaming) return;
      if (keep) {
        const name = cleanName(input.value);
        if (!name) {
          help.textContent = 'A name cannot be empty.';
          help.classList.add('warn');
          input.focus();
          return;
        }
        if (name !== c.name) {
          const was = c.name;
          c.name = name;
          if (!upsertCharacter(c)) {
            c.name = was;
            help.textContent = 'The name could not be saved (the browser refused the storage).';
            help.classList.add('warn');
            return;
          }
        }
      }
      this.renaming = false;
      this.renderList();
      this.markChosen();
      this.renderCard();
      this.renderGo();
      this.focusChosen();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    // Clicking away leaves the name as it was: only Enter keeps a change.
    input.addEventListener('blur', () => window.setTimeout(() => finish(false), 0));
  }

  private markChosen(): void {
    for (const el of this.listEl.querySelectorAll<HTMLElement>('.cs-entry')) {
      const on = Number(el.dataset.i) === this.index;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.tabIndex = on ? 0 : -1;
    }
  }

  // ---- delete ---------------------------------------------------------------------------------------------

  private askDelete(): void {
    const c = this.chosen;
    if (!c || this.busy || this.renaming || this.confirming) return;
    this.confirming = true;
    this.go.classList.add('hidden');
    this.confirmEl.classList.remove('hidden');
    this.confirmEl.innerHTML = `
      <div class="cs-confirm-text">Delete <b>${escapeHtml(c.name)}</b>? Everything this character owns goes with it, and it cannot be undone.</div>
      <div class="cs-confirm-buttons">
        <button type="button" class="cs-keep" data-act="keep">Keep ${escapeHtml(c.name)}</button>
        <button type="button" class="cs-really arming" data-act="really" disabled>Delete for good</button>
      </div>`;
    this.confirmEl.querySelector<HTMLButtonElement>('.cs-keep')!.focus();
    window.clearTimeout(this.armTimer);
    // Shut for a moment, so the click that asked cannot also answer.
    this.armTimer = window.setTimeout(() => {
      const b = this.confirmEl.querySelector<HTMLButtonElement>('.cs-really');
      if (!b || !this.confirming) return;
      b.disabled = false;
      b.classList.remove('arming');
    }, SELECT_TUNE.armMs);
  }

  private closeDelete(refocus: boolean): void {
    window.clearTimeout(this.armTimer);
    if (!this.confirming) return;
    this.confirming = false;
    this.confirmEl.classList.add('hidden');
    this.confirmEl.innerHTML = '';
    this.go.classList.remove('hidden');
    if (refocus) this.focusChosen();
  }

  private reallyDelete(): void {
    const c = this.chosen;
    if (!c || !this.confirming) return;
    this.closeDelete(false);
    if (this.chosenId === c.id) this.chosenId = null;
    // The game deletes the record and shows the list again (`show`), which chooses the neighbour.
    this.onDelete(c);
  }

  // ---- keys ------------------------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!this.open || this.busy) return;
    if (this.confirming) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeDelete(true);
      }
      // Enter and Space answer the focused button by themselves.
      return;
    }
    if (this.renaming) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const onEntry = !t || t === document.body || !!t.closest?.('.cs-entry') || !this.root.contains(t);
    const act = keyAction(e.code, this.slots[this.index]?.kind === 'empty', e.repeat);
    if (!act) return;
    // Enter on a focused button that is not an entry is that button's own business.
    if ((act === 'play' || act === 'create') && !onEntry) return;
    e.preventDefault();
    switch (act) {
      case 'up':
      case 'down':
      case 'first':
      case 'last': {
        const n = this.slots.length;
        const i = act === 'first' ? 0 : act === 'last' ? n - 1 : stepIndex(this.index, act === 'up' ? -1 : 1, n);
        if (i !== this.index) this.choose(i, true);
        this.focusChosen();
        break;
      }
      case 'play':
        this.play();
        break;
      case 'create':
        this.create();
        break;
      case 'delete':
        this.askDelete();
        break;
      case 'rename':
        this.startRename();
        break;
    }
  }

  // ---- the console -----------------------------------------------------------------------------------------

  /** For `__debug.select()`: what the screen holds, what the figure is doing and how big every box is. Reads layout, so never call it in a frame. */
  report(): Record<string, unknown> {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    };
    const p = this.preview;
    const canvas = p?.canvas ?? null;
    const sideways: string[] = [];
    for (const el of [this.root, this.root.querySelector('.cs'), this.root.querySelector('.cs-main'), this.listEl, this.card, this.stage, this.go]) {
      if (el && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1) sideways.push((el as HTMLElement).className || (el as HTMLElement).id);
    }
    return {
      open: this.open,
      busy: this.busy,
      characters: this.list.length,
      slots: this.slots.map((s) => (s.kind === 'char' ? s.c.name : s.first ? '(create)' : '(empty)')),
      chosen: this.index,
      chosenName: this.chosen?.name ?? null,
      renaming: this.renaming,
      confirming: this.confirming,
      figure: this.figure,
      figureFor: this.list.find((c) => c.id === this.figureFor)?.name ?? null,
      error: this.figureError || null,
      generation: this.gen,
      loads: { started: this.loadsStarted, dropped: this.loadsDropped },
      idle: this.idle?.name ?? null,
      animating: this.mixer !== null,
      preview: p
        ? {
            frames: p.frames,
            build: p.lastBuild,
            render: p.lastRender,
            // Whether the doll draws: false once the game has started and the clone was let go.
            running: p.dofReport().running,
          }
        : null,
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      boxes: {
        screen: box(this.root),
        list: box(this.listEl),
        stage: box(this.stage),
        figure: box(this.figureBox),
        card: box(this.card),
        canvasCss: box(canvas),
        canvasBuffer: canvas ? [canvas.width, canvas.height] : null,
      },
      // The figure's box and its drawing buffer must have one shape, or the figure is stretched.
      stretch: canvas && canvas.clientHeight > 0 && canvas.height > 0 ? Number((canvas.width / canvas.height / (canvas.clientWidth / canvas.clientHeight)).toFixed(3)) : null,
      scrollsSideways: sideways,
    };
  }
}

function dateWords(t: number): string {
  try {
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** A weapon id in words, until the rack says its own name: "weapon_rifle_e11" reads "rifle e11". */
function prettyId(id: string): string {
  return id.replace(/^weapon_/, '').replace(/_/g, ' ');
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
