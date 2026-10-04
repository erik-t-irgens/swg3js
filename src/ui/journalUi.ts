// The journal window (O): three tabs. **Jobs** -- what is to read (documents handed over and calls waiting, each
// opened from here and never by itself), the jobs offered (their card to read, Accept and Decline), the jobs
// running with their objective lines (Track, Drop and Restart where the job allows them), and the jobs ended
// with how they ended, as facts and never as narrative. **Journal** -- what the character witnessed, in order:
// documents read, conversations had, calls heard, notes the story wrote where the player was, filtered by
// where, by whom and by which job, a page at a time; a document opens as it was read, a conversation as what was
// said, and the player may write a note of their own on any entry, marked as theirs. **File** -- what the ISB
// has on the character that the player may see by now, as one growing dossier: never the weight of anything,
// and never the level it has reached.
//
// It is a panel: it frees the mouse and the game does not simulate while it is up. What it shows is a model it
// is handed, built when it opens and when the story changes, never in a frame, and every change is asked of the
// game, which asks whoever holds the story. A journal's words are kept beside the book by their hash; one whose
// words this browser has not got is shown as being fetched while a server is asked for it, and as not kept when
// nobody kept them.
//
// The note box keeps the chat line's rule for Escape: inside it, Escape puts the note away and is the box's
// alone, so the same press does not also shut the window. Every word goes in with `textContent`, and every
// colour is one of the eighteen.

import { journalFacets, journalPage, minesOn, NOT_KEPT, JOURNAL_TUNE, type JournalEntry } from '../story/journal.ts';
import type { DocItem } from '../story/docRules.ts';
import type { FileView, QuestView } from '../story/view.ts';
import type { TextRef } from '../story/text.ts';

const JOURNAL_CSS = `
#journal .journal-panel { width: min(700px, 94vw); }
#journal .jr-tabs { display: flex; gap: 6px; margin: 0 0 8px; }
#journal .jr-tabs button { padding: 4px 12px; font-size: 12px; color: var(--muted); background: transparent; border: 1px solid var(--rule); border-radius: 4px; cursor: pointer; }
#journal .jr-tabs button.on { color: var(--accent); border-color: var(--edge); }
#journal .jr-body { max-height: min(58vh, 540px); overflow-y: auto; }
#journal .journal-panel.win-sized .jr-body { max-height: none; }
#journal .jr-head { margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
#journal .jr-head:first-child { margin-top: 0; }
#journal .jr-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--ink) 5%, transparent); font-size: 12px; }
#journal .jr-row.sel { background: color-mix(in srgb, var(--accent) 8%, transparent); }
#journal .jr-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
#journal .jr-meta { flex: none; font-size: 11px; color: var(--muted); }
#journal .jr-kind { flex: none; width: 92px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--component); }
#journal .jr-line { padding: 1px 0 1px 18px; font-size: 12px; color: var(--muted); }
#journal .jr-line.done { text-decoration: line-through; opacity: 0.7; }
#journal .jr-row button, #journal .jr-tools button, #journal .jr-mine button { flex: none; padding: 3px 8px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--pool) 30%, transparent); border: 1px solid var(--panel-border); border-radius: 4px; cursor: pointer; }
#journal .jr-row button:hover:not(:disabled), #journal .jr-tools button:hover:not(:disabled), #journal .jr-mine button:hover:not(:disabled) { border-color: var(--accent); }
#journal .jr-row button:disabled, #journal .jr-tools button:disabled { opacity: 0.4; cursor: default; }
#journal .jr-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 11px; color: var(--muted); }
#journal .jr-tools select { font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--void) 45%, transparent); border: 1px solid var(--panel-border); border-radius: 3px; }
#journal .jr-empty { font-size: 12px; color: var(--muted); padding: 8px 0; }
#journal .jr-detail { margin: 8px 0 4px; padding: 8px 10px; border: 1px solid var(--rule); border-radius: 4px; font-size: 13px; line-height: 1.45; }
#journal .jr-said { margin: 0 0 4px; }
#journal .jr-said .who { color: var(--accent); margin-right: 6px; }
#journal .jr-said.you .who { color: var(--muted); }
#journal .jr-mine { display: flex; gap: 6px; margin: 6px 0 0; }
#journal .jr-mine input { flex: 1 1 auto; padding: 3px 6px; font: inherit; font-size: 12px; color: var(--text); background: color-mix(in srgb, var(--void) 45%, transparent); border: 1px solid var(--panel-border); border-radius: 3px; }
#journal .jr-yours { margin: 4px 0 0; font-size: 12px; font-style: italic; color: var(--ink); }
#journal .jr-yours .who { color: var(--good); font-style: normal; margin-right: 6px; }
#journal .jr-dossier { padding: 12px 14px; background: var(--ink); color: var(--void); border-radius: 2px; font-family: 'Courier New', monospace; font-size: 12px; }
#journal .jr-dossier .hd { font-weight: 700; letter-spacing: 0.16em; margin: 0 0 8px; }
#journal .jr-dossier .en { margin: 0 0 8px; padding: 0 0 6px; border-bottom: 1px dashed color-mix(in srgb, var(--void) 35%, transparent); }
#journal .jr-dossier button { margin-left: 6px; padding: 1px 6px; font-size: 11px; color: var(--void); background: transparent; border: 1px solid var(--void); border-radius: 3px; cursor: pointer; }
`;

let styled = false;
function installStyle(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = JOURNAL_CSS;
  document.head.appendChild(style);
}

export type JournalTab = 'jobs' | 'journal' | 'file';

/** What the window is handed: built when it opens and when the story changes. */
export interface JournalModel {
  jobs: QuestView[];
  toRead: DocItem[];
  entries: JournalEntry[];
  file: FileView | null;
  /** A line under the tabs: who holds the story, or why nothing can be done just now. */
  note: string;
}

/** How the window says what it shows: the game's words for texts, worlds, people, jobs and the journal's own words. */
export interface JournalWords {
  text(ref: TextRef): string;
  world(id: string): string;
  who(id: string): string;
  quest(id: string): string;
  /** A journal text by its hash: its words, null while they are not here but may yet be handed over, undefined when nobody kept them. */
  words(h: string): string | null | undefined;
  /** When something happened, as the window says it. */
  when(at: number): string;
}

const KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({ doc: 'Document', talk: 'Conversation', comm: 'Call', note: 'Note', mine: 'Your note' });
const FILE_KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({ intercept: 'INTERCEPT', sighting: 'SIGHTING', associate: 'ASSOCIATE', incident: 'INCIDENT', classification: 'CLASSIFICATION', note: 'NOTE' });

/** A job's state as a fact: how it stands, or how it ended. Never a narrative of what happened. */
export function jobState(q: QuestView): string {
  const how = q.outcome && q.outcome !== 'done' && q.outcome !== 'failed' ? ` (${q.outcome.replace(/[_.-]+/g, ' ')})` : '';
  switch (q.state) {
    case 'offered':
      return 'Offered';
    case 'active':
      return 'Running';
    case 'stalled':
      return q.stalled ? `Held: ${q.stalled}` : 'Held';
    case 'done':
      return `Done${how}`;
    case 'failed':
      return `Failed${how}`;
    default:
      return q.state;
  }
}

export class JournalUi {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  onTab: (tab: JournalTab) => void = () => {};
  onRead: (doc: string) => void = () => {};
  onAccept: (quest: string) => void = () => {};
  onDecline: (quest: string) => void = () => {};
  onTrack: (quest: string, on: boolean) => void = () => {};
  onDrop: (quest: string) => void = () => {};
  onRestart: (quest: string) => void = () => {};
  /** A document or a call in the journal, opened as it was read. */
  onOpenEntry: (entry: JournalEntry) => void = () => {};
  onMine: (ref: string, text: string) => void = () => {};
  /** The words of these entries are not here: ask whoever holds them (each by its place in the whole journal, from nought). */
  onWant: (at: number[]) => void = () => {};
  words: JournalWords = { text: (r) => (typeof r === 'string' ? r : r.en), world: (id) => id, who: (id) => id, quest: (id) => id, words: () => undefined, when: (at) => new Date(at).toLocaleString() };

  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly tabs: HTMLButtonElement[];
  private model: JournalModel = { jobs: [], toRead: [], entries: [], file: null, note: '' };
  private tab: JournalTab = 'jobs';
  private page = Number.POSITIVE_INFINITY;
  private filter: { world: string; who: string; quest: string } = { world: '', who: '', quest: '' };
  private selected = '';
  /** A model that came while a note was being typed, drawn once the box is done with. */
  private typing = false;
  private waiting = false;
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'journal';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel journal-panel">
        <div class="ship-header">
          <h2>Journal</h2>
          <span class="ship-title"></span>
          <button class="close">Close</button>
        </div>
        <div class="ship-body">
          <div class="jr-tabs"><button data-tab="jobs">Jobs</button><button data-tab="journal">Journal</button><button data-tab="file">File</button></div>
          <div class="jr-body"></div>
          <p class="menu-hint jr-note"></p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.jr-body')!;
    this.note = this.root.querySelector('.jr-note')!;
    this.closeButton = this.root.querySelector('.close')!;
    this.closeButton.addEventListener('click', () => this.onClose());
    this.tabs = [...this.root.querySelectorAll<HTMLButtonElement>('.jr-tabs button')];
    for (const b of this.tabs) b.addEventListener('click', () => this.setTab(b.dataset.tab as JournalTab));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get currentTab(): JournalTab {
    return this.tab;
  }

  setKey(cap: string): void {
    this.closeButton.textContent = cap ? `Close (${cap})` : 'Close';
  }

  show(model: JournalModel, tab?: JournalTab): void {
    if (tab) this.tab = tab;
    this.root.classList.remove('hidden');
    this.update(model);
  }

  /** A new model while it is open: drawn now, or once a note being typed is kept or given up. */
  update(model: JournalModel): void {
    this.model = model;
    if (!this.open) return;
    if (this.typing) {
      this.waiting = true;
      return;
    }
    this.draw();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.typing = false;
    this.waiting = false;
  }

  setTab(tab: JournalTab): void {
    this.tab = tab;
    this.onTab(tab);
    if (this.open) this.draw();
  }

  /** Show one entry's detail (a conversation's lines, a note), on the page it is on. */
  select(id: string): void {
    this.selected = id;
    const i = this.model.entries.findIndex((e) => e.id === id);
    if (i >= 0) this.page = Math.floor(this.visibleIndex(id) / JOURNAL_TUNE.page);
    if (this.open) this.draw();
  }

  /** What the window shows, for the console. */
  report(): Record<string, unknown> {
    const page = journalPage(this.model.entries, this.filterOf(), this.page);
    return { open: this.open, tab: this.tab, toRead: this.model.toRead.length, jobs: this.model.jobs.length, entries: this.model.entries.length, page: page.page + 1, pages: page.pages, shown: page.entries.map((e) => e.id), selected: this.selected || null, file: this.model.file?.entries.length ?? 0, filter: { ...this.filter }, writes: this.writes };
  }

  private filterOf(): { world: string | null; who: string | null; quest: string | null } {
    return { world: this.filter.world || null, who: this.filter.who || null, quest: this.filter.quest || null };
  }

  /** Where an entry stands among those the filter lets through (the paging's own order). */
  private visibleIndex(id: string): number {
    const all = journalPage(this.model.entries, this.filterOf(), 0, 1e9).entries;
    return Math.max(0, all.findIndex((e) => e.id === id));
  }

  private draw(): void {
    for (const b of this.tabs) b.classList.toggle('on', b.dataset.tab === this.tab);
    this.note.textContent = this.model.note;
    this.root.querySelector('.ship-title')!.textContent = this.model.toRead.length ? `${this.model.toRead.length} to read` : '';
    if (this.tab === 'jobs') this.drawJobs();
    else if (this.tab === 'journal') this.drawJournal();
    else this.drawFile();
    this.writes += 3;
  }

  private row(parts: (HTMLElement | string)[], cls = 'jr-row'): HTMLElement {
    const r = document.createElement('div');
    r.className = cls;
    r.append(...parts);
    return r;
  }

  private el(tag: string, cls: string, text: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  }

  private button(label: string, then: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', then);
    return b;
  }

  private drawJobs(): void {
    const m = this.model;
    const w = this.words;
    const nodes: HTMLElement[] = [];
    if (m.toRead.length) {
      nodes.push(this.el('div', 'jr-head', 'To read'));
      for (const d of m.toRead) {
        const what = d.from ? `Call from ${d.fromName ? w.text(d.fromName) : w.who(d.from)}` : d.card ? 'Offer' : 'Document';
        nodes.push(this.row([this.el('span', 'jr-kind', what), this.el('span', 'jr-name', d.title), this.el('span', 'jr-meta', d.quest ? w.quest(d.quest) : ''), this.button(d.from ? 'Answer' : 'Read', () => this.onRead(d.id))]));
      }
    }
    const offered = m.jobs.filter((q) => q.state === 'offered');
    const running = m.jobs.filter((q) => q.state === 'active' || q.state === 'stalled');
    const ended = m.jobs.filter((q) => q.state === 'done' || q.state === 'failed');
    if (offered.length) {
      nodes.push(this.el('div', 'jr-head', 'Offered'));
      for (const q of offered) {
        const card = m.toRead.find((d) => d.card && d.quest === q.id);
        nodes.push(this.row([this.el('span', 'jr-name', w.text(q.title)), ...(card ? [this.button('Read the card', () => this.onRead(card.id))] : []), this.button('Accept', () => this.onAccept(q.id)), this.button('Decline', () => this.onDecline(q.id))]));
      }
    }
    nodes.push(this.el('div', 'jr-head', 'Running'));
    if (!running.length) nodes.push(this.el('div', 'jr-empty', 'No job running.'));
    for (const q of running) {
      const tracked = this.trackedOf(q.id);
      nodes.push(this.row([this.el('span', 'jr-name', w.text(q.title)), this.el('span', 'jr-meta', jobState(q)), this.button(tracked ? 'Untrack' : 'Track', () => this.onTrack(q.id, !tracked)), this.button('Drop', () => this.onDrop(q.id), !q.canDrop), this.button('Restart', () => this.onRestart(q.id), !q.canRestart)]));
      for (const l of q.lines) nodes.push(this.el('div', l.done ? 'jr-line done' : 'jr-line', w.text(l.text)));
    }
    if (ended.length) {
      nodes.push(this.el('div', 'jr-head', 'Ended'));
      for (const q of ended) nodes.push(this.row([this.el('span', 'jr-name', w.text(q.title)), this.el('span', 'jr-meta', jobState(q)), ...(q.canRestart ? [this.button('Restart', () => this.onRestart(q.id))] : [])]));
    }
    this.body.replaceChildren(...nodes);
  }

  /** Which jobs are tracked, as the game says: read through the hook so the window holds no copy. */
  trackedOf: (quest: string) => boolean = () => false;

  private drawJournal(): void {
    const m = this.model;
    const w = this.words;
    const facets = journalFacets(m.entries);
    const tools = document.createElement('div');
    tools.className = 'jr-tools';
    const pick = (label: string, key: 'world' | 'who' | 'quest', values: string[], name: (v: string) => string): void => {
      const s = document.createElement('select');
      const all = document.createElement('option');
      all.value = '';
      all.textContent = `${label}: all`;
      s.append(all);
      for (const v of values) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = name(v);
        s.append(o);
      }
      s.value = this.filter[key];
      s.addEventListener('change', () => {
        this.filter[key] = s.value;
        this.page = Number.POSITIVE_INFINITY;
        this.draw();
      });
      tools.append(s);
    };
    pick('Where', 'world', facets.worlds, (v) => w.world(v));
    pick('Who', 'who', facets.who, (v) => w.who(v));
    pick('Job', 'quest', facets.quests, (v) => w.quest(v));
    const p = journalPage(m.entries, this.filterOf(), this.page);
    this.page = p.page;
    tools.append(this.button('‹', () => this.turn(p.page - 1), p.page <= 0), this.el('span', 'jr-meta', `page ${p.page + 1} of ${p.pages}`), this.button('›', () => this.turn(p.page + 1), p.page >= p.pages - 1));
    const nodes: HTMLElement[] = [tools];
    if (!p.entries.length) nodes.push(this.el('div', 'jr-empty', m.entries.length ? 'Nothing written here passes that filter.' : 'Nothing witnessed yet.'));
    // Words this page shows and this browser has not got are asked for, by each entry's place in the journal: the
    // entries listed, and the player's own notes on the one opened, which are entries of their own further on.
    const want: number[] = [];
    // Null is words this browser has not got and may still be handed; whoever asks says when it has asked.
    const wants = (e: JournalEntry): boolean => [e.h, ...(e.lines ?? []).map((l) => l.h)].some((h) => !!h && w.words(h) === null);
    for (const e of p.entries) {
      const sel = e.id === this.selected;
      const r = this.row([this.el('span', 'jr-kind', KIND_WORDS[e.kind] ?? e.kind), this.el('span', 'jr-name', this.entryTitle(e)), this.el('span', 'jr-meta', `${e.place ? w.world(e.place.world) : ''} · ${w.when(e.at)}`), this.button(e.kind === 'doc' || e.kind === 'comm' ? 'Open' : sel ? 'Hide' : 'Show', () => this.openEntry(e))], sel ? 'jr-row sel' : 'jr-row');
      nodes.push(r);
      if (sel) {
        nodes.push(this.detail(e));
        for (const mine of minesOn(m.entries, e.id)) if (wants(mine)) want.push(this.placeOf(mine));
      }
      if (wants(e)) want.push(this.placeOf(e));
    }
    if (want.length) this.onWant(want);
    this.body.replaceChildren(...nodes);
  }

  /** An entry's place in the whole journal, from nought: its id is the next in line when it was written (`j<n>`). */
  private placeOf(e: JournalEntry): number {
    const n = Number(e.id.slice(1)) - 1;
    return this.model.entries[n] === e ? n : this.model.entries.indexOf(e);
  }

  private turn(page: number): void {
    this.page = Math.max(0, page);
    this.selected = '';
    this.draw();
  }

  private entryTitle(e: JournalEntry): string {
    if (e.kind === 'talk') return `${e.title || this.words.who(e.with[0] ?? '')}`;
    if (e.kind === 'note') {
      const t = e.h ? this.words.words(e.h) : undefined;
      // Kept words are words, never a reference to look up again (`{ en }`), whatever they begin with.
      return typeof t === 'string' ? this.words.text({ en: t }) : (e.title ?? 'A note');
    }
    return e.title ?? e.kind;
  }

  private openEntry(e: JournalEntry): void {
    if (e.kind === 'doc' || e.kind === 'comm') {
      this.selected = e.id;
      this.onOpenEntry(e);
      return;
    }
    this.selected = this.selected === e.id ? '' : e.id;
    this.draw();
  }

  /** One entry's own words: a conversation's lines in turn, a note's words, and the player's notes on it with a box for another. */
  private detail(e: JournalEntry): HTMLElement {
    const w = this.words;
    const box = document.createElement('div');
    box.className = 'jr-detail';
    // Kept words are shown as the words they are (`{ en }`): a note that happens to begin `:` or `@` is never
    // taken for one of the client's strings and looked up again. Only a line kept as its reference is.
    const said = (t: string | null | undefined): string => (t === null ? '…' : t === undefined ? NOT_KEPT : w.text({ en: t }));
    if (e.kind === 'talk') {
      const name = e.title || w.who(e.with[0] ?? '');
      for (const l of e.lines ?? []) {
        const line = document.createElement('div');
        line.className = l.you ? 'jr-said you' : 'jr-said';
        const who = this.el('span', 'who', l.you ? 'You:' : `${name}:`);
        line.append(who, l.h ? said(w.words(l.h)) : l.ref ? w.text(l.ref) : NOT_KEPT);
        box.append(line);
      }
    } else if (e.h) box.append(this.el('div', 'jr-said', said(w.words(e.h))));
    for (const mine of minesOn(this.model.entries, e.id)) {
      const y = document.createElement('div');
      y.className = 'jr-yours';
      y.append(this.el('span', 'who', 'Your note:'), mine.h ? said(w.words(mine.h)) : NOT_KEPT);
      box.append(y);
    }
    box.append(this.mineBox(e.id));
    return box;
  }

  /** A box for a note of the player's own on an entry: Enter writes it, Escape puts it away (the box's alone). */
  private mineBox(ref: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'jr-mine';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = JOURNAL_TUNE.mineMax;
    input.placeholder = 'A note of your own on this…';
    const write = (): void => {
      const text = input.value.trim();
      input.value = '';
      this.typing = false;
      if (text) this.onMine(ref, text);
      if (this.waiting) {
        this.waiting = false;
        this.draw();
      }
    };
    input.addEventListener('focus', () => {
      this.typing = true;
    });
    input.addEventListener('blur', () => {
      this.typing = false;
      if (this.waiting) {
        this.waiting = false;
        this.draw();
      }
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.code === 'Escape') {
        // The box's alone: the game's own Escape would shut the window behind it.
        ev.preventDefault();
        ev.stopPropagation();
        input.value = '';
        input.blur();
      } else if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
        ev.preventDefault();
        ev.stopPropagation();
        write();
      }
    });
    wrap.append(input, this.button('Add', write));
    return wrap;
  }

  private drawFile(): void {
    const f = this.model.file;
    const w = this.words;
    const sheet = document.createElement('div');
    sheet.className = 'jr-dossier';
    sheet.append(this.el('div', 'hd', 'ISB · FILE'));
    const entries = f?.entries ?? [];
    if (!entries.length) sheet.append(this.el('div', 'en', 'Nothing on file that you can see.'));
    for (const e of entries) {
      const en = document.createElement('div');
      en.className = 'en';
      en.append(`${w.when(e.at)} · ${FILE_KIND_WORDS[e.kind] ?? e.kind.toUpperCase()}${e.tags.length ? ` · ${e.tags.join(', ')}` : ''}`);
      if (e.doc) {
        const b = document.createElement('button');
        b.textContent = e.docTitle ?? 'Read the page';
        b.addEventListener('click', () => this.onRead(e.doc!));
        en.append(b);
      }
      sheet.append(en);
    }
    this.body.replaceChildren(sheet);
  }
}
