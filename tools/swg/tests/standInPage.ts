// A stand-in for the page, enough of it to build the world editor's window and the Escape menu in node and press what they
// draw: elements with attributes, classes, data, values and events that capture and bubble through the page to the
// document and the window, the markup the windows write with `innerHTML` read into elements (a small reader of the plain
// markup they write, not a browser's), simple selectors (tags, classes, ids, attributes, descendants, children, commas),
// focus, timers stepped by hand, storage (or storage that refuses), and a layout of its own for scrolling: every element
// with no element in it stands 20 px tall, every other is as tall as what is in it, a hidden one is nought, and an element
// the test gives a `clientHeight` scrolls what is in it, its `scrollTop` held inside what there is to scroll as a browser
// holds it. Not a test itself.

type Listener = { fn: (e: StandInEvent) => void; capture: boolean };

export class StandInEvent {
  type: string;
  target: EventTarget0 | null = null;
  currentTarget: EventTarget0 | null = null;
  key = '';
  code = '';
  shiftKey = false;
  ctrlKey = false;
  button = 0;
  buttons = 0;
  repeat = false;
  defaultPrevented = false;
  stopped = false;
  stoppedNow = false;
  constructor(type: string, init: Partial<Pick<StandInEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'button' | 'repeat'>> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
    this.stoppedNow = true;
  }
}

export class EventTarget0 {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: (e: StandInEvent) => void, opts?: boolean | { capture?: boolean }): void {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: StandInEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.findIndex((l) => l.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }
  /** This target's own listeners of one phase. */
  hear(e: StandInEvent, capture: boolean | null): void {
    for (const l of [...(this.listeners.get(e.type) ?? [])]) {
      if (e.stoppedNow) return;
      if (capture !== null && l.capture !== capture) continue;
      e.currentTarget = this;
      l.fn(e);
    }
  }
}

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base']);

export class TextNode {
  readonly nodeType = 3;
  parent: Element0 | null = null;
  data: string;
  constructor(data: string) {
    this.data = data;
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = String(v);
  }
  get parentElement(): Element0 | null {
    return this.parent;
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
}

type Kid = Element0 | TextNode;

export class Element0 extends EventTarget0 {
  readonly nodeType: number;
  readonly tagName: string;
  readonly localName: string;
  parent: Element0 | null = null;
  kids: Kid[] = [];
  readonly attrs = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(n: string, v: string): void; getPropertyValue(n: string): string; removeProperty(n: string): void };
  private val: string | null = null;
  private chk: boolean | null = null;
  private sel: boolean | null = null;
  private scrolled = 0;
  /** Set by a test: this element scrolls what is in it within this height. */
  clientHeight: number | null = null;
  readonly page: StandInPage;

  constructor(page: StandInPage, tag: string, nodeType = 1) {
    super();
    this.page = page;
    this.nodeType = nodeType;
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    const props = new Map<string, string>();
    this.style = {
      setProperty: (n: string, v: string) => void props.set(n, String(v)),
      getPropertyValue: (n: string) => props.get(n) ?? '',
      removeProperty: (n: string) => void props.delete(n),
    } as Element0['style'];
  }

  // ---- attributes ----
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
  private refl(n: string): string {
    return this.attrs.get(n) ?? '';
  }
  get id(): string {
    return this.refl('id');
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }
  get className(): string {
    return this.refl('class');
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get title(): string {
    return this.refl('title');
  }
  set title(v: string) {
    this.setAttribute('title', v);
  }
  get type(): string {
    return this.attrs.get('type') ?? (this.localName === 'input' ? 'text' : this.localName === 'button' ? 'submit' : '');
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }
  get placeholder(): string {
    return this.refl('placeholder');
  }
  set placeholder(v: string) {
    this.setAttribute('placeholder', v);
  }
  get min(): string {
    return this.refl('min');
  }
  set min(v: string) {
    this.setAttribute('min', v);
  }
  get max(): string {
    return this.refl('max');
  }
  set max(v: string) {
    this.setAttribute('max', v);
  }
  get step(): string {
    return this.refl('step');
  }
  set step(v: string) {
    this.setAttribute('step', v);
  }
  get rows(): number {
    return Number(this.attrs.get('rows') ?? 2);
  }
  set rows(v: number) {
    this.setAttribute('rows', String(v));
  }
  get src(): string {
    return this.refl('src');
  }
  set src(v: string) {
    this.setAttribute('src', v);
  }
  get alt(): string {
    return this.refl('alt');
  }
  set alt(v: string) {
    this.setAttribute('alt', v);
  }
  get width(): number {
    return Number(this.attrs.get('width') ?? 0);
  }
  set width(v: number) {
    this.setAttribute('width', String(v));
  }
  get height(): number {
    return Number(this.attrs.get('height') ?? 0);
  }
  set height(v: number) {
    this.setAttribute('height', String(v));
  }
  get loading(): string {
    return this.refl('loading');
  }
  set loading(v: string) {
    this.setAttribute('loading', v);
  }
  get spellcheck(): boolean {
    return this.attrs.get('spellcheck') !== 'false';
  }
  set spellcheck(v: boolean) {
    this.setAttribute('spellcheck', String(v));
  }
  get hidden(): boolean {
    return this.attrs.has('hidden');
  }
  set hidden(v: boolean) {
    if (v) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
    // A browser lays nothing out under a hidden element, and what scrolled in it forgets where it stood.
    if (v) this.forgetScroll();
  }
  private forgetScroll(): void {
    this.scrolled = 0;
    for (const k of this.children) k.forgetScroll();
  }
  get disabled(): boolean {
    return this.attrs.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get isContentEditable(): boolean {
    return false;
  }

  // ---- classes and data ----
  get classList() {
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const write = (s: Set<string>) => (this.className = [...s].join(' '));
    return {
      add: (...n: string[]) => {
        const s = names();
        n.forEach((x) => s.add(x));
        write(s);
      },
      remove: (...n: string[]) => {
        const s = names();
        n.forEach((x) => s.delete(x));
        write(s);
      },
      toggle: (n: string, force?: boolean) => {
        const s = names();
        const want = force === undefined ? !s.has(n) : force;
        if (want) s.add(n);
        else s.delete(n);
        write(s);
        return want;
      },
      contains: (n: string) => names().has(n),
    };
  }
  get dataset(): Record<string, string | undefined> {
    const kebab = (p: string) => `data-${p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, p) => (typeof p === 'string' ? (this.getAttribute(kebab(p)) ?? undefined) : undefined),
      set: (_t, p, v) => {
        if (typeof p === 'string') this.setAttribute(kebab(p), String(v));
        return true;
      },
      has: (_t, p) => typeof p === 'string' && this.hasAttribute(kebab(p)),
    });
  }

  // ---- values ----
  get value(): string {
    if (this.localName === 'select') {
      const opts = this.querySelectorAll('option');
      const on = opts.find((o) => o.selected) ?? opts[0];
      return on ? on.value : '';
    }
    if (this.localName === 'option') return this.attrs.get('value') ?? this.textContent;
    if (this.localName === 'textarea') return this.val ?? this.textContent;
    return this.val ?? this.attrs.get('value') ?? '';
  }
  set value(v: string) {
    if (this.localName === 'select') {
      for (const o of this.querySelectorAll('option')) o.selected = o.value === String(v);
      return;
    }
    if (this.localName === 'option') {
      this.setAttribute('value', String(v));
      return;
    }
    this.val = String(v);
  }
  get checked(): boolean {
    return this.chk ?? this.attrs.has('checked');
  }
  set checked(v: boolean) {
    this.chk = !!v;
  }
  get selected(): boolean {
    return this.sel ?? this.attrs.has('selected');
  }
  set selected(v: boolean) {
    if (v && this.parent) for (const o of this.parent.querySelectorAll('option')) if (o !== this) o.sel = false;
    this.sel = !!v;
  }
  select(): void {}
  setSelectionRange(): void {}

  // ---- the tree ----
  get parentElement(): Element0 | null {
    return this.parent;
  }
  get parentNode(): Element0 | null {
    return this.parent;
  }
  get children(): Element0[] {
    return this.kids.filter((k): k is Element0 => k instanceof Element0);
  }
  get firstElementChild(): Element0 | null {
    return this.children[0] ?? null;
  }
  get lastElementChild(): Element0 | null {
    const c = this.children;
    return c[c.length - 1] ?? null;
  }
  /** The element after it, and before it, among its parent's. */
  get nextElementSibling(): Element0 | null {
    const s = this.parent?.children ?? [];
    return s[s.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling(): Element0 | null {
    const s = this.parent?.children ?? [];
    const i = s.indexOf(this);
    return i > 0 ? s[i - 1] : null;
  }
  get textContent(): string {
    return this.kids.map((k) => k.textContent).join('');
  }
  set textContent(v: string) {
    this.replaceChildren();
    if (String(v)) this.append(String(v));
  }
  get innerHTML(): string {
    return this.kids.map((k) => (k instanceof TextNode ? k.data : k.outerHTML)).join('');
  }
  set innerHTML(v: string) {
    this.replaceChildren();
    readMarkup(this, String(v));
  }
  get outerHTML(): string {
    const a = [...this.attrs].map(([n, v]) => (v === '' ? ` ${n}` : ` ${n}="${v}"`)).join('');
    return VOID.has(this.localName) ? `<${this.localName}${a}>` : `<${this.localName}${a}>${this.innerHTML}</${this.localName}>`;
  }
  private adopt(n: Kid | string): Kid[] {
    if (typeof n === 'string') return [new TextNode(n)];
    if (n instanceof Element0 && n.nodeType === 11) {
      const moved = n.kids.slice();
      for (const k of moved) k.parent = null;
      n.kids = [];
      return moved;
    }
    return [n];
  }
  append(...nodes: (Kid | string)[]): void {
    for (const n of nodes) {
      for (const k of this.adopt(n)) {
        if (k.parent) k.parent.removeChild(k);
        k.parent = this;
        this.kids.push(k);
      }
    }
  }
  appendChild<T extends Kid>(n: T): T {
    this.append(n);
    return n;
  }
  insertBefore<T extends Kid>(n: T, ref: Kid | null): T {
    if (!ref) return this.appendChild(n);
    if (n.parent) n.parent.removeChild(n);
    const i = this.kids.indexOf(ref);
    n.parent = this;
    this.kids.splice(i < 0 ? this.kids.length : i, 0, n);
    return n;
  }
  removeChild(n: Kid): void {
    const i = this.kids.indexOf(n);
    if (i >= 0) this.kids.splice(i, 1);
    n.parent = null;
  }
  replaceChildren(...nodes: (Kid | string)[]): void {
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  /** Put nodes first among its own (the pages' doll canvas, Map-maker II's thirteenth wave). */
  prepend(...nodes: (Kid | string)[]): void {
    const first = this.kids[0] ?? null;
    for (const n of nodes) for (const k of this.adopt(n)) this.insertBefore(k, first);
  }
  /** Markup read in beside or inside it, at the four places a browser takes. */
  insertAdjacentHTML(where: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend', html: string): void {
    const frag = new Element0(this.page, '#fragment', 11);
    readMarkup(frag, html);
    if (where === 'beforeend') this.append(frag);
    else if (where === 'afterbegin') this.prepend(frag);
    else if (where === 'beforebegin') this.before(frag);
    else this.after(frag);
  }
  /** Nodes put just before it among its parent's. */
  before(...nodes: (Kid | string)[]): void {
    const p = this.parent;
    if (!p) return;
    for (const n of nodes) for (const k of this.adopt(n)) p.insertBefore(k, this);
  }
  /** Nodes put just after it among its parent's, in order. */
  after(...nodes: (Kid | string)[]): void {
    const p = this.parent;
    if (!p) return;
    let ref: Kid | null = p.kids[p.kids.indexOf(this) + 1] ?? null;
    for (const n of nodes) for (const k of this.adopt(n)) {
      p.insertBefore(k, ref);
      ref = p.kids[p.kids.indexOf(k) + 1] ?? null;
    }
  }
  /** It taken out and the nodes put where it stood. */
  replaceWith(...nodes: (Kid | string)[]): void {
    const p = this.parent;
    if (!p) return;
    this.after(...nodes);
    this.remove();
  }
  /** A canvas draws nothing here: no context (the pages' strips skip their drawing on none). */
  getContext(): null {
    return null;
  }
  /** A `<select>`'s options. */
  get options(): Element0[] {
    return this.querySelectorAll('option');
  }
  /** A `<details>`'s open, as its attribute. */
  get open(): boolean {
    return this.attrs.has('open');
  }
  set open(v: boolean) {
    if (v) this.setAttribute('open', '');
    else this.removeAttribute('open');
  }
  contains(n: unknown): boolean {
    for (let at = n as Kid | null; at; at = at.parent) if (at === this) return true;
    return false;
  }
  get isConnected(): boolean {
    return this.page.body.contains(this) || this.page.head.contains(this);
  }

  // ---- selectors ----
  matches(sel: string): boolean {
    return parseSelector(sel).some((chain) => matchChain(this, chain));
  }
  closest(sel: string): Element0 | null {
    const groups = parseSelector(sel);
    for (let at: Element0 | null = this; at; at = at.parent) if (groups.some((c) => matchChain(at!, c))) return at;
    return null;
  }
  querySelectorAll(sel: string): Element0[] {
    const groups = parseSelector(sel);
    const out: Element0[] = [];
    const walk = (n: Element0) => {
      for (const k of n.kids) {
        if (!(k instanceof Element0)) continue;
        if (groups.some((c) => matchChain(k, c))) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): Element0 | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  // ---- focus and events ----
  focus(): void {
    if (this.isConnected) this.page.focused = this;
  }
  blur(): void {
    if (this.page.focused === this) this.page.focused = null;
  }
  dispatchEvent(e: StandInEvent): boolean {
    this.page.fire(this, e);
    return !e.defaultPrevented;
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }

  // ---- layout ----
  /** Whether it and every element round it are shown. */
  get shown(): boolean {
    for (let at: Element0 | null = this; at; at = at.parent) if (at.hidden) return false;
    return true;
  }
  /** How tall it stands: 20 px with nothing in it, else what is in it, nought hidden. */
  get boxHeight(): number {
    if (this.hidden) return 0;
    const c = this.children;
    if (!c.length) return 20;
    let h = 0;
    for (const k of c) h += k.boxHeight;
    return h;
  }
  get offsetHeight(): number {
    return this.shown ? this.boxHeight : 0;
  }
  get offsetWidth(): number {
    return this.shown ? 400 : 0;
  }
  get clientWidth(): number {
    return 0;
  }
  get scrollWidth(): number {
    return 0;
  }
  get clientLeft(): number {
    return 0;
  }
  get clientTop(): number {
    return 0;
  }
  get scrollHeight(): number {
    let h = 0;
    for (const k of this.children) h += k.boxHeight;
    return h;
  }
  /** Held inside what there is to scroll, as a browser holds it once it lays the page out. */
  get scrollTop(): number {
    if (this.clientHeight === null) return this.scrolled;
    if (!this.shown) return 0;
    return Math.max(0, Math.min(this.scrolled, this.scrollHeight - this.clientHeight));
  }
  set scrollTop(v: number) {
    this.scrolled = Math.max(0, Number(v) || 0);
    this.scrolled = this.scrollTop;
  }
  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number; x: number; y: number } {
    const h = this.offsetHeight;
    let top = 0;
    let at: Element0 = this;
    while (at.parent) {
      const p: Element0 = at.parent;
      for (const k of p.children) {
        if (k === at) break;
        top += k.boxHeight;
      }
      if (p.clientHeight !== null) top -= p.scrollTop;
      at = p;
    }
    return { top, bottom: top + h, left: 0, right: 400, width: h ? 400 : 0, height: h, x: 0, y: top };
  }
}

// ---- markup ----

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

/** The plain markup the windows write, read into elements under `into`. */
export function readMarkup(into: Element0, html: string): void {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  const stack: Element0[] = [into];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const name = m[1].toLowerCase();
      const at = stack.map((e) => e.localName).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else if (m[2]) {
      const el = into.page.createElement(m[2]);
      for (const a of (m[3] ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top.appendChild(el);
      if (!m[4] && !VOID.has(el.localName)) stack.push(el);
    } else if (m[5] !== undefined || m[6] !== undefined) {
      top.append(decode(m[5] ?? m[6]));
    }
  }
}

// ---- selectors ----

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
}
type Chain = { compound: Compound; join: ' ' | '>' }[];

const SELECTORS = new Map<string, Chain[]>();
function parseSelector(sel: string): Chain[] {
  const kept = SELECTORS.get(sel);
  if (kept) return kept;
  const groups: Chain[] = [];
  for (const g of sel.split(',')) {
    const chain: Chain = [];
    let join: ' ' | '>' = ' ';
    for (const tok of g.trim().replace(/\s*>\s*/g, ' > ').split(/\s+(?=(?:[^\]]*\[[^\]]*\])*[^\]]*$)/)) {
      if (!tok) continue;
      if (tok === '>') {
        join = '>';
        continue;
      }
      const c: Compound = { tag: null, id: null, classes: [], attrs: [] };
      const head = /^([a-zA-Z*][\w-]*)/.exec(tok);
      let rest = tok;
      if (head) {
        c.tag = head[1] === '*' ? null : head[1].toLowerCase();
        rest = tok.slice(head[1].length);
      }
      for (const p of rest.matchAll(/#([\w-]+)|\.([\w-]+)|\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)) {
        if (p[1]) c.id = p[1];
        else if (p[2]) c.classes.push(p[2]);
        else c.attrs.push({ name: p[3].trim(), value: p[4] ?? p[5] ?? p[6] ?? null });
      }
      chain.push({ compound: c, join });
      join = ' ';
    }
    groups.push(chain);
  }
  SELECTORS.set(sel, groups);
  return groups;
}

function matchCompound(el: Element0, c: Compound): boolean {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== null && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

/** Right to left: the last compound on the element, each before it on an element above it, anywhere up the page. */
function matchChain(el: Element0, chain: Chain): boolean {
  const at = (i: number, node: Element0): boolean => {
    if (!matchCompound(node, chain[i].compound)) return false;
    if (i === 0) return true;
    const join = chain[i].join;
    for (let up = node.parent; up; up = up.parent) {
      if (at(i - 1, up)) return true;
      if (join === '>') return false;
    }
    return false;
  };
  return chain.length > 0 && at(chain.length - 1, el);
}

// ---- the page ----

/** Storage as a browser keeps it, or refusing every call (a private window, blocked site data). */
export function storage(refuses = false): Storage & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  const no = () => {
    throw new Error('storage refused');
  };
  return {
    kept,
    get length() {
      return refuses ? no() : kept.size;
    },
    key: (i: number) => (refuses ? no() : ([...kept.keys()][i] ?? null)),
    getItem: (k: string) => (refuses ? no() : (kept.get(k) ?? null)),
    setItem: (k: string, v: string) => (refuses ? no() : void kept.set(k, String(v))),
    removeItem: (k: string) => (refuses ? no() : void kept.delete(k)),
    clear: () => (refuses ? no() : kept.clear()),
  } as Storage & { kept: Map<string, string> };
}

export class StandInPage {
  readonly doc: EventTarget0 & Record<string, unknown>;
  readonly win: EventTarget0 & Record<string, unknown>;
  readonly body: Element0;
  readonly head: Element0;
  focused: Element0 | null = null;
  nowMs = 1000;
  private timerId = 0;
  private readonly timers = new Map<number, { fn: () => void; at: number }>();

  constructor() {
    this.body = new Element0(this, 'body');
    this.head = new Element0(this, 'head');
    const page = this;
    const doc = new EventTarget0() as EventTarget0 & Record<string, unknown>;
    Object.assign(doc, {
      body: this.body,
      head: this.head,
      createElement: (tag: string) => page.createElement(tag),
      createTextNode: (t: string) => new TextNode(t),
      createDocumentFragment: () => new Element0(page, '#fragment', 11),
      querySelector: (s: string) => page.body.querySelector(s),
      querySelectorAll: (s: string) => page.body.querySelectorAll(s),
      getElementById: (id: string) => page.body.querySelector(`#${id}`) ?? page.head.querySelector(`#${id}`),
      elementsFromPoint: () => [],
      hasFocus: () => true,
      pointerLockElement: null,
    });
    Object.defineProperty(doc, 'activeElement', { get: () => (page.focused && page.focused.isConnected ? page.focused : page.body) });
    this.doc = doc;
    const win = new EventTarget0() as EventTarget0 & Record<string, unknown>;
    Object.assign(win, {
      innerWidth: 1600,
      innerHeight: 900,
      devicePixelRatio: 1,
      setTimeout: (fn: () => void, after = 0) => {
        page.timers.set(++page.timerId, { fn, at: page.nowMs + after });
        return page.timerId;
      },
      clearTimeout: (id: number) => void page.timers.delete(id),
      getSelection: () => null,
    });
    this.win = win;
  }

  createElement(tag: string): Element0 {
    return new Element0(this, tag);
  }

  /** The page made the globals a window's code reads: `document`, `window`, `localStorage` and the observers. */
  install(store: Storage = storage()): void {
    const g = globalThis as unknown as Record<string, unknown>;
    g.document = this.doc;
    g.window = this.win;
    g.localStorage = store;
    g.MutationObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    g.HTMLElement = Element0;
    g.Element = Element0;
    g.performance ??= { now: () => this.nowMs };
  }

  /** Time passes, and the timers due run. */
  pass(ms: number): void {
    this.nowMs += ms;
    for (const [id, t] of [...this.timers]) {
      if (t.at > this.nowMs) continue;
      this.timers.delete(id);
      t.fn();
    }
  }

  /** An event through the page: captured down from the window, heard at its target, bubbled back up. */
  fire(target: Element0, e: StandInEvent): void {
    e.target = target;
    const up: EventTarget0[] = [];
    for (let at: Element0 | null = target.parent; at; at = at.parent) up.push(at);
    if (target.isConnected) up.push(this.doc, this.win);
    for (const t of [...up].reverse()) {
      if (e.stopped) return;
      t.hear(e, true);
    }
    if (e.stopped) return;
    target.hear(e, null);
    for (const t of up) {
      if (e.stopped) return;
      t.hear(e, false);
    }
  }

  /** A click: the element takes the focus, as a pressed control does, then hears it. */
  click(el: Element0): void {
    el.focus();
    this.fire(el, new StandInEvent('click'));
  }

  /** A key pressed wherever the keyboard is. */
  key(code: string, key = code.replace(/^Key/, '').toLowerCase()): StandInEvent {
    const target = (this.doc.activeElement as Element0) ?? this.body;
    const e = new StandInEvent('keydown', { code, key });
    this.fire(target, e);
    return e;
  }

  /** A value typed or chosen into a control, and the events the control fires for it. */
  enter(el: Element0, value: string, events: readonly string[] = ['input', 'change']): void {
    if (el.localName === 'input' && el.type === 'checkbox') el.checked = value === 'true';
    else el.value = value;
    for (const t of events) this.fire(el, new StandInEvent(t));
  }
}
