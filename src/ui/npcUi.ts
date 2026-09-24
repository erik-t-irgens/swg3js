// The NPC tab of the spawner (B): everything the game shipped that lives (the creature and NPC
// catalogue: creatures by family, droids, people on their own models, dressed NPCs by species and
// temper, the specials, and the holograms, pets, vendors and tutorial folk), found by name or
// browsed by group, and stood ahead of the player one at a time or one of each; and above them the
// three machines of the old tab (a blaster turret, a fighter, this planet's creature).
//
// Five thousand entries: only the group headings are drawn at first, a group's rows the first time
// it is opened, a hundred and twenty at a time. The find box is in the header and never redrawn,
// so it keeps its focus. Clicks are handled once, on the body, by what the button says it is for.
// The counts are refreshed in place twice a second while the tab is open.
import { SPAWNER_TABS, tabStrip, wireTabs } from './tabs';
import { escapeHtml, groupHtml, groupShell, GroupState } from './catalogue';
import type { MobileCatalogue } from '../world/mobiles/catalogue';
import { placeOf } from '../world/mobiles/catalogueIndex';
import { groupPicks, permanentGap } from '../world/mobiles/spawning';
import type { MobileEntry } from '../world/mobiles/types';
import { WORLD_HOLDS_IT, spawnRefusal, type WorldSpawnGate } from '../world/spawnSeed.ts';

export interface NpcKind {
  id: string;
  label: string;
  blurb: string;
  /** How many stand on the world now. */
  count: () => number;
  /**
   * The grades this row can be stood at, drawn as a picker beside its button, exactly as a
   * starship family's tiers are. Absent on a row that has only one kind of body, which is most of
   * them. The fighters have one because a tier changes how a body fights rather than what it is,
   * and the only other way to choose one is a line typed into the console.
   */
  tiers?: { values: number[]; start: number; label: (t: number) => string };
  /** Stand one ahead of the player at the grade picked, if it has grades; returns a line for the prompt. */
  spawn: (tier?: number) => string;
  /** Take every one away; returns how many. */
  clear: () => number;
  /**
   * Whether this row stands one of the world's own creatures rather than a machine of this browser's.
   * The three rows above the catalogue are this browser's own and are never gated -- that is how a
   * fight is tried with no server at all -- except the one that stands a real creature out of the
   * catalogue: on a shared world that one belongs to the world, so it is gated with the rest and the
   * same creature is stood from the catalogue below, where everybody sees it.
   */
  world?: boolean;
}

/** What one spawn from the panel did: how many stood, and a sentence for the count line (the refusal when none did). */
export interface SpawnReport {
  spawned: number;
  note: string;
}

/**
 * The starships of the NPC tab: the NPC ship families by faction (one row per hull family, with the tiers it
 * has), stood ahead of the view one at a time or three in their faction's formation. Built by the game at
 * click time; `missing` is the sentence to show instead when the ships pack has no combat file.
 */
export interface ShipSpawner {
  families(): { faction: string; label: string; rows: { family: string; label: string; tiers: number[] }[] }[];
  /** The tier a row starts at: the zone's (3 on a planet). */
  defaultTier(): number;
  /** Stand one, or three in formation; resolves to the sentence for the count line. */
  spawn(family: string, tier: number, count: 1 | 3): Promise<string>;
  /** Take away the NPC ships of a family (every one with none); returns how many. */
  clear(family?: string): number;
  count(family: string): number;
  missing: string | null;
}

/**
 * What a server holding the world's creatures lets this browser do from here.
 *
 * Nothing stands in a world on its own any more: what is alive there was stood by an admin, and what
 * an admin stands belongs to the world rather than to the browser that asked -- everyone connected
 * sees it, one browser thinks for it, and it is handed over between them. So with a server on the
 * line a spawn is *asked for* rather than stood: what comes back from the server is what is stood,
 * and the admin's own browser takes the very same path as everybody else's. Anyone who is not an
 * admin may look at the whole catalogue and stand nothing; their buttons say so rather than failing
 * quietly when pressed.
 *
 * With no server (`shared()` false, which is also what no `world` at all means) the tab is exactly
 * what it has always been: every spawn is this browser's own and is stood here.
 */
export interface WorldSpawns extends WorldSpawnGate {
  /** Ask the server for `n` of an entry ahead of the player; the report is what to say now. */
  ask(entry: MobileEntry, n: number): SpawnReport;
  /**
   * Ask for everything the filter picks to be taken down; how many went. What the world holds is
   * asked for over the wire; anything of this browser's own that the filter picks (a machine row's
   * creature stood before the server was there) is taken down here, or a row's "clear" would stop
   * working the moment the browser connected.
   */
  askClear(filter: (e: MobileEntry) => boolean): number;
  /**
   * Ask the server to take down everything the world holds here. True when the word went out. What
   * the world holds is never thrown away locally: one browser pressing "Clear all" must not empty a
   * shared world off its own screen while everybody else still sees it -- and if this browser is the
   * one thinking for those creatures, the bodies it was thinking for would go with no word sent.
   */
  askClearAll(): boolean;
}

/** What the panel needs from the game. The catalogue is a getter: it may land after the tab is first opened. */
export interface SpawnerDeps {
  /** The machines of the old tab: the turret, the fighter, this planet's creature. */
  kinds: NpcKind[];
  /** The NPC starships, when the game offers them. */
  ships?: ShipSpawner;
  catalogue(): MobileCatalogue | null;
  /** Out and loading, by entry id. */
  counts(): Map<string, { out: number; loading: number }>;
  /** How many stood by hand are out, and how many may be. */
  live(): number;
  cap(): number;
  /** Stand `n` of an entry ahead of the player. */
  spawn(entry: MobileEntry, n?: number): SpawnReport;
  /** Take away every one stood by hand that the filter picks; returns how many. */
  clear(filter: (e: MobileEntry) => boolean): number;
  /** Take away everything stood by hand, the machines too; returns how many. */
  clearAll(): number;
  /**
   * Take away only what is this browser's own -- the machines, the fighters, the NPC ships and any
   * creature with no name in the world's list -- leaving what the world holds where it is. It is
   * what "Clear all" does on a shared world, beside asking the server to clear the rest for
   * everybody. Left out, a shared world's "Clear all" asks the server and takes nothing away here.
   */
  clearMachines?(): number;
  /** The line to show when there is no catalogue. */
  missing: string;
  /**
   * The world's own rules about standing things, when a server is holding them. Left out (or with
   * `shared()` false) the tab stands everything itself, exactly as it always did.
   */
  world?: WorldSpawns;
}

/** Rows drawn per group at a time. */
const PAGE = 120;
/** How many a group's "one of each" stands. */
const ONE_OF_EACH = 8;
/** The category chips, in order: all, then each category the tree has. */
const CHIPS = ['all', 'creature', 'droid', 'npc', 'dressed', 'special', 'extras'] as const;
const CHIP_LABELS: Record<string, string> = { all: 'all', creature: 'creatures', droid: 'droids', npc: 'NPCs', dressed: 'dressed', special: 'specials', extras: 'holograms, pets…' };

export class NpcUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly readyOnly: HTMLInputElement;
  private readonly chips: HTMLElement;
  private deps: SpawnerDeps | null = null;
  /** The catalogue the body was last drawn for (a fresh one is drawn when it lands). */
  private drawnFor: MobileCatalogue | null | undefined = undefined;
  private readonly groups = new GroupState();
  /** Every group of the tree, and of the last search, by key. */
  private readonly groupsByKey = new Map<string, { label: string; entries: readonly MobileEntry[] }>();
  /** How many rows each group has drawn so far. */
  private readonly drawn = new Map<string, number>();
  private chip: (typeof CHIPS)[number] = 'all';
  private findTimer = 0;
  private refreshTimer = 0;
  /** The last thing said on the count line, kept until the next action. */
  private note = '';
  /** The world's refusal as the buttons last wore it, so nothing is written while it stands still. */
  private gate = '';
  /** And whether the world was holding its own creatures then: the machine rows turn on that alone. */
  private gateShared = false;
  /** Each starship row's chosen tier, by family, kept across renders (the catalogue landing redraws the body). */
  private readonly shipTiers = new Map<string, number>();
  /** And each machine row's, for the rows that have grades (the fighters). Kept the same way and for the same reason. */
  private readonly kindTiers = new Map<string, number>();
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'npcs';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(SPAWNER_TABS, 'npcs')}
          <span class="count"></span>
          <input class="find" placeholder="find a creature or NPC" spellcheck="false" />
          <label class="ready-only" title="leave out what cannot be stood"><input type="checkbox" /> ready only</label>
          <button class="clear-all" title="take away everything stood from here">Clear all</button>
          <button class="close">Close <b>B</b></button>
          <div class="mob-chips"></div>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body mob-body"></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.mob-body')!;
    this.count = this.root.querySelector('.count')!;
    this.find = this.root.querySelector('.find')!;
    this.readyOnly = this.root.querySelector('.ready-only input')!;
    this.chips = this.root.querySelector('.mob-chips')!;
    this.chips.innerHTML = CHIPS.map((c) => `<button class="mob-chip${c === this.chip ? ' on' : ''}" data-chip="${c}">${escapeHtml(CHIP_LABELS[c])}</button>`).join('');
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'npcs', (id) => this.onTab(id));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.find.addEventListener('input', () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.render(), 140);
    });
    this.readyOnly.addEventListener('change', () => this.render());
    this.chips.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-chip]');
      if (!b) return;
      this.chip = b.dataset.chip as (typeof CHIPS)[number];
      for (const c of this.chips.querySelectorAll<HTMLButtonElement>('button[data-chip]')) c.classList.toggle('on', c === b);
      this.render();
    });
    this.root.querySelector('.clear-all')!.addEventListener('click', () => this.clearEverything());
    // One listener for every button in the body, by what it is for.
    this.body.addEventListener('click', (e) => this.onClick(e));
    // A starship row's tier, kept by family; and a machine row's grade, kept by its id.
    this.body.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel?.tagName !== 'SELECT') return;
      const tier = Number(sel.value);
      if (!Number.isFinite(tier)) return;
      if (sel.dataset.shipTier !== undefined) this.shipTiers.set(sel.dataset.shipTier, tier);
      else if (sel.dataset.kindTier !== undefined) this.kindTiers.set(sel.dataset.kindTier, tier);
    });
    // A group opened for the first time builds its rows ('toggle' does not bubble: caught on the way down).
    this.body.addEventListener(
      'toggle',
      (e) => {
        const d = e.target as HTMLDetailsElement;
        if (d?.tagName === 'DETAILS' && d.open) this.fill(d.dataset.key ?? '');
      },
      true,
    );
  }

  /** What the panel spawns from and counts; called every time the tab is opened. */
  attach(deps: SpawnerDeps): void {
    this.deps = deps;
    this.drawnFor = undefined;
    if (this.open) this.render();
  }

  /** Put a sentence on the count line until the next refresh says otherwise. */
  private say(note: string): void {
    this.note = note;
    this.refresh();
  }

  /**
   * Why this browser may not stand or take down a creature just now, or '' when it may. It is only
   * ever a refusal of the world's: with no server, or with one that leaves the creatures to each
   * browser, this is empty and nothing about the tab changes.
   */
  private whyNotSpawn(): string {
    return spawnRefusal(this.deps?.world);
  }

  /**
   * Why one of the machine rows above the catalogue is off, or '' when it is not one the world holds.
   * Two of the three are this browser's own whatever the server says; the one that stands a real
   * creature out of the catalogue is the world's on a shared world, and is refused there for the
   * admin as well, since the same creature is stood from the catalogue below where everybody sees it.
   */
  private whyNotKind(k: NpcKind): string {
    if (!k.world) return '';
    const w = this.deps?.world;
    if (!w || !w.shared()) return '';
    return this.whyNotSpawn() || WORLD_HOLDS_IT;
  }

  /** One button wearing a refusal, or wearing its own tooltip again. Nothing is written twice. */
  private wear(b: HTMLButtonElement, why: string): void {
    if (b.disabled !== !!why) b.disabled = !!why;
    if (why) {
      if (b.dataset.tipWas === undefined) b.dataset.tipWas = b.title;
      if (b.title !== why) b.title = why;
    } else if (b.dataset.tipWas !== undefined) {
      b.title = b.dataset.tipWas;
      delete b.dataset.tipWas;
    }
  }

  /**
   * Put the refusal on every button that would change the world, or take it off again. Called when
   * the body is drawn and whenever the answer moves, never on a frame and never on a refresh that
   * changed nothing: a steady second writes nothing at all. "Clear all" lives in the header rather
   * than in the body, so it is reached by name: it is the one press that would otherwise empty a
   * shared world off this screen alone.
   */
  private applyGate(force = false): void {
    const why = this.whyNotSpawn();
    const shared = !!this.deps?.world?.shared();
    if (!force && why === this.gate && shared === this.gateShared) return;
    this.gate = why;
    this.gateShared = shared;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-spawn], button[data-clear], button[data-group-spawn], button[data-group-clear]')) this.wear(b, why);
    const all = this.root.querySelector<HTMLButtonElement>('.clear-all');
    if (all) this.wear(all, why);
    // The machine rows: each asks for itself, since only one of the three is ever the world's.
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-kind-spawn], button[data-kind-clear]')) {
      const id = b.dataset.kindSpawn ?? b.dataset.kindClear ?? '';
      const k = this.deps?.kinds.find((x) => x.id === id);
      this.wear(b, k ? this.whyNotKind(k) : '');
    }
  }

  /**
   * "Clear all". Offline it is exactly what it always was. On a shared world what the world holds is
   * not this browser's to throw away: the server is asked to take it down for everyone, and only
   * what is this browser's own goes here.
   */
  private clearEverything(): void {
    const deps = this.deps;
    if (!deps) return;
    const w = deps.world;
    if (!w || !w.shared()) {
      this.say(`${deps.clearAll()} taken away`);
      return;
    }
    const why = this.whyNotSpawn();
    if (why) {
      this.applyGate(true);
      this.say(why);
      return;
    }
    const asked = w.askClearAll();
    const mine = deps.clearMachines ? deps.clearMachines() : 0;
    if (!asked) {
      this.say(mine ? `${mine} of this browser’s own taken away; the server is not holding the world’s creatures yet` : 'the server is not holding the world’s creatures yet');
      return;
    }
    this.say(mine ? `the world’s creatures asked to go, and ${mine} of this browser’s own taken away` : 'the world’s creatures asked to go');
  }

  /** Whether an entry can be stood at all, and if not the sentence that says why (the permanent gap first). */
  private unavailable(e: MobileEntry, cat: MobileCatalogue): string | null {
    const gap = permanentGap(e, cat.file.failed);
    if (gap) return gap;
    const r = cat.ready(e);
    return r.ok ? null : r.why;
  }

  /** The body: the machines, then either the catalogue's groups (headings only) or the search's hits. */
  render(): void {
    const deps = this.deps;
    if (!deps) return;
    const cat = deps.catalogue();
    this.drawnFor = cat;
    this.groupsByKey.clear();
    this.drawn.clear();
    const parts: string[] = [this.kindsHtml(deps), this.shipsHtml(deps)];
    const query = this.find.value.trim();
    if (!cat) {
      parts.push(`<div class="mob-missing">${escapeHtml(deps.missing)}</div>`);
    } else if (query) {
      parts.push(this.searchHtml(cat, query));
    } else {
      for (const kind of cat.groups()) {
        if (this.chip !== 'all' && kind.key !== this.chip) continue;
        for (const g of kind.groups) parts.push(this.groupHeadHtml(cat, g, this.groups.isOpen(g.key, false)));
      }
    }
    this.body.innerHTML = parts.join('');
    this.groups.wire(this.body);
    // Groups that are open (by hand earlier, or every group of a search) are filled now.
    for (const d of this.body.querySelectorAll<HTMLDetailsElement>('details.cat-group[open]')) this.fill(d.dataset.key ?? '');
    // The world's refusal, if there is one, onto every button that has just been drawn.
    this.applyGate(true);
    this.refresh();
  }

  private kindsHtml(deps: SpawnerDeps): string {
    const rows = deps.kinds.map((k) => {
      const id = escapeHtml(k.id);
      // The grade picker, where a row has grades, drawn as a starship family's tier is and kept
      // across a redraw the same way, so the two read alike in the same tab.
      let picker = '';
      if (k.tiers) {
        const kept = this.kindTiers.get(k.id);
        const want = kept !== undefined && k.tiers.values.includes(kept) ? kept : k.tiers.start;
        const options = k.tiers.values.map((t) => `<option value="${t}"${t === want ? ' selected' : ''}>${escapeHtml(k.tiers!.label(t))}</option>`).join('');
        picker = `<select class="ship-tier" data-kind-tier="${id}" title="how well this one fights">${options}</select>`;
      }
      return `<div class="cat-item" title="${escapeHtml(k.blurb)}"><span class="cat-name">${escapeHtml(k.label)} <small>${escapeHtml(k.blurb)}</small></span><span class="cat-hands">${picker}<span class="cat-badge" data-kind-count="${id}"></span><button data-kind-spawn="${id}" title="stand one ahead of you">spawn</button><button data-kind-clear="${id}" title="take every one away">clear</button></span></div>`;
    });
    return groupHtml('kinds', 'Machines and fighters', deps.kinds.length, 'stood ahead of you, facing you', this.groups.isOpen('kinds', true), rows.join(''));
  }

  /**
   * The starships: a folding group per faction, a row per hull family with its tier picker, its count and
   * one, patrol and clear. No element here carries `data-count`, which `refresh` rewrites for the catalogue's rows.
   * With no combat file, one line with the command that makes it.
   */
  private shipsHtml(deps: SpawnerDeps): string {
    const ships = deps.ships;
    if (!ships) return '';
    if (ships.missing) return `<div class="mob-missing">${escapeHtml(ships.missing)}</div>`;
    const note = 'flies at you from about 700 m ahead; hostile ones attack your ship; nothing moves while this panel is open';
    const start = ships.defaultTier();
    const out: string[] = [];
    for (const g of ships.families()) {
      if (!g.rows.length) continue;
      const rows = g.rows.map((r) => {
        const fam = escapeHtml(r.family);
        const style = /_(s\d\d)$/.exec(r.family)?.[1];
        const tiers = r.tiers.length ? r.tiers : [1];
        const kept = this.shipTiers.get(r.family);
        // The zone's tier, or the family's nearest to it.
        const want = kept !== undefined && tiers.includes(kept) ? kept : tiers.reduce((best, t) => (Math.abs(t - start) < Math.abs(best - start) ? t : best), tiers[0]);
        const options = tiers.map((t) => `<option${t === want ? ' selected' : ''}>${t}</option>`).join('');
        return `<div class="cat-item ship-row" data-ship-row="${fam}" title="${fam}"><span class="cat-name">${escapeHtml(r.label)}${style ? ` <small>${escapeHtml(style)}</small>` : ''}</span><span class="cat-hands"><select class="ship-tier" data-ship-tier="${fam}" title="tier">${options}</select><span class="cat-badge" data-ship-count="${fam}"></span><button data-ship-one="${fam}" title="stand one ahead of you">one</button><button data-ship-patrol="${fam}" title="stand three in formation ahead of you">patrol</button><button data-ship-clear="${fam}" title="take away every one of this family, a patrol's too (a patrol comes back later)">clear</button></span></div>`;
      });
      const key = `ships:${g.faction}`;
      out.push(groupHtml(key, g.label, g.rows.length, note, this.groups.isOpen(key, false), rows.join('')));
    }
    return out.join('');
  }

  /** The tier a starship row has picked (its select, else the kept one, else the zone's). */
  private shipTier(family: string): number {
    for (const el of this.body.querySelectorAll<HTMLSelectElement>('select[data-ship-tier]')) {
      if (el.dataset.shipTier === family) {
        const n = Number(el.value);
        if (Number.isFinite(n)) return n;
      }
    }
    return this.shipTiers.get(family) ?? this.deps?.ships?.defaultTier() ?? 1;
  }

  /** A group's heading with its buttons, its rows left to `fill`. */
  private groupHeadHtml(cat: MobileCatalogue, g: { key: string; label: string; note: string; entries: readonly MobileEntry[] }, open: boolean): string {
    const entries = this.readyOnly.checked ? g.entries.filter((e) => !this.unavailable(e, cat)) : g.entries;
    this.groupsByKey.set(g.key, { label: g.label, entries });
    const k = escapeHtml(g.key);
    const actions = `<span class="group-actions"><span class="cat-badge" data-group-count="${k}"></span><button data-group-spawn="${k}" title="stand the first ${ONE_OF_EACH} that can be">one of each</button><button data-group-clear="${k}" title="take away every one of this group stood from here">clear</button></span>`;
    return groupShell(g.key, g.label, entries.length, g.note, open, actions);
  }

  /** The best matches, under their own groups' headings, every group open. */
  private searchHtml(cat: MobileCatalogue, query: string): string {
    const kind = this.chip === 'all' || this.chip === 'extras' ? undefined : this.chip;
    let hits = cat.search(query, { kind, limit: 200 });
    if (this.chip === 'extras') hits = hits.filter((e) => placeOf(e).kind === 'extras');
    else if (kind) hits = hits.filter((e) => placeOf(e).kind === kind);
    if (!hits.length) return `<div class="mob-missing">nothing in the catalogue matches “${escapeHtml(query)}”</div>`;
    const byGroup = new Map<string, { key: string; label: string; note: string; entries: MobileEntry[] }>();
    for (const e of hits) {
      const p = placeOf(e);
      const key = `find:${p.key}`;
      let g = byGroup.get(key);
      if (!g) {
        g = { key, label: p.label, note: p.note, entries: [] };
        byGroup.set(key, g);
      }
      g.entries.push(e);
    }
    return [...byGroup.values()].map((g) => this.groupHeadHtml(cat, g, true)).join('');
  }

  /** Draw the next page of a group's rows into its grid. */
  private fill(key: string): void {
    const g = this.groupsByKey.get(key);
    const cat = this.deps?.catalogue();
    if (!g || !cat) return;
    const grid = this.gridOf(key);
    if (!grid) return;
    const from = this.drawn.get(key) ?? 0;
    if (from > 0 && from >= g.entries.length) return;
    if (from === 0 && grid.childElementCount) return;
    const to = Math.min(g.entries.length, from + PAGE);
    const rows: string[] = [];
    for (let i = from; i < to; i++) rows.push(this.rowHtml(g.entries[i], cat));
    grid.querySelector('.mob-more')?.remove();
    grid.insertAdjacentHTML('beforeend', rows.join(''));
    if (to < g.entries.length) grid.insertAdjacentHTML('beforeend', `<div class="cat-wide mob-more"><button data-more="${escapeHtml(key)}">show the next ${Math.min(PAGE, g.entries.length - to)} of ${g.entries.length - to} more</button></div>`);
    this.drawn.set(key, to);
    // The rows just drawn have their own spawn and clear buttons, which the world may be refusing.
    this.applyGate(true);
    this.refresh();
  }

  private gridOf(key: string): HTMLElement | null {
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-body]')) if (el.dataset.body === key) return el;
    return null;
  }

  /** One entry: its name and subtitle, a tooltip with what it is, its count, and spawn and clear. */
  private rowHtml(e: MobileEntry, cat: MobileCatalogue): string {
    const why = this.unavailable(e, cat);
    const short = e.outfitReady === false;
    const s = e.stats;
    const facts = [e.id, e.group, s ? `${Math.round(s.hp)} health` : '', s?.aggression ?? '', s ? `reach ${s.reach.toFixed(1)} m` : '', s?.ranged ? `shoots to ${Math.round(s.ranged.range)} m` : ''].filter(Boolean).join(' · ');
    const title = `${facts}${why ? `\n${why}` : ''}${short ? `\nthe outfit is short: ${e.outfitNotReady ?? 'some pieces were not converted'}` : ''}`;
    const sub = e.subtitle ? ` <small>${escapeHtml(e.subtitle)}</small>` : '';
    const tag = why ? ' <small class="mob-tag">unavailable</small>' : short ? ' <small class="mob-tag">outfit short</small>' : '';
    const id = escapeHtml(e.id);
    return `<div class="cat-item mob-row${why ? ' unavailable' : ''}${short ? ' short' : ''}" data-entry="${id}" title="${escapeHtml(title)}"><span class="cat-name">${escapeHtml(e.name)}${sub}${tag}</span><span class="cat-hands"><span class="cat-badge" data-count="${id}"></span><button data-spawn="${id}" title="${why ? escapeHtml(why) : 'stand one ahead of you'}">spawn</button><button data-clear="${id}" title="take away every one stood from here">clear</button></span></div>`;
  }

  /**
   * Stand one, or ask for one. With a server holding the world's creatures the spawn goes over the
   * wire and what comes back is what stands, so the admin's own browser takes the same path as every
   * other; with no such server it is stood here, exactly as it always was.
   */
  private askOrStand(deps: SpawnerDeps, entry: MobileEntry, n: number): SpawnReport {
    const w = deps.world;
    if (w && w.shared()) return w.ask(entry, n);
    return deps.spawn(entry, n);
  }

  private onClick(ev: MouseEvent): void {
    const deps = this.deps;
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!deps || !b || !this.body.contains(b)) return;
    const d = b.dataset;
    const cat = deps.catalogue();
    // Buttons in a heading must not fold the group they sit in.
    if (d.groupSpawn !== undefined || d.groupClear !== undefined) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    // A world whose creatures the server holds refuses everything that would change it to anyone but
    // an admin. Such a button is already off, so this is only reached by a click that raced the
    // answer moving; it says why rather than doing nothing. The machines below are not the world's.
    if (d.spawn !== undefined || d.clear !== undefined || d.groupSpawn !== undefined || d.groupClear !== undefined) {
      const why = this.whyNotSpawn();
      if (why) {
        this.applyGate(true);
        this.say(why);
        return;
      }
    }
    // The machine rows are this browser's own, except the one that stands a real creature out of the
    // catalogue: on a shared world that one is the world's and says so rather than standing one only
    // this browser can see.
    if (d.kindSpawn !== undefined || d.kindClear !== undefined) {
      const k = deps.kinds.find((x) => x.id === (d.kindSpawn ?? d.kindClear));
      const why = k ? this.whyNotKind(k) : '';
      if (why) {
        this.applyGate(true);
        this.say(why);
        return;
      }
    }
    if (d.kindSpawn !== undefined) {
      const k = deps.kinds.find((x) => x.id === d.kindSpawn);
      // The grade the picker is on, else the row's own default. A row with no grades is handed
      // nothing and behaves exactly as it did.
      if (k) this.say(k.spawn(k.tiers ? (this.kindTiers.get(k.id) ?? k.tiers.start) : undefined));
    } else if (d.kindClear !== undefined) {
      const k = deps.kinds.find((x) => x.id === d.kindClear);
      if (k) this.say(`${k.clear()} taken away`);
    } else if (d.spawn !== undefined && cat) {
      const e = cat.byId(d.spawn);
      if (e) this.say(this.askOrStand(deps, e, 1).note);
    } else if (d.clear !== undefined) {
      const id = d.clear;
      const pick = (e: MobileEntry) => e.id === id;
      const shared = deps.world?.shared() ? deps.world : null;
      this.say(shared ? `${shared.askClear(pick)} asked to go` : `${deps.clear(pick)} taken away`);
    } else if (d.groupSpawn !== undefined && cat) {
      const g = this.groupsByKey.get(d.groupSpawn);
      if (!g) return;
      // Stops at the first refusal (the cap, the memory budget) and says it, rather than failing quietly.
      const picks = groupPicks(g.entries, ONE_OF_EACH, (e) => !this.unavailable(e, cat));
      let stood = 0;
      let refusal = '';
      for (const e of picks) {
        const r = this.askOrStand(deps, e, 1);
        stood += r.spawned;
        if (!r.spawned) {
          refusal = r.note;
          break;
        }
      }
      const asked = deps.world?.shared() ? 'asked for' : 'stood';
      this.say(refusal ? `${stood} ${asked}; ${refusal}` : `${stood} of ${g.label.toLowerCase()} ${asked}`);
    } else if (d.groupClear !== undefined) {
      const g = this.groupsByKey.get(d.groupClear);
      if (!g) return;
      const ids = new Set(g.entries.map((e) => e.id));
      const pick = (e: MobileEntry) => ids.has(e.id);
      const shared = deps.world?.shared() ? deps.world : null;
      this.say(shared ? `${shared.askClear(pick)} asked to go` : `${deps.clear(pick)} taken away`);
    } else if (d.more !== undefined) {
      this.fill(d.more);
    } else if ((d.shipOne !== undefined || d.shipPatrol !== undefined) && deps.ships) {
      const family = (d.shipOne ?? d.shipPatrol)!;
      const count: 1 | 3 = d.shipOne !== undefined ? 1 : 3;
      this.say(`standing ${count === 1 ? 'one' : 'a patrol'}…`);
      void deps.ships.spawn(family, this.shipTier(family), count).then(
        (s) => this.say(s),
        (err: unknown) => this.say(`not stood: ${err instanceof Error ? err.message : String(err)}`),
      );
    } else if (d.shipClear !== undefined && deps.ships) {
      this.say(`${deps.ships.clear(d.shipClear)} taken away`);
    }
  }

  /** The counts, in place: the header, each drawn row's badge, each group's, each machine's. */
  private refresh(): void {
    const deps = this.deps;
    if (!deps || !this.open) return;
    // The catalogue landed while the tab was open: the tree is drawn now.
    if (deps.catalogue() !== this.drawnFor) {
      this.render();
      return;
    }
    // Connecting, disconnecting or being made an admin moves the world's answer while the tab is
    // open: the buttons follow it here, and write nothing on a refresh where it has not moved.
    this.applyGate();
    const counts = deps.counts();
    // The machines and fighters stood from here (the planet's creature row counts its wildlife too, so it is left out).
    const machines = deps.kinds.reduce((n, k) => n + (k.id === 'creature' ? 0 : k.count()), 0);
    const head = `${deps.live()} of ${deps.cap()} out${machines ? `, ${machines} machines and fighters` : ''}${this.gate ? ` · ${this.gate}` : ''}`;
    this.count.textContent = this.note ? `${head} · ${this.note}` : head;
    this.count.title = this.note;
    const fmt = (c: { out: number; loading: number } | undefined) => (!c || !c.out ? '' : c.loading ? `${c.out} out (${c.loading} loading)` : `${c.out} out`);
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-count]')) {
      const text = fmt(counts.get(el.dataset.count ?? ''));
      if (el.textContent !== text) el.textContent = text;
      el.closest('.mob-row')?.classList.toggle('held', !!text);
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-group-count]')) {
      const g = this.groupsByKey.get(el.dataset.groupCount ?? '');
      let out = 0;
      if (g) for (const e of g.entries) out += counts.get(e.id)?.out ?? 0;
      const text = out ? `${out} out` : '';
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-kind-count]')) {
      const k = deps.kinds.find((x) => x.id === el.dataset.kindCount);
      const n = k?.count() ?? 0;
      const text = n ? `${n} out` : '';
      if (el.textContent !== text) el.textContent = text;
    }
    // The starships' own badges, in a loop of their own.
    const ships = deps.ships;
    if (ships) {
      for (const el of this.body.querySelectorAll<HTMLElement>('[data-ship-count]')) {
        const n = ships.count(el.dataset.shipCount ?? '');
        const text = n ? `${n} out` : '';
        if (el.textContent !== text) el.textContent = text;
      }
    }
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => this.refresh(), 500);
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = 0;
    this.note = '';
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }
}
