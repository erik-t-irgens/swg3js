// A document read: what may be read, what it says when it is read, and what reading it does. Pure, and the
// one place it is decided: the browser's host and the server's both run it through the shared host loop
// (`hostCore.ts`), so a page reads the same whoever works it out, and the server never hands a browser a
// document's file -- only the page as this character read it, one at a time, and only one it was handed.
//
// **What may be read.** A document handed over and not yet put away (a step's page, a card offered with a job,
// one `doc(d)` handed), one already opened (read again exactly as it was first read), or the page of an entry
// in the ISB's file that the player may see now. Nothing else: a document is never opened by itself, and the
// server opens only what is on this list.
//
// **Read the first time,** a document is worked out as it stands this moment -- the first variant whose
// condition holds, each redaction a bar unless its condition holds, the tokens filled -- and frozen: the page
// is written into the journal by its words' hash, and every later reading of that handing is that page,
// whatever has changed since, the owner's own file included. A document handed over again is a new handing,
// read afresh, and a new entry. **Read to its end** (the window says when its last page is shown), it is put
// away and every step waiting on it is done -- unless its foot still asks for an answer (a card whose job is
// on offer, a choice still open on it), when it stays to read until the answer is given: a choice made at its
// foot, or a card's job taken or turned down, is what puts such a page away.
//
// **Finishing is not showing.** A page whose frozen words this host has not got (a store that was lost, a
// server past its cap) is shown as not kept, and is still read to its end and still answered at its foot; and
// a page the journal is too full to freeze is shown as it reads now and never frozen. Lost words only ever
// cost what is shown, never the job waiting on the page.
//
// **The foot** is worked out at every reading, never frozen: a card's Accept and Decline while its job is on
// offer, with what is at stake and who it is for, and a choice step's options while the step is open, a
// refused one greyed with its reason.

import { ownOf, type StoryBook } from './book.ts';
import { dateText, type DocBlock, type DocDef, type DocSpan, type DocSrc, type DocView, type SrcSpan } from './doc.ts';
import { fileOf, revealed } from './file.ts';
import { NOT_KEPT, textHash, type JournalEntry } from './journal.ts';
import { castFor, whoOf } from './people.ts';
import { evalCond, type Draft, type StoryCtx } from './quests.ts';
import type { OptionDef, StorySet } from './set.ts';
import { literalOf, type TextRef } from './text.ts';

/** The foot of a page: a card's Accept and Decline, or a choice's options. Worked out at every reading. */
export type DocFoot =
  | { k: 'card'; quest: string; title: TextRef; stakes: TextRef | null; client: string; offered: boolean }
  | { k: 'choice'; quest: string; step: string; options: { id: string; label: TextRef; enabled: boolean; stakes?: TextRef }[] };

/** A document as a host hands it to the window: the page as read, its foot, the journal entry it is frozen into, or none with why. */
export interface DocWord {
  doc: string;
  view: DocView | null;
  foot: DocFoot | null;
  entry: string | null;
  why: string | null;
  /** A call, spoken in the conversation band by its caller (`<set>:cast/<id>`, `row:<key>`), rather than shown as paper. */
  from?: string;
  /** The answer to a reading to the end: the window it was read in has the page already, so it opens nothing. */
  end?: true;
}

/** A document still to read, as the interface lists it. */
export interface DocItem {
  id: string;
  title: string;
  kind: DocDef['kind'];
  at: number;
  quest?: string;
  step?: string;
  card?: true;
  /** A call: who calls, and their name as the player knows them. */
  from?: string;
  fromName?: TextRef;
  /** Opened before: reading it again shows it as it was first read. */
  opened?: true;
}

/** The definition of a document in the sets in use, or null. */
export function docIn(lib: StorySet, doc: string): DocDef | null {
  return lib.docs && Object.hasOwn(lib.docs, doc) ? lib.docs[doc] : null;
}

/** Whether a document was handed to a character, read, or is the page of a file entry they may see now. */
export function handed(book: StoryBook, doc: string): boolean {
  return ownOf(book.docs, doc) !== undefined;
}

/** The page of an entry in the ISB's file the player may see now: what makes a file's page one they may read. */
function filePage(book: StoryBook, doc: string, now: number): boolean {
  for (const e of fileOf(book, 'isb')?.entries ?? []) if (e.doc === doc && revealed(e, now, (d) => handed(book, d))) return true;
  return false;
}

/** Why a character may not read a document just now, or null when they may. */
export function whyNotRead(book: StoryBook, lib: StorySet, doc: string, now: number): string | null {
  if (!docIn(lib, doc)) return 'there is no such document';
  if (handed(book, doc) || filePage(book, doc, now)) return null;
  return 'that document was never handed to you';
}

/** A species' id as words: `human_male` reads "Human". */
export function speciesWords(species: string | null | undefined): string {
  const s = (species ?? '').replace(/_(male|female)$/, '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'someone';
}

/** What reading a document fills its tokens and lifts its redactions with. */
export interface ReadCtx {
  /** Whether a condition holds for the reader just now. */
  holds(c: Parameters<typeof evalCond>[0]): boolean;
  player: string;
  species: string;
  /** A person as the reader knows them. */
  npc(who: string): string;
  date: string;
}

function fillTokens(text: string, r: ReadCtx): string {
  return text
    .replace(/\{player\.species\}/g, r.species)
    .replace(/\{player\}/g, r.player)
    .replace(/\{date\}/g, r.date)
    .replace(/\{npc:([^}\s]{1,140})\}/g, (_all, who: string) => r.npc(who));
}

function spansOf(s: SrcSpan[], r: ReadCtx): DocSpan[] {
  const out: DocSpan[] = [];
  for (const x of s) {
    if (typeof x === 'string') out.push(fillTokens(x, r));
    else if (x.redact && r.holds(x.redact)) out.push(fillTokens(x.text, r));
    // A bar as long as the words, and not one of them carried: what the reader is not let see never leaves the host.
    else out.push({ bar: Math.max(1, Math.min(400, fillTokens(x.text, r).length)) });
  }
  return out;
}

/**
 * A document as it reads for one reader at one moment: the first variant whose condition holds (or none), its
 * fills in their slots, every redaction a bar unless its condition holds, every token filled, cut into pages.
 */
export function renderDoc(def: DocDef, r: ReadCtx): DocView {
  const variant = def.variants.find((v) => !v.when || r.holds(v.when)) ?? null;
  const pages: DocBlock[][] = [[]];
  const put = (list: DocSrc[]): void => {
    for (const b of list) {
      const page = pages[pages.length - 1];
      switch (b.t) {
        case 'page':
          pages.push([]);
          break;
        case 'slot':
          if (variant && variant.fills[b.name]) put(variant.fills[b.name]);
          break;
        case 'p':
          page.push({ t: 'p', s: spansOf(b.s, r) });
          break;
        case 'field':
          page.push({ t: 'field', label: fillTokens(b.label, r), value: spansOf(b.value, r) });
          break;
        case 'table':
          page.push({ t: 'table', rows: b.rows.map((row) => row.map((c) => fillTokens(c, r))) });
          break;
        case 'stamp':
        case 'sign':
          page.push({ t: b.t, text: fillTokens(b.text, r) });
          break;
      }
    }
  };
  put(def.body);
  // A trailing page turn leaves an empty last page, which nobody wants to turn to.
  while (pages.length > 1 && !pages[pages.length - 1].length) pages.pop();
  const view: DocView = { id: def.id, kind: def.kind, title: fillTokens(def.title, r), variant: variant?.id ?? null, pages };
  if (def.issuer) view.issuer = fillTokens(def.issuer, r);
  if (def.client) view.client = def.client;
  return view;
}

/** What a reader reads a document with, for this character just now. */
export function readCtxOf(d: Draft, scope: { quest?: string; run?: number }): ReadCtx {
  const c = d.ctx;
  return {
    holds: (cond) => evalCond(cond, d.book, c, scope, d.tally, d.lib),
    player: c.name || 'you',
    species: speciesWords(c.species),
    npc: (who) => {
      const cast = castFor(d.lib, who);
      if (!cast) return 'someone';
      const named = ownOf(d.book.npcs, whoOf(d.lib, who))?.named !== undefined;
      return literalOf(named ? cast.name : cast.unknownAs) ?? 'someone';
    },
    date: dateText(d.lib.calendar, c.now),
  };
}

/** The choice step running whose page this is, with its job, or null: what a choice made on a page answers. */
function choiceOn(book: StoryBook, lib: StorySet, doc: string): { quest: string; step: string; run: number; options: OptionDef[] } | null {
  for (const qid of Object.keys(book.quests ?? {})) {
    const q = book.quests![qid];
    if (q.state !== 'active') continue;
    const def = lib.quests[qid];
    if (!def) continue;
    for (const s of Object.keys(q.steps)) {
      const st = def.steps[s];
      if (!st || st.type !== 'choice' || st.doc !== doc || q.steps[s].state !== 'active' || !st.options) continue;
      return { quest: qid, step: s, run: q.run, options: st.options };
    }
  }
  return null;
}

/**
 * Whether a page's foot still asks for an answer: a card whose job is on offer, or a choice still open on it.
 * Such a page is not put away by being read to its end, and stays to read until it is answered.
 */
export function footAsks(book: StoryBook, lib: StorySet, doc: string): boolean {
  const rec = ownOf(book.docs, doc);
  if (rec?.card && rec.quest && lib.quests[rec.quest]) return ownOf(book.quests, rec.quest)?.state === 'offered';
  return choiceOn(book, lib, doc) !== null;
}

/** The foot of a document for this character just now: its card's Accept and Decline, or its choice's options. */
export function footOf(book: StoryBook, lib: StorySet, doc: string, ctx: StoryCtx): DocFoot | null {
  const rec = ownOf(book.docs, doc);
  // A card: its job's offer, answered at its foot while the job is on offer.
  if (rec?.card && rec.quest) {
    const def = lib.quests[rec.quest];
    const q = ownOf(book.quests, rec.quest);
    if (def) return { k: 'card', quest: rec.quest, title: def.title, stakes: def.stakes, client: def.client, offered: q?.state === 'offered' };
  }
  // A choice made on this page: the step running that names it.
  const c = choiceOn(book, lib, doc);
  if (!c) return null;
  const scope = { quest: c.quest, run: c.run, step: c.step };
  return {
    k: 'choice',
    quest: c.quest,
    step: c.step,
    options: c.options.map((o) => ({ id: o.id, label: o.label ?? o.id, enabled: !o.when || evalCond(o.when, book, ctx, scope, undefined, lib), ...(o.stakes ? { stakes: o.stakes } : {}) })),
  };
}

/**
 * A page whose frozen words this host has not got: its title as the journal kept it and one line saying the
 * page was not kept. Shown so the page can still be read to its end and answered at its foot.
 */
export function unkeptView(def: DocDef, entry: JournalEntry | null): DocView {
  const view: DocView = { id: def.id, kind: def.kind, title: entry?.title ?? def.title, variant: entry?.variant ?? null, pages: [[{ t: 'p', s: [NOT_KEPT] }]] };
  return view;
}

/** Whether a page is one saying its words were not kept (`unkeptView`): never kept as words of its own. */
export function isUnkeptView(view: DocView): boolean {
  const only = view.pages.length === 1 && view.pages[0].length === 1 ? view.pages[0][0] : null;
  return !!only && only.t === 'p' && only.s.length === 1 && only.s[0] === NOT_KEPT;
}

/**
 * A document opened: the frozen page when this handing was opened before (looked up by the words' hash in
 * `texts`), or, the first time, the page worked out now, written into the journal and frozen. `end` says the
 * reader has reached its last page, which puts it away and does every step waiting on it -- unless its foot
 * still asks for an answer (`footAsks`), when it stays to read until the answer is given. Words that were not
 * kept, or a journal too full to freeze the page in, cost only what is shown (`unkeptView`, an unfrozen page),
 * never the reading. The word for the window, with no view and why when it may not be read.
 */
export function readDocWork(d: Draft, doc: string, end: boolean, texts: (h: string) => string | undefined): DocWord {
  const def = docIn(d.lib, doc);
  const no = (why: string): DocWord => ({ doc, view: null, foot: null, entry: null, why });
  const why = whyNotRead(d.book, d.lib, doc, d.ctx.now);
  if (why || !def) return no(why ?? 'there is no such document');
  let rec = ownOf(d.book.docs, doc);
  // A file's page the player may now see, never handed over: it is handed as it is first read.
  if (!rec) {
    if (!d.change({ k: 'docGive', doc, at: d.ctx.now })) return no(d.why ?? 'that document could not be opened');
    rec = ownOf(d.book.docs, doc)!;
  }
  let view: DocView | null = null;
  let entry: JournalEntry | null = null;
  if (rec.j) {
    // Read before: the page as it was read then, never worked out again -- or, its words lost, a page saying so.
    entry = (d.book.journal ?? []).find((e) => e.id === rec!.j) ?? null;
    const text = entry?.h ? texts(entry.h) : undefined;
    if (text) {
      try {
        view = JSON.parse(text) as DocView;
      } catch {
        view = null;
      }
    }
    view ??= unkeptView(def, entry);
  } else {
    const q = rec.quest ? ownOf(d.book.quests, rec.quest) : undefined;
    view = renderDoc(def, readCtxOf(d, { quest: rec.quest, run: q?.run }));
    const text = JSON.stringify(view);
    const h = textHash(text);
    const from = rec.from ?? null;
    entry = d.writeJournal(
      {
        kind: from ? 'comm' : 'doc',
        with: from ? [from] : [],
        doc,
        ...(view.variant ? { variant: view.variant } : {}),
        title: view.title,
        h,
        ...(rec.quest ? { quest: rec.quest } : {}),
      },
      { [h]: text },
    );
    // A journal too full to take the page: it is shown as it reads now, never frozen, and read on as any page
    // is (the refusal stands as the answer's why, so the player is told).
    if (entry) {
      d.change({ k: 'docOpen', doc, j: entry.id });
      d.notes.push({ k: 'journal', quest: rec.quest ?? 'run', title: view.title });
    }
  }
  // Read to its end the first time only: a page read again from the journal does nothing more, and one whose
  // foot still asks for an answer waits for it.
  if (end && rec.done === undefined && !footAsks(d.book, d.lib, doc)) {
    const w = d.docDone(doc);
    if (w) d.why ??= w;
  }
  return { doc, view, foot: footOf(d.book, d.lib, doc, d.ctx), entry: entry?.id ?? null, why: null, ...(rec.from ? { from: rec.from } : {}) };
}

/** A choice made at a document's foot: the step running on that page chosen by its option, the page put away with it. */
export function pickDocWork(d: Draft, doc: string, option: string): string | null {
  const foot = footOf(d.book, d.lib, doc, d.ctx);
  if (!foot || foot.k !== 'choice') return 'there is nothing to choose on that page';
  return d.choose(foot.quest, foot.step, option);
}

/**
 * Every document a character has still to read, newest last: handed over and not put away -- a card only while
 * its job is still on offer -- with its title, where it came from and, for a call, who calls by the name the
 * player knows them by.
 */
export function docsToRead(book: StoryBook, lib: StorySet): DocItem[] {
  const out: DocItem[] = [];
  // The pages a choice is still open on, once for the whole list.
  const asking = new Set<string>();
  for (const qid of Object.keys(book.quests ?? {})) {
    const q = book.quests![qid];
    const def = q.state === 'active' ? lib.quests[qid] : undefined;
    if (!def) continue;
    for (const s of Object.keys(q.steps)) {
      const st = def.steps[s];
      if (st?.type === 'choice' && st.doc && q.steps[s].state === 'active') asking.add(st.doc);
    }
  }
  for (const id of Object.keys(book.docs ?? {})) {
    const rec = book.docs![id];
    // Put away, unless a choice is still open on it (a book from before a page with a question waited for its
    // answer): that page is where the choice is made, and must be found again.
    if (rec.done !== undefined && !asking.has(id)) continue;
    if (rec.card && rec.quest && ownOf(book.quests, rec.quest)?.state !== 'offered') continue;
    const def = docIn(lib, id);
    if (!def) continue;
    const item: DocItem = { id, title: def.title, kind: def.kind, at: rec.at };
    if (rec.quest) item.quest = rec.quest;
    if (rec.step) item.step = rec.step;
    if (rec.card) item.card = true;
    if (rec.from) {
      item.from = rec.from;
      const c = castFor(lib, rec.from);
      if (c) item.fromName = ownOf(book.npcs, whoOf(lib, rec.from))?.named !== undefined ? c.name : c.unknownAs;
    }
    if (rec.j) item.opened = true;
    out.push(item);
  }
  out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return out;
}

/** A word about a document handed to the window, cleaned off the wire. The view and its foot are rebuilt the house way. */
export function cleanDocFoot(x: unknown): DocFoot | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const QUEST = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
  const STEP = /^[A-Za-z0-9_.-]{1,48}$/;
  const text = (v: unknown): TextRef | null => {
    if (typeof v === 'string') {
      const s = v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 400);
      return s.trim() ? s : null;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { en?: unknown }).en === 'string') {
      const s = (v as { en: string }).en.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 400);
      return s.trim() ? { en: s } : null;
    }
    return null;
  };
  if (o.k === 'card') {
    const title = text(o.title);
    if (typeof o.quest !== 'string' || !QUEST.test(o.quest) || !title) return null;
    return { k: 'card', quest: o.quest, title, stakes: text(o.stakes), client: typeof o.client === 'string' && /^[a-z]{1,16}$/.test(o.client) ? o.client : 'none', offered: o.offered === true };
  }
  if (o.k === 'choice') {
    if (typeof o.quest !== 'string' || !QUEST.test(o.quest) || typeof o.step !== 'string' || !STEP.test(o.step) || !Array.isArray(o.options)) return null;
    const options: Extract<DocFoot, { k: 'choice' }>['options'] = [];
    for (const op of o.options) {
      if (options.length >= 16 || !op || typeof op !== 'object') continue;
      const r = op as Record<string, unknown>;
      const label = text(r.label);
      if (typeof r.id !== 'string' || !STEP.test(r.id) || !label) continue;
      const stakes = text(r.stakes);
      options.push({ id: r.id, label, enabled: r.enabled !== false, ...(stakes ? { stakes } : {}) });
    }
    return { k: 'choice', quest: o.quest, step: o.step, options };
  }
  return null;
}
