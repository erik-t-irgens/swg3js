// The jobs being followed, down the right edge under the group's roster: up to three, each its title and
// its objective lines, every line with what it is counting, how far off its place is and how long it has.
//
// It is DOM, because it carries words, and it does no work per frame: it is updated four times a second
// from what the story's view says, and an element is written only when the words it would show have
// changed -- a distance only when it has moved by a rounding step, a clock only when its rounded value
// ticks over -- so standing still with no clock running it writes nothing at all. Its place under the
// roster is one custom property, written by a ResizeObserver only when the roster changes size, never in
// a frame. It goes with the rest of the display in a conversation (`#ui.talking` hides everything but the
// talk) and stands aside while a ship is flown unless the setting asks for it there.
//
// What is followed is the jobs the book tracks; when none of them is still running, the newest job taken
// is shown in their place (`autoTrack`), so a job just taken is on the screen without anybody asking.
//
// Above them stand the documents handed over and still to read that no step of a job already names ("Read:
// <title>", "Call: <who>"), up to `docsMax`: a document never opens by itself, so this line, and the message
// line's when it was handed, are what point to it; it is opened from the journal.
//
// Every number here is ours. Pure but for the elements it is handed, so the node test gives it a stand-in.

import type { DocItem } from '../story/docRules.ts';
import type { ObjectiveLine, QuestView, StoryView, WaypointView } from '../story/view.ts';

export const TRACKER_TUNE = {
  /** Jobs shown at once. */
  max: 3,
  /** Times a second the tracker is updated. */
  hz: 4,
  /** A distance under `farFrom` is said to this many metres. */
  nearRound: 10,
  /** Metres from which a distance is said in kilometres. */
  farFrom: 1000,
  /** A distance in kilometres is said to this many of them. */
  farRound: 0.1,
  /** Seconds left under which a clock is shown to the second, and a time limit is said once on the message line. */
  secondsUnder: 600,
  /** With no tracked job still running, show the newest job taken. */
  autoTrack: true,
  /** Objective lines one job shows at most; the ones still to do first. A pool, read once when it is built. */
  linesMax: 6,
  /** Documents still to read shown at once, the oldest first. A pool, read once when it is built. */
  docsMax: 3,
};

/** Set any of those, clamped; the answer is the table as it stands. `max` and `linesMax` are read when the tracker is built. */
export function tuneTracker(o: Partial<typeof TRACKER_TUNE>): typeof TRACKER_TUNE {
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (n(o.max)) TRACKER_TUNE.max = Math.max(1, Math.min(6, Math.round(o.max)));
  if (n(o.hz)) TRACKER_TUNE.hz = Math.max(1, Math.min(30, o.hz));
  if (n(o.nearRound)) TRACKER_TUNE.nearRound = Math.max(1e-3, o.nearRound);
  if (n(o.farFrom)) TRACKER_TUNE.farFrom = Math.max(1, o.farFrom);
  if (n(o.farRound)) TRACKER_TUNE.farRound = Math.max(1e-3, o.farRound);
  if (n(o.secondsUnder)) TRACKER_TUNE.secondsUnder = Math.max(0, o.secondsUnder);
  if (typeof o.autoTrack === 'boolean') TRACKER_TUNE.autoTrack = o.autoTrack;
  if (n(o.linesMax)) TRACKER_TUNE.linesMax = Math.max(1, Math.min(12, Math.round(o.linesMax)));
  if (n(o.docsMax)) TRACKER_TUNE.docsMax = Math.max(0, Math.min(8, Math.round(o.docsMax)));
  return TRACKER_TUNE;
}

/**
 * The documents the tracker points to, into `out` (emptied first): still to read, not one a job's own step names
 * (that step's objective line already says "Read"), the oldest first, up to `docsMax`. Answers how many.
 */
export function pickDocs(view: StoryView | null, out: DocItem[]): number {
  out.length = 0;
  for (const d of view?.docs ?? []) {
    if (out.length >= TRACKER_TUNE.docsMax) break;
    if (!d.step) out.push(d);
  }
  return out.length;
}

/** What the tracker says of a document still to read. */
export function docLine(d: DocItem, text: (ref: NonNullable<DocItem['fromName']>) => string): string {
  if (d.from) return `Call: ${d.fromName ? text(d.fromName) : 'someone'}`;
  return `Read: ${d.title}`;
}

/** A distance as the tracker says it: to ten metres, then to a tenth of a kilometre. '' for none. */
export function trackerDistance(d: number): string {
  if (!Number.isFinite(d) || d < 0) return '';
  const T = TRACKER_TUNE;
  if (d >= T.farFrom) {
    const km = Math.round(d / 1000 / T.farRound) * T.farRound;
    const places = Math.max(0, Math.min(3, Math.ceil(-Math.log10(T.farRound) - 1e-9)));
    return `${km.toFixed(places)} km`;
  }
  return `${Math.round(d / T.nearRound) * T.nearRound} m`;
}

/**
 * Time left as the tracker says it: to the second under `secondsUnder` ("4:07"), in minutes under an hour
 * ("23 min") and in hours and minutes beyond ("2 h 05 min"). Rounded up, so a clock never reads nought while
 * it still has time, and "0:00" once it has none.
 */
export function trackerTime(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < TRACKER_TUNE.secondsUnder || s < 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  const m = Math.ceil(s / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Whether a job is still one to follow: running, offered, or held where Drop costs nothing. */
function live(q: QuestView): boolean {
  return q.state === 'active' || q.state === 'offered' || q.state === 'stalled';
}

/**
 * The jobs the tracker shows, into `out` (emptied first): the tracked ones still to follow, in the order
 * they were tracked, and with none of those the newest job running when `autoTrack` is on. Answers how many.
 */
export function pickShown(view: StoryView | null, out: QuestView[]): number {
  out.length = 0;
  if (!view) return 0;
  const max = Math.max(1, Math.round(TRACKER_TUNE.max));
  for (const id of view.tracked) {
    if (out.length >= max) break;
    for (const q of view.quests) if (q.id === id && live(q)) out.push(q);
  }
  if (!out.length && TRACKER_TUNE.autoTrack) {
    let newest: QuestView | null = null;
    for (const q of view.quests) if (q.state === 'active' && (!newest || q.at > newest.at)) newest = q;
    if (newest) out.push(newest);
  }
  return out.length;
}

/**
 * The time limits about to run out, each said once: a line with a time limit whose clock was seen above
 * `secondsUnder` and has now come under it. A limit that began under it is shown on the tracker from the
 * start and not said as well.
 */
export class TimeWarnings {
  private readonly above = new Set<string>();
  private readonly said = new Set<string>();

  /** Each warning due, as the job's id, its line and the milliseconds left. */
  check(view: StoryView | null, now: number, out: (quest: QuestView, line: ObjectiveLine, left: number) => void): void {
    if (!view) return;
    const under = TRACKER_TUNE.secondsUnder * 1000;
    for (const q of view.quests) {
      if (q.state !== 'active') continue;
      for (const l of q.lines) {
        if (!l.limit || l.deadline === undefined || l.done) continue;
        const key = `${q.id}#${l.step}#${l.deadline}`;
        const left = l.deadline - now;
        if (left > under) this.above.add(key);
        else if (left > 0 && this.above.has(key) && !this.said.has(key)) {
          this.said.add(key);
          out(q, l, left);
        }
      }
    }
  }

  clear(): void {
    this.above.clear();
    this.said.clear();
  }
}

/** Where the player stands, as the tracker measures a line's place from: the world and a point in its own frame. */
export interface TrackerHere {
  world: string;
  /** Across the ground in the raw frame on a planet, in the game frame in space: the frame the view's places are in. */
  x: number;
  z: number;
}

interface LineEl {
  root: HTMLElement;
  text: HTMLElement;
  value: HTMLElement;
  shown: boolean;
  textNow: string;
  valueNow: string;
  done: boolean;
}

interface BlockEl {
  root: HTMLElement;
  title: HTMLElement;
  lines: LineEl[];
  shown: boolean;
  titleNow: string;
}

export class Tracker {
  readonly root: HTMLElement;
  private readonly note: HTMLElement;
  private noteNow = '';
  private noteShown = false;
  private readonly blocks: BlockEl[] = [];
  /** The documents still to read, a line each, above the jobs. */
  private readonly docEls: { root: HTMLElement; shown: boolean; textNow: string }[] = [];
  private readonly docsPicked: DocItem[] = [];
  private shownNow = false;
  /** The words a text stands for: handed in by whoever resolves the client's strings. */
  text: (ref: QuestView['title']) => string = (ref) => (typeof ref === 'string' ? ref : ref.en);
  /** A world's name, for a place on another world. */
  worldName: (id: string) => string = (id) => id;
  private readonly picked: QuestView[] = [];
  /** DOM writes: this second so far, and the last whole second. */
  private writes = 0;
  private windowStart = 0;
  private lastWrites = 0;
  private topNow = '';
  private observer: { disconnect(): void } | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-tracker';
    this.root.hidden = true;
    this.note = document.createElement('div');
    this.note.className = 'hud-trk-note';
    this.note.hidden = true;
    this.root.appendChild(this.note);
    for (let i = 0; i < Math.max(0, Math.round(TRACKER_TUNE.docsMax)); i++) {
      const d = document.createElement('div');
      d.className = 'hud-trk-doc';
      d.hidden = true;
      this.root.appendChild(d);
      this.docEls.push({ root: d, shown: false, textNow: '' });
    }
    const max = Math.max(1, Math.round(TRACKER_TUNE.max));
    const linesMax = Math.max(1, Math.round(TRACKER_TUNE.linesMax));
    for (let b = 0; b < max; b++) {
      const root = document.createElement('div');
      root.className = 'hud-trk-job';
      root.hidden = true;
      const title = document.createElement('div');
      title.className = 'hud-trk-title';
      root.appendChild(title);
      const lines: LineEl[] = [];
      for (let i = 0; i < linesMax; i++) {
        const lr = document.createElement('div');
        lr.className = 'hud-trk-line';
        lr.hidden = true;
        const text = document.createElement('span');
        text.className = 'text';
        const value = document.createElement('span');
        value.className = 'value';
        lr.appendChild(text);
        lr.appendChild(value);
        root.appendChild(lr);
        lines.push({ root: lr, text, value, shown: false, textNow: '', valueNow: '', done: false });
      }
      this.root.appendChild(root);
      this.blocks.push({ root, title, lines, shown: false, titleNow: '' });
    }
    parent.appendChild(this.root);
  }

  /** The jobs shown just now, by id: what the console reads. */
  get shownIds(): string[] {
    return this.picked.map((q) => q.id);
  }

  get writesLastSecond(): number {
    return this.lastWrites;
  }

  private count(n = 1): void {
    this.writes += n;
  }

  private setText(el: HTMLElement, now: string, next: string): boolean {
    if (now === next) return false;
    el.textContent = next;
    this.count();
    return true;
  }

  private setHidden(el: HTMLElement, hidden: boolean): void {
    if (el.hidden === hidden) return;
    el.hidden = hidden;
    this.count();
  }

  /**
   * Four times a second. `show` is whether it stands at all (the setting, the world, a ship flown); `held`
   * a line said in place of the jobs while the story cannot be worked (a server holding it and not
   * answering), or ''. `now` is the story's clock, which the deadlines are on. `ms` is any clock in
   * milliseconds, for the write count's second.
   */
  update(view: StoryView | null, here: TrackerHere | null, now: number, show: boolean, held: string, ms: number): void {
    if (ms - this.windowStart >= 1000) {
      this.lastWrites = this.writes;
      this.writes = 0;
      this.windowStart = ms;
    }
    const n = show ? pickShown(view, this.picked) : ((this.picked.length = 0), 0);
    const docs = show && !held ? pickDocs(view, this.docsPicked) : ((this.docsPicked.length = 0), 0);
    const wantNote = show && !!held;
    const want = show && (n > 0 || wantNote || docs > 0);
    if (want !== this.shownNow) {
      this.shownNow = want;
      this.setHidden(this.root, !want);
    }
    if (!want) return;
    if (wantNote !== this.noteShown) {
      this.noteShown = wantNote;
      this.setHidden(this.note, !wantNote);
    }
    if (wantNote && this.setText(this.note, this.noteNow, held)) this.noteNow = held;
    for (let i = 0; i < this.docEls.length; i++) {
      const el = this.docEls[i];
      const d = i < docs ? this.docsPicked[i] : null;
      if (!!d !== el.shown) {
        el.shown = !!d;
        this.setHidden(el.root, !d);
      }
      if (!d) continue;
      const line = docLine(d, this.text);
      if (this.setText(el.root, el.textNow, line)) el.textNow = line;
    }
    for (let b = 0; b < this.blocks.length; b++) {
      const block = this.blocks[b];
      const q = b < n ? this.picked[b] : null;
      if (!!q !== block.shown) {
        block.shown = !!q;
        this.setHidden(block.root, !q);
      }
      if (!q) continue;
      const title = q.state === 'stalled' && q.stalled ? `${this.text(q.title)} — ${q.stalled}` : this.text(q.title);
      if (this.setText(block.title, block.titleNow, title)) block.titleNow = title;
      this.fillLines(block, q, view!, here, now);
    }
  }

  /** One job's lines: the ones still to do first, then the ones done, up to the pool's size. */
  private fillLines(block: BlockEl, q: QuestView, view: StoryView, here: TrackerHere | null, now: number): void {
    let k = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const l of q.lines) {
        if (k >= block.lines.length) break;
        if (!!l.done !== (pass === 1)) continue;
        this.writeLine(block.lines[k++], l, view, here, now);
      }
    }
    for (; k < block.lines.length; k++) {
      const el = block.lines[k];
      if (el.shown) {
        el.shown = false;
        this.setHidden(el.root, true);
      }
    }
  }

  private writeLine(el: LineEl, l: ObjectiveLine, view: StoryView, here: TrackerHere | null, now: number): void {
    if (!el.shown) {
      el.shown = true;
      this.setHidden(el.root, false);
    }
    const text = this.text(l.text);
    if (this.setText(el.text, el.textNow, text)) el.textNow = text;
    const done = !!l.done;
    if (done !== el.done) {
      el.done = done;
      el.root.classList.toggle('done', done);
      this.count();
    }
    const value = done ? '' : this.valueOf(l, view, here, now);
    if (this.setText(el.value, el.valueNow, value)) el.valueNow = value;
  }

  /** What a line counts, how far its place is and how long it has, as one short string. */
  private valueOf(l: ObjectiveLine, view: StoryView, here: TrackerHere | null, now: number): string {
    let out = '';
    const add = (s: string): void => {
      if (s) out = out ? `${out} · ${s}` : s;
    };
    if (l.of !== undefined && l.n !== undefined) add(`${l.n}/${l.of}`);
    if (l.wp && here) {
      let wp: WaypointView | null = null;
      for (const w of view.waypoints) if (w.id === l.wp) wp = w;
      if (wp) add(wp.world === here.world ? trackerDistance(Math.hypot(wp.p[0] - here.x, wp.p[1] - here.z)) : this.worldName(wp.world));
    }
    if (l.deadline !== undefined) add(trackerTime(l.deadline - now));
    return out;
  }

  /**
   * Stand under an element (the group's roster), following it as it grows and shrinks: one custom property,
   * written when the roster changes size and never in a frame. `fallbackTop` is where the tracker stands
   * while the roster is away.
   */
  follow(el: HTMLElement, fallbackTop: number, gap: number): void {
    this.observer?.disconnect();
    const place = (): void => {
      let top = fallbackTop;
      try {
        const r = el.getBoundingClientRect();
        if (r.height > 0) top = Math.round(r.bottom + gap);
      } catch {
        /* a page with no layout keeps the fallback */
      }
      const v = `${top}px`;
      if (v === this.topNow) return;
      this.topNow = v;
      this.root.style.setProperty('--tracker-top', v);
      this.count();
    };
    const RO = (globalThis as unknown as { ResizeObserver?: new (cb: () => void) => { observe(e: Element): void; disconnect(): void } }).ResizeObserver;
    if (RO) {
      const o = new RO(place);
      o.observe(el);
      this.observer = o;
    }
    place();
  }

  /** Taken off the screen at once: the world is being left. */
  clear(): void {
    this.picked.length = 0;
    if (this.shownNow) {
      this.shownNow = false;
      this.setHidden(this.root, true);
    }
  }

  report(): Record<string, unknown> {
    const jobs: Record<string, unknown>[] = [];
    for (let b = 0; b < this.blocks.length; b++) {
      const block = this.blocks[b];
      if (!block.shown || !this.shownNow) continue;
      jobs.push({ title: block.titleNow, lines: block.lines.filter((l) => l.shown).map((l) => (l.valueNow ? `${l.textNow} [${l.valueNow}]` : l.done ? `${l.textNow} (done)` : l.textNow)) });
    }
    return { shown: this.shownNow, note: this.noteShown ? this.noteNow : '', docs: this.docEls.filter((d) => d.shown).map((d) => d.textNow), jobs, top: this.topNow, writes: this.lastWrites, writesNow: this.writes, tune: { ...TRACKER_TUNE } };
  }
}
