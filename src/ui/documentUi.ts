// The document window: a page of paper the story hands over -- a work order, a memo, an intercept, a letter --
// with its fields, its tables, its stamps and its signature, a bar wherever the reader is not let see, and its
// pages turned one at a time. At a card's foot, Accept and Decline while its job is on offer, with what is at
// stake and who it is for; at the foot of a page a choice is written on, the choice's options.
//
// It is a panel, as the inventory is: it frees the mouse and the game does not simulate while it is up, so a
// document is read in peace and nothing in it runs on a frame. It never opens by itself: the player opens it
// from the journal (J), or the console does. What it shows is the page as the story's host read it out for this
// character (`DocView`), frozen the first time it was read, so it is built once when it opens and again only
// when its foot changes; and it says when its last page has been shown (`onEnd`), once, which is what reading a
// document to its end is.
//
// Every word goes in with `textContent`, and every colour is one of the eighteen: the paper is `ink`, the type
// `void`, the stamps `bad` and `warn`, a redaction a `void` bar as long as the words it hides.

import type { DocBlock, DocSpan, DocView } from '../story/doc.ts';
import type { DocFoot } from '../story/docRules.ts';
import type { TextRef } from '../story/text.ts';

const DOCUMENT_CSS = `
#document .doc-panel { width: min(620px, 94vw); }
#document .doc-panel.win-sized .doc-paper { max-height: none; }
#document .doc-paper { max-height: min(62vh, 560px); overflow-y: auto; padding: 22px 26px 18px; background: var(--ink); color: var(--void); border-radius: 2px; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; line-height: 1.5; }
#document .doc-kind { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: color-mix(in srgb, var(--void) 60%, transparent); }
#document .doc-title { margin: 2px 0 2px; font-size: 18px; letter-spacing: 0.04em; font-weight: 600; }
#document .doc-issuer { margin-bottom: 14px; font-size: 12px; color: color-mix(in srgb, var(--void) 70%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--void) 25%, transparent); padding-bottom: 8px; }
#document .doc-p { margin: 0 0 10px; }
#document .doc-field { display: flex; gap: 10px; margin: 0 0 4px; font-family: 'Courier New', monospace; font-size: 13px; }
#document .doc-field .lab { flex: none; min-width: 120px; color: color-mix(in srgb, var(--void) 70%, transparent); }
#document .doc-table { border-collapse: collapse; margin: 6px 0 12px; font-family: 'Courier New', monospace; font-size: 12px; }
#document .doc-table td { border: 1px solid color-mix(in srgb, var(--void) 35%, transparent); padding: 3px 8px; }
#document .doc-table tr:first-child td { font-weight: 600; }
#document .doc-stamp { display: inline-block; margin: 8px 0 12px; padding: 4px 12px; border: 2px solid var(--bad); color: var(--bad); font-family: 'Segoe UI', system-ui, sans-serif; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; transform: rotate(-4deg); }
#document .doc-stamp.warn { border-color: var(--warn); color: var(--warn); }
#document .doc-sign { margin: 14px 0 4px; font-style: italic; font-size: 16px; }
#document .doc-bar { display: inline-block; height: 0.95em; vertical-align: -0.1em; background: var(--void); border-radius: 1px; }
#document .doc-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 10px 0 0; font-size: 12px; color: var(--muted); }
#document .doc-pager button, #document .doc-foot button { padding: 4px 12px; font-size: 12px; color: var(--text); background: color-mix(in srgb, var(--pool) 30%, transparent); border: 1px solid var(--panel-border); border-radius: 4px; cursor: pointer; }
#document .doc-pager button:disabled, #document .doc-foot button:disabled { opacity: 0.4; cursor: default; }
#document .doc-pager button:hover:not(:disabled), #document .doc-foot button:hover:not(:disabled) { border-color: var(--accent); }
#document .doc-foot { margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid var(--rule); display: flex; flex-direction: column; gap: 6px; }
#document .doc-foot[hidden] { display: none; }
#document .doc-foot .row { display: flex; gap: 8px; flex-wrap: wrap; }
#document .doc-stakes { font-size: 12px; color: var(--warn); }
#document .doc-client { font-size: 11px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
#document .doc-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
#document .doc-note { font-size: 12px; color: var(--muted); }
`;

let styled = false;
function installStyle(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = DOCUMENT_CSS;
  document.head.appendChild(style);
}

/** A document's kind in words, for the line over its title. */
export const DOC_KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({ workorder: 'Work order', memo: 'Memo', log: 'Log', intercept: 'Intercept', letter: 'Letter', notice: 'Notice', declaration: 'Declaration', dossier: 'Dossier' });

/** What the window is handed to show: the page as read, its foot, and whether it is read again from the journal (no foot, nothing said when it ends). */
export interface DocShown {
  view: DocView;
  foot: DocFoot | null;
  /** Read again from the journal: its foot is not shown, and reaching its end says nothing. */
  again?: boolean;
  /** A line under the page (a call read again, the journal's own words). */
  note?: string;
}

export class DocumentUi {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  /** The last page shown, once a document: it is read to its end. */
  onEnd: (doc: string) => void = () => {};
  onAccept: (quest: string, doc: string) => void = () => {};
  onDecline: (quest: string, doc: string) => void = () => {};
  onPick: (doc: string, option: string) => void = () => {};
  /** The words a text stands for (a job's title, its stakes, an option's label). */
  text: (ref: TextRef) => string = (ref) => (typeof ref === 'string' ? ref : ref.en);

  private readonly paper: HTMLElement;
  private readonly pager: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private shown: DocShown | null = null;
  private page = 0;
  private ended = false;
  /** DOM writes, for the console: the window writes when it opens, turns a page or is answered, never in a frame. */
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'document';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel doc-panel">
        <div class="ship-header">
          <h2>Document</h2>
          <span class="ship-title"></span>
          <button class="close">Close</button>
        </div>
        <div class="ship-body">
          <div class="doc-paper"></div>
          <div class="doc-pager"></div>
          <div class="doc-foot" hidden></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.paper = this.root.querySelector('.doc-paper')!;
    this.pager = this.root.querySelector('.doc-pager')!;
    this.foot = this.root.querySelector('.doc-foot')!;
    this.closeButton = this.root.querySelector('.close')!;
    this.closeButton.addEventListener('click', () => this.onClose());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** The document open just now, or null. */
  get doc(): string | null {
    return this.open ? (this.shown?.view.id ?? null) : null;
  }

  setKey(cap: string): void {
    this.closeButton.textContent = cap ? `Close (${cap})` : 'Close';
  }

  /** Open on a page, at its first page; said read to its end at once when it has only the one. */
  show(d: DocShown): void {
    this.shown = d;
    this.page = 0;
    this.ended = false;
    this.root.classList.remove('hidden');
    this.root.querySelector('.ship-title')!.textContent = DOC_KIND_WORDS[d.view.kind] ?? '';
    this.draw();
  }

  /** The foot again (the job taken, or a choice made), with the page left where it stands. */
  setFoot(foot: DocFoot | null): void {
    if (!this.shown) return;
    this.shown = { ...this.shown, foot };
    this.drawFoot();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.shown = null;
  }

  /** Turn to a page (counted from nought), as the pager does. */
  turn(to: number): void {
    const pages = this.shown?.view.pages.length ?? 0;
    if (!pages) return;
    const next = Math.max(0, Math.min(pages - 1, to));
    if (next === this.page) return;
    this.page = next;
    this.draw();
  }

  /** What the window shows, for the console. */
  report(): Record<string, unknown> {
    const v = this.shown?.view;
    return { open: this.open, doc: v?.id ?? null, title: v?.title ?? null, variant: v?.variant ?? null, page: this.page + 1, pages: v?.pages.length ?? 0, ended: this.ended, foot: this.shown?.foot ?? null, again: !!this.shown?.again, writes: this.writes };
  }

  private span(parent: HTMLElement, s: DocSpan[]): void {
    for (const x of s) {
      if (typeof x === 'string') parent.append(x);
      else {
        // A bar as long as the words it hides, and not one of them under it.
        const bar = document.createElement('span');
        bar.className = 'doc-bar';
        bar.style.width = `${Math.max(1, Math.min(60, x.bar)) * 0.55}em`;
        parent.append(bar);
      }
    }
  }

  private block(b: DocBlock): HTMLElement {
    switch (b.t) {
      case 'p': {
        const p = document.createElement('p');
        p.className = 'doc-p';
        this.span(p, b.s);
        return p;
      }
      case 'field': {
        const row = document.createElement('div');
        row.className = 'doc-field';
        const lab = document.createElement('span');
        lab.className = 'lab';
        lab.textContent = b.label;
        const val = document.createElement('span');
        this.span(val, b.value);
        row.append(lab, val);
        return row;
      }
      case 'table': {
        const t = document.createElement('table');
        t.className = 'doc-table';
        for (const r of b.rows) {
          const tr = document.createElement('tr');
          for (const c of r) {
            const td = document.createElement('td');
            td.textContent = c;
            tr.append(td);
          }
          t.append(tr);
        }
        return t;
      }
      case 'stamp': {
        const s = document.createElement('div');
        // A stamp that says it is a warning wears the warning's colour, any other the stamp's own.
        s.className = /\b(warning|caution|notice|pending)\b/i.test(b.text) ? 'doc-stamp warn' : 'doc-stamp';
        s.textContent = b.text;
        return s;
      }
      case 'sign': {
        const s = document.createElement('div');
        s.className = 'doc-sign';
        s.textContent = b.text;
        return s;
      }
    }
  }

  private draw(): void {
    const d = this.shown;
    if (!d) return;
    const v = d.view;
    const page = v.pages[this.page] ?? [];
    const nodes: HTMLElement[] = [];
    if (this.page === 0) {
      const kind = document.createElement('div');
      kind.className = 'doc-kind';
      kind.textContent = [DOC_KIND_WORDS[v.kind] ?? v.kind, v.client ? `for ${v.client}` : ''].filter(Boolean).join(' · ');
      const title = document.createElement('div');
      title.className = 'doc-title';
      title.textContent = v.title;
      nodes.push(kind, title);
      if (v.issuer) {
        const issuer = document.createElement('div');
        issuer.className = 'doc-issuer';
        issuer.textContent = v.issuer;
        nodes.push(issuer);
      }
    }
    for (const b of page) nodes.push(this.block(b));
    if (d.note) {
      const n = document.createElement('p');
      n.className = 'doc-p doc-note';
      n.textContent = d.note;
      nodes.push(n);
    }
    this.paper.replaceChildren(...nodes);
    this.paper.scrollTop = 0;
    this.writes += 2;
    const pages = v.pages.length;
    if (pages > 1) {
      const prev = document.createElement('button');
      prev.textContent = '‹ Previous';
      prev.disabled = this.page === 0;
      prev.addEventListener('click', () => this.turn(this.page - 1));
      const at = document.createElement('span');
      at.textContent = `Page ${this.page + 1} of ${pages}`;
      const next = document.createElement('button');
      next.textContent = 'Next ›';
      next.disabled = this.page >= pages - 1;
      next.addEventListener('click', () => this.turn(this.page + 1));
      this.pager.replaceChildren(prev, at, next);
    } else this.pager.replaceChildren();
    this.writes++;
    this.drawFoot();
    // The last page shown: the document is read to its end, said once.
    if (this.page >= pages - 1 && !this.ended) {
      this.ended = true;
      if (!d.again) this.onEnd(v.id);
    }
  }

  private drawFoot(): void {
    const d = this.shown;
    const f = d && !d.again ? d.foot : null;
    // The foot stands under the last page only: a card is read before it is answered.
    const last = !!d && this.page >= d.view.pages.length - 1;
    this.foot.hidden = !f || !last;
    this.writes++;
    if (!f || !last || !d) {
      this.foot.replaceChildren();
      return;
    }
    const doc = d.view.id;
    const nodes: HTMLElement[] = [];
    if (f.k === 'card') {
      const client = document.createElement('div');
      client.className = 'doc-client';
      client.textContent = `${this.text(f.title)} · for ${f.client}`;
      nodes.push(client);
      if (f.stakes) {
        const stakes = document.createElement('div');
        stakes.className = 'doc-stakes';
        stakes.textContent = this.text(f.stakes);
        nodes.push(stakes);
      }
      const row = document.createElement('div');
      row.className = 'row';
      if (f.offered) {
        const accept = document.createElement('button');
        accept.textContent = 'Accept';
        accept.addEventListener('click', () => this.onAccept(f.quest, doc));
        const decline = document.createElement('button');
        decline.textContent = 'Decline';
        decline.addEventListener('click', () => this.onDecline(f.quest, doc));
        row.append(accept, decline);
      } else {
        const said = document.createElement('span');
        said.className = 'doc-note';
        said.textContent = 'This offer is answered.';
        row.append(said);
      }
      nodes.push(row);
    } else {
      for (const o of f.options) {
        const opt = document.createElement('div');
        opt.className = 'doc-opt';
        const b = document.createElement('button');
        b.textContent = this.text(o.label);
        b.disabled = !o.enabled;
        b.addEventListener('click', () => this.onPick(doc, o.id));
        opt.append(b);
        if (o.stakes) {
          const stakes = document.createElement('span');
          stakes.className = 'doc-stakes';
          stakes.textContent = this.text(o.stakes);
          opt.append(stakes);
        }
        nodes.push(opt);
      }
    }
    this.foot.replaceChildren(...nodes);
    this.writes++;
  }
}
