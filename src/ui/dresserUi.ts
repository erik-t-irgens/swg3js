// The world editor's Looks tab: the dresser (Map-maker II's thirteenth wave, DESIGN.md §2.13's "Dressing his people"). A
// figure of the chosen species, dressed exactly as the world dresses a look (`dressLook`, `buildLook`'s own steps), drawn in
// preview contexts of its own and never by the world's renderer, so it builds no program of the world's: a doll on the tab
// (`CharacterPreview`), and the player's own two pages re-hosted on it -- the wardrobe grid (`WardrobeUi`) and the appearance
// page with its creator rows and its dye picker (`AppearanceUi`, `DyePicker`) -- each an instance of the dresser's own, handed
// the figure as its host (`WardrobeFigure`, `AppearanceFigure`) and reporting through the `onChange` it already takes. What
// the look is, is read off the figure every time (`lookFromFigure`), as those pages read the player. "Start from" copies a
// catalogue entry's look, Save writes the row through the editing's batch (one undo entry), Delete takes it out.
//
// The figure keeps the player's rules: a piece the appearance table blocks for the species is refused in words at the
// Clothes page's pick (the host's `wearItem`), a piece it hides goes on and draws nothing (and is no piece of the look), and
// a colour may be any the picker offers, a colour carried whole among them.
//
// The dev server's alone: reached only through the editor's own dynamic import. Every colour on it is one of the eighteen
// (it draws with the editor window's own rules).

import { Character, loadSpeciesIndex, type SpeciesEntry, type Wardrobe } from '../player/character.ts';
import { CharacterPreview } from './characterPreview.ts';
import { WardrobeUi, type WardrobeFigure } from './wardrobeUi.ts';
import { AppearanceUi } from './appearanceUi.ts';
import type { TabDef } from './tabs.ts';
import { dressLook } from '../world/mobiles/dressLook.ts';
import type { MobileCatalogue } from '../world/mobiles/catalogue.ts';
import type { MobileEntry } from '../world/mobiles/types.ts';
import { DRESSER_TUNE, DresserItems, dressFigure, figureStateOf, fromFor, lookFromFigure, lookRules, pickRefusal, recordFromEntry, sameLook, saveLook, wardrobeRel, wearPick, wearersOf, type FigureLook } from '../editor/dresser.ts';
import { ownBodyOf, type OwnLookRow } from '../world/editFiles/looksFile.ts';

/** The strip the dresser's own two pages carry: its clothes and its appearance page, nothing of the player's inventory. */
export const DRESSER_TABS: TabDef[] = [
  { id: 'wardrobe', label: 'Clothes' },
  { id: 'appearance', label: 'Shape and colours' },
];

/** A section of the Looks tab: its id (folded by the window as `looks/<id>`), its heading, and what it draws into its body. */
export interface DresserPart {
  id: string;
  title: string;
  draw(body: HTMLElement): void;
}

/** What the dresser needs of the editor and the game. */
export interface DresserHost {
  readonly baseUrl: string;
  /** The page's own interface root, which the dresser's two pages hang in as the player's do. */
  readonly ui: HTMLElement;
  /** The mobile catalogue, the owner's own looks merged in, or null until it lands. */
  catalogue(): MobileCatalogue | null;
  /** One write and one undo entry of a look put or taken out (the editing's batch); what the write came to, in words. */
  putLook(label: string, before: OwnLookRow | null, after: Record<string, unknown> | null): Promise<string>;
  /** This world's placed people, and the story's cast, by the body each names: who wears what. */
  people(): readonly { id: string; body: string; name?: string }[];
  cast(): readonly { id: string; body: string }[];
  /** A person in hand wearing a body (the next click places one of the owner's own). */
  takePerson(body: string, name: string): void;
  say(words: string, ok: boolean): void;
  /** The tab drawn again. */
  redraw(): void;
}

/** The look being made: the row it is saved as (null until saved), the entry it takes its numbers from, and its words. */
interface DresserRecord {
  id: string | null;
  from: string | null;
  name: string;
  note: string;
}

/**
 * A figure's resources let go: the customizer's renders (one still out in the worker puts nothing), and every geometry,
 * material and picture of its own. Safe because the figure is the dresser's alone -- loaded fresh, never drawn by the world --
 * and the previews that cloned it share only its geometry, which a preview made again uploads again.
 */
function disposeFigure(c: Character): void {
  c.customizer?.dispose();
  c.group.traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; geometry?: { dispose(): void }; material?: unknown };
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as ({ dispose?(): void } & Record<string, unknown>)[]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) (v as { dispose(): void }).dispose();
      mat.dispose?.();
    }
  });
}

export class DresserUi {
  private readonly host: DresserHost;
  /** The figure the look is made on, or null before the first is dressed. */
  private figure: Character | null = null;
  /** The Clothes page's host over the figure: the figure's own, with the species' `block` refused in words at a pick. */
  private wardrobeFigure: WardrobeFigure | null = null;
  /** Where each shape slider stood on the bare body as it loaded: what a moved slider is told from. */
  private rest: Record<string, number> = {};
  /**
   * The wardrobe items the figure dresses from, by folder: its own wardrobe's, then the folders a look started from named,
   * each worn id read as the folder it was put on from (`DresserItems`).
   */
  private items = new DresserItems('', []);
  /** A figure being dressed: only the newest build is taken (`gen`). */
  private gen = 0;
  building = false;
  readonly record: DresserRecord = { id: null, from: null, name: '', note: '' };
  /** The doll on the tab, made the first time the tab draws one; started while the tab shows. */
  private doll: CharacterPreview | null = null;
  private dollWrap: HTMLElement | null = null;
  private dollParts = '';
  private shown = false;
  /** The dresser's own two pages, made the first time either is opened. */
  private clothes: WardrobeUi | null = null;
  private appearance: AppearanceUi | null = null;
  private species: SpeciesEntry[] = [];
  /** What "start from" was asked to find, and what it found. */
  private find = '';
  /** What the last act came to, in words. */
  last = '';

  constructor(host: DresserHost) {
    this.host = host;
    void loadSpeciesIndex(host.baseUrl).then((list) => {
      this.species = list;
      this.appearance?.setSpecies(list, this.figure?.manifest.id ?? '');
      this.host.redraw();
    });
  }

  private say(words: string, ok: boolean): string {
    this.last = words;
    this.host.say(words, ok);
    return words;
  }

  // ---- The figure ----

  /** The species the figure stands as, or the look's own while it is being dressed. */
  speciesNow(): string {
    return this.figure?.manifest.id ?? DRESSER_TUNE.species;
  }

  /** What the figure wears now, as a look (null with no figure). */
  look(): (FigureLook & { from: string }) | null {
    const c = this.figure;
    if (!c || this.building) return null;
    const look = lookFromFigure(figureStateOf(c, this.rest, this.items));
    return { ...look, from: this.record.from ?? '' };
  }

  /**
   * A figure of `species` dressed in `look` (or bare): loaded as `buildLook` loads a dressed body, its wardrobe read, the
   * folders the look names read too, dressed by `dressLook` and every colour drawn; then handed to the doll and the pages,
   * the last figure let go. Only the newest of overlapping builds is kept.
   */
  private async build(species: string, look: FigureLook | null): Promise<void> {
    const gen = ++this.gen;
    this.building = true;
    this.host.redraw();
    const base = this.host.baseUrl;
    let c: Character;
    try {
      c = await Character.load(base, species, [], { dir: `characters/${species}/`, skipRig: true });
    } catch (err) {
      if (gen === this.gen) {
        this.building = false;
        this.say(`the figure would not load: ${err instanceof Error ? err.message : String(err)} (is characters/${species} converted?)`, false);
      }
      return;
    }
    let w: Wardrobe | null = null;
    try {
      w = await c.catalogue(base);
    } catch {
      w = null;
    }
    const items = new DresserItems(wardrobeRel(c.wardrobeDir, base) ?? '', w?.items ?? []);
    // The folders a look started from names that are not the figure's own (an NPC's wearables, another species' wardrobe),
    // read for its pieces, each piece's folder noted under the id it goes on under.
    for (const folder of new Set((look?.outfit ?? []).map((p) => p.wardrobe))) {
      if (items.hasFolder(folder)) continue;
      const got = await Character.wardrobeAt(`${base}assets-private/${folder}/`);
      items.addFolder(folder, got?.items ?? []);
    }
    for (const p of look?.outfit ?? []) items.notePiece(p);
    const { rest, missing } = await dressFigure(c, look, (f) => dressLook(f, { id: `dresser:${species}`, morphs: look!.morphs, custom: look!.custom, outfit: look!.outfit }, base));
    if (gen !== this.gen) {
      disposeFigure(c);
      return;
    }
    const old = this.figure;
    this.figure = c;
    this.rest = rest;
    this.items = items;
    this.wardrobeFigure = this.hostOver(c);
    this.building = false;
    this.dollParts = '';
    this.syncDoll(true);
    if (this.clothes?.open) void this.clothes.attach(this.wardrobeFigure, base);
    if (this.appearance) {
      this.appearance.setSpecies(this.species, c.manifest.id);
      if (this.appearance.open) this.appearance.attach(c, base);
    }
    if (old) disposeFigure(old);
    if (missing.length) this.say(`${missing.length} piece${missing.length === 1 ? '' : 's'} would not go on: ${missing.join(', ')}`, false);
    this.host.redraw();
  }

  /** The Clothes page's host: the figure itself, but a piece its species may not wear is refused in words at the pick. */
  private hostOver(c: Character): WardrobeFigure {
    const me = this;
    return {
      get group() {
        return c.group;
      },
      get manifest() {
        return c.manifest;
      },
      get wardrobeDir() {
        return c.wardrobeDir;
      },
      status: () => c.status(),
      catalogue: (b: string) => c.catalogue(b),
      packPartOf: (id: string) => c.packPartOf(id),
      remove: (k: string) => c.remove(k),
      wear: (n: string) => c.wear(n),
      wearItem: async (id: string, b: string) => {
        const why = pickRefusal(me.items, c.manifest.id, id, c.packPartOf(id) !== null);
        if (why) {
          me.say(why, false);
          return false;
        }
        const on = await c.wearItem(id, b);
        if (on) me.items.noteOwn(id);
        return on;
      },
    };
  }

  /** Something on a page changed the figure: the doll follows what is worn, and the tab says the look is unsaved. */
  private changed(): void {
    this.syncDoll(false);
    this.host.redraw();
  }

  /** The doll made again from the figure when what it wears changed (or always, with `fresh`); its framing and light the tune's. */
  private syncDoll(fresh: boolean): void {
    const c = this.figure;
    if (!c || !this.doll) return;
    const key = c
      .status()
      .map((p) => `${p.name}:${p.worn ? 1 : 0}`)
      .sort()
      .join('|');
    if (!fresh && key === this.dollParts) return;
    this.dollParts = key;
    if (fresh) this.doll.reframe(DRESSER_TUNE.yaw, DRESSER_TUNE.pitch);
    this.doll.setLight(DRESSER_TUNE.light);
    this.doll.refresh(c);
  }

  /** The tab shown or left: the doll drawn only while it shows. */
  setShown(on: boolean): void {
    this.shown = on;
    if (!this.doll) return;
    if (on && this.figure) this.doll.start();
    else this.doll.stop();
  }

  /** The tune moved (the console's, a slider): the doll framed, lit and sized again. */
  retune(): void {
    if (this.dollWrap) this.dollWrap.style.height = `${DRESSER_TUNE.dollHeight}px`;
    if (this.doll && this.figure) this.syncDoll(true);
    this.host.redraw();
  }

  // ---- What the owner does ----

  /** A new look of a species (the tune's when none is named), bare, nothing saved yet. */
  async newLook(species?: string): Promise<string> {
    const cat = this.host.catalogue();
    const s = species ?? this.speciesNow();
    this.record.id = null;
    this.record.name = '';
    this.record.note = '';
    this.record.from = cat ? fromFor(s, null, cat.entries) : null;
    await this.build(s, null);
    return this.say(`a new look of ${s.replace(/_/g, ' ')}, bare: dress it, then Save`, true);
  }

  /** The look re-dressed as another species (from the appearance page's species, or the tab's): its words kept, its pieces off. */
  async changeSpecies(species: string): Promise<string> {
    const cat = this.host.catalogue();
    this.record.from = cat ? fromFor(species, this.record.from, cat.entries) : this.record.from;
    await this.build(species, null);
    return this.say(`the look stands as ${species.replace(/_/g, ' ')} now, bare: dress it again`, true);
  }

  /** "Start from": a dressed catalogue entry's look copied onto a figure of its species (or one of the owner's own looks'). */
  async startFrom(nameOrId: string): Promise<string> {
    const cat = this.host.catalogue();
    if (!cat) return this.say('the creature and NPC catalogue has not landed yet', false);
    const e = cat.byId(nameOrId) ?? cat.resolve(nameOrId);
    if (!e) return this.say(`nothing in the catalogue is ${nameOrId}`, false);
    const rec = recordFromEntry(e);
    if (!rec) return this.say(`${e.name} is no dressed person: a look starts from a dressed entry`, false);
    this.record.id = null;
    this.record.from = rec.from;
    this.record.name = '';
    this.record.note = '';
    await this.build(rec.species, rec);
    return this.say(`started from ${e.name}: dress it, then Save as a look of your own`, true);
  }

  /** One of the owner's own looks opened to be edited. */
  async open(id: string): Promise<string> {
    const cat = this.host.catalogue();
    const row = cat?.ownRows.find((r) => r.id === id);
    if (!row) return this.say(`there is no look of yours called ${id}`, false);
    this.record.id = row.id;
    this.record.from = row.from;
    this.record.name = row.name ?? '';
    this.record.note = row.note ?? '';
    await this.build(row.species, row);
    return this.say(`${row.name ?? row.id} opened: Save writes it again`, true);
  }

  /** The look saved: over the one it was opened from, or (`asNew`, or one never saved) as a look of a fresh id. One write and one undo entry. */
  async save(asNew = false): Promise<string> {
    const c = this.figure;
    const cat = this.host.catalogue();
    if (!cat) return this.say('the catalogue has not landed yet', false);
    const look = this.look();
    if (!c || !look) return this.say('nothing to save: the figure is still being dressed', false);
    // The species' own rule, as the player's equipment keeps it: a piece its wardrobe blocks is refused in words, each piece
    // read out of the folder the row names.
    const plan = saveLook({
      asNew,
      record: this.record,
      look,
      taken: new Set(cat.ownRows.map((r) => r.id)),
      fromOf: (species) => fromFor(species, null, cat.entries),
      rules: lookRules(look.species, (w, item) => this.items.inFolder(w, item), (item) => c.packPartOf(item) !== null),
    });
    if (typeof plan === 'string') return this.say(plan, false);
    const { id, keep, from, row } = plan;
    const before = keep ? (cat.ownRows.find((r) => r.id === id) ?? null) : null;
    const said = await this.host.putLook(before ? `a look saved (${id})` : `a look made (${id})`, before, row);
    if (cat.ownRows.some((r) => r.id === id)) {
      this.record.id = id;
      this.record.from = from;
    }
    this.host.redraw();
    return this.say(said || `saved as ${id}`, !/refus|not |under way|nothing/i.test(said));
  }

  /** One of the owner's own looks taken out of the file (one write and one undo entry); the figure stays, unsaved. */
  async remove(id: string): Promise<string> {
    const cat = this.host.catalogue();
    const row = cat?.ownRows.find((r) => r.id === id);
    if (!row) return this.say(`there is no look of yours called ${id}`, false);
    const said = await this.host.putLook(`a look taken out (${id})`, row, null);
    if (this.record.id === id && !this.host.catalogue()?.ownRows.some((r) => r.id === id)) this.record.id = null;
    this.host.redraw();
    return this.say(said || `${id} taken out`, !/refus|not |under way|nothing/i.test(said));
  }

  /** A person of the owner's own in hand wearing a look (the next click places them). */
  hand(id: string): string {
    const cat = this.host.catalogue();
    const e = cat?.byId(ownBodyOf(id));
    if (!e) return this.say(`there is no look of yours called ${id} on this machine`, false);
    this.host.takePerson(e.id, e.name);
    return this.say(`${e.name} in hand: a click places them where the aim meets the ground`, true);
  }

  // ---- The two pages ----

  /** One of the dresser's own pages shown over the screen, on the figure (`which`), or both put away (null). */
  showPage(which: 'wardrobe' | 'appearance' | null): string {
    const c = this.figure;
    if (which && !c) return this.say('dress a figure first: New, Start from or Open', false);
    const base = this.host.baseUrl;
    if (which === null || which === 'appearance') this.clothes?.hide();
    if (which === null || which === 'wardrobe') this.appearance?.hide();
    if (which === 'wardrobe' && c) {
      this.clothes ??= this.makeClothes();
      this.clothes.show();
      void this.clothes.attach(this.wardrobeFigure ?? c, base);
    }
    if (which === 'appearance' && c) {
      this.appearance ??= this.makeAppearance();
      this.appearance.setSpecies(this.species, c.manifest.id);
      this.appearance.show();
      this.appearance.attach(c, base);
    }
    return which ? `the dresser's ${which === 'wardrobe' ? 'clothes' : 'shape and colours'} page` : 'the pages put away';
  }

  private makeClothes(): WardrobeUi {
    const p = new WardrobeUi(this.host.ui, () => this.changed(), DRESSER_TABS);
    p.setBaseUrl(this.host.baseUrl);
    // A pick goes through the game's own arrangement rule, as the player's equipment puts a piece on (a jacket over a shirt),
    // a piece its species may not wear refused in words; never the page's own rule of taking off whatever its group holds.
    p.onWear = async (id) => (this.figure ? wearPick(this.figure, this.items, id, this.host.baseUrl, (why) => this.say(why, false)) : false);
    p.onRemove = (parts) => {
      const c = this.figure;
      if (c) for (const part of parts) c.remove(part);
      return '';
    };
    p.onTab = (id) => void this.showPage(id === 'appearance' ? 'appearance' : 'wardrobe');
    p.onClose = () => this.host.redraw();
    return p;
  }

  private makeAppearance(): AppearanceUi {
    const p = new AppearanceUi(this.host.ui, () => this.changed(), DRESSER_TABS);
    p.onTab = (id) => void this.showPage(id === 'wardrobe' ? 'wardrobe' : 'appearance');
    p.onSpecies = (id) => void this.changeSpecies(id);
    p.onClose = () => this.host.redraw();
    return p;
  }

  /** Whether either page is up. */
  pagesOpen(): boolean {
    return !!this.clothes?.open || !!this.appearance?.open;
  }

  // ---- The tab ----

  /** The look's state in words: saved, unsaved, new, being dressed. */
  stateWords(): string {
    if (this.building) return 'dressing the figure…';
    if (!this.figure) return 'no figure yet: New, Start from or Open one of your looks';
    const cat = this.host.catalogue();
    const saved = this.record.id ? cat?.ownRows.find((r) => r.id === this.record.id) : undefined;
    if (!saved) return this.record.id ? `${this.record.id} is no longer in the file: Save writes it again` : 'a new look, not saved';
    const now = this.look();
    const same = !!now && sameLook(now, { ...saved, from: saved.from }) && (saved.name ?? '') === this.record.name.trim() && (saved.note ?? '') === this.record.note.trim();
    return same ? `saved as ${saved.id}` : `${saved.id}: changed, not saved`;
  }

  /** The Looks tab's sections, each drawn into the body the window gives it (folded by the window, `looks/<id>`). */
  parts(): DresserPart[] {
    return [
      { id: 'look', title: 'THE LOOK BEING MADE', draw: (b) => this.drawLook(b) },
      { id: 'looks', title: 'YOUR LOOKS', draw: (b) => this.drawLooks(b) },
    ];
  }

  private note(el: HTMLElement, words: string): void {
    const n = document.createElement('div');
    n.className = 'ed-note';
    n.textContent = words;
    el.appendChild(n);
  }

  private button(words: string, act: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ed-b${cls ? ` ${cls}` : ''}`;
    b.dataset.act = 'look';
    b.textContent = words;
    b.addEventListener('click', () => {
      b.blur();
      act();
    });
    return b;
  }

  private row(el: HTMLElement, ...items: HTMLElement[]): HTMLElement {
    const r = document.createElement('div');
    r.className = 'ed-row';
    r.style.flexWrap = 'wrap';
    r.append(...items);
    el.appendChild(r);
    return r;
  }

  /** A field written as it is left (or Enter), the keyboard given back to the page. */
  private field(el: HTMLElement, label: string, value: string, write: (v: string) => void): HTMLInputElement {
    const f = document.createElement('label');
    f.className = 'ed-field';
    const s = document.createElement('span');
    s.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => write(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    f.append(s, input);
    el.appendChild(f);
    return input;
  }

  private drawLook(el: HTMLElement): void {
    const cat = this.host.catalogue();
    if (!cat) {
      this.note(el, 'the creature and NPC catalogue has not landed yet');
      return;
    }
    this.note(el, this.stateWords());
    // The doll: a preview context of its own, the figure turned with the mouse (wheel to zoom, double-click to reset).
    if (!this.dollWrap) {
      this.dollWrap = document.createElement('div');
      this.dollWrap.className = 'wardrobe-preview';
      this.dollWrap.style.flex = '0 0 auto';
    }
    this.dollWrap.style.height = `${DRESSER_TUNE.dollHeight}px`;
    el.appendChild(this.dollWrap);
    if (this.figure && !this.doll) {
      this.doll = new CharacterPreview();
      this.dollWrap.appendChild(this.doll.canvas);
      this.syncDoll(true);
      if (this.shown) this.doll.start();
    }
    // Its species: a new bare figure of it (the look's words kept).
    const sf = document.createElement('label');
    sf.className = 'ed-field';
    const ss = document.createElement('span');
    ss.textContent = 'Species';
    const sel = document.createElement('select');
    const now = this.speciesNow();
    const list = this.species.length ? this.species.map((s) => s.id) : [now];
    for (const id of list.includes(now) ? list : [now, ...list]) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id.replace(/_/g, ' ');
      if (id === now) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      sel.blur();
      void (this.figure ? this.changeSpecies(sel.value) : this.newLook(sel.value));
    });
    sf.append(ss, sel);
    el.appendChild(sf);
    const from = this.record.from ? cat.byId(this.record.from) : undefined;
    this.note(el, `Its size, moves and numbers are ${from ? `${from.name}'s (${from.id})` : this.record.from ? `${this.record.from}'s (not in this catalogue)` : "a dressed entry's of its species, chosen as it is saved"}.`);
    this.field(el, 'Its name', this.record.name, (v) => {
      this.record.name = v.trim().slice(0, 80);
      this.host.redraw();
    });
    this.field(el, 'Note (never shown)', this.record.note, (v) => {
      this.record.note = v.trim().slice(0, 400);
      this.host.redraw();
    });
    this.row(
      el,
      this.button('Clothes…', () => void this.showPage('wardrobe')),
      this.button('Shape and colours…', () => void this.showPage('appearance')),
    );
    this.row(
      el,
      this.button(this.record.id ? 'Save' : 'Save as a look', () => void this.save(false)),
      this.button('Save as new', () => void this.save(true)),
      this.button('New', () => void this.newLook()),
    );
    // Start from: a find over the catalogue's dressed people (and the owner's own looks), a click on one copies its look.
    const input = this.field(el, 'Start from (find)', this.find, (v) => {
      this.find = v.trim();
      this.host.redraw();
    });
    input.placeholder = 'a dressed person: farmer, stormtrooper, jawa…';
    if (this.find) {
      const hits = cat.search(this.find, { kind: 'dressed', limit: DRESSER_TUNE.startHits });
      if (!hits.length) this.note(el, `nothing dressed is ${this.find}`);
      for (const e of hits) {
        const label = document.createElement('span');
        label.className = 'ed-label';
        label.textContent = `${e.name}${e.subtitle ? ` · ${e.subtitle}` : ''}`;
        label.title = e.id;
        this.row(el, label, this.button('Start from it', () => void this.startFrom(e.id)));
      }
    }
    this.note(el, "Clothes… and Shape and colours… open the player's own pages on this figure: the wardrobe grid, the creator's rows and the dye picker. A piece this species cannot wear is refused in words. Save writes public/placements/looks/all.json (one undo); a person of yours wears it by its body, own:<id>.");
  }

  private drawLooks(el: HTMLElement): void {
    const cat = this.host.catalogue();
    const rows = cat?.ownRows ?? [];
    if (!rows.length) this.note(el, 'none yet: dress a figure and Save it');
    const people = this.host.people();
    const cast = this.host.cast();
    for (const r of rows) {
      const label = document.createElement('span');
      label.className = 'ed-label';
      const worn = wearersOf(r.id, people, cast);
      label.textContent = `${r.name ?? r.id} · ${r.species.replace(/_/g, ' ')} · ${r.outfit.length} piece${r.outfit.length === 1 ? '' : 's'}${worn.length ? ` · worn by ${worn.length}` : ''}`;
      label.title = `${ownBodyOf(r.id)}${worn.length ? `: ${worn.join(', ')}` : ''}`;
      this.row(
        el,
        label,
        this.button('Open', () => void this.open(r.id), this.record.id === r.id ? 'on' : ''),
        this.button('In hand', () => void this.hand(r.id)),
        this.button('Delete', () => void this.remove(r.id), 'ed-del'),
      );
    }
    for (const s of cat?.ownSkipped ?? []) this.note(el, `${s.id}: ${s.why}`);
  }

  /** What the console's `__debug.ownLooks()` reads of the dresser. */
  report(): Record<string, unknown> {
    const c = this.figure;
    const look = this.look();
    return {
      state: this.stateWords(),
      record: { ...this.record },
      figure: c ? { species: c.manifest.id, worn: c.status().filter((p) => p.worn && !p.body).map((p) => p.name) } : null,
      look,
      pages: { clothes: !!this.clothes?.open, appearance: !!this.appearance?.open },
      doll: this.doll ? { running: this.shown && !!this.figure, build: this.doll.lastBuild, frames: this.doll.frames } : null,
      tune: { ...DRESSER_TUNE },
      last: this.last,
    };
  }

  /** The entries a "start from" find offers, for the console. */
  findStart(query: string): MobileEntry[] {
    return this.host.catalogue()?.search(query, { kind: 'dressed', limit: DRESSER_TUNE.startHits }) ?? [];
  }
}
