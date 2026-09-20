// The message line: what the game tells you once, kept on the screen long enough to read it.
//
// Until now every one-shot notice went to the prompt, which is rebuilt and rewritten every frame from
// outside every guard, so a crash line, a relay connection or a jump's notices lived about seven
// milliseconds and were never seen. This line is the other half of that fix: it holds what it is told
// for eight seconds, fading over the last one, and nothing underneath it can overwrite it.
//
// It is DOM, because it carries words, and it does no work per frame: a fixed pool of line elements is
// made once and reused, a line's text is written only when it differs from what that element already
// holds, and the fade writes an opacity only when the value shown changes by a step. In a second with
// nothing fading the whole module writes nothing at all.

/** What a line is about. The colour of its left rule follows it; nothing else does. */
export type MessageKind = 'system' | 'youHit' | 'hitYou' | 'spatial' | 'note';

/** The kinds, in the order the settings and the debug helper list them. */
export const MESSAGE_KINDS: readonly MessageKind[] = Object.freeze(['system', 'youHit', 'hitYou', 'spatial', 'note'] as MessageKind[]);

/** The class a kind puts on its line, as the HUD stylesheet spells it. The stylesheet owns how each looks. */
const KIND_CLASS: Readonly<Record<MessageKind, string>> = Object.freeze({
  system: 'system',
  youHit: 'you-hit',
  hitYou: 'hit-you',
  spatial: 'spatial',
  note: 'note',
});

/**
 * The left rule's colour per kind, invented here and written inline only when the HUD stylesheet is not
 * loaded (see `styleless`): each is the named colour with a literal of the same value behind it, so it is
 * right whether or not `:root` carries the name yet. Which kind wears which is ours: the instrument's own
 * colour for the game speaking, green for a blow you landed, red for one you took, plain ink for someone
 * else's words, and the muted grey for an aside.
 */
const KIND_RULE: Readonly<Record<MessageKind, string>> = Object.freeze({
  system: 'var(--accent, #7fd7ff)',
  youHit: 'var(--good, #6adf7a)',
  hitYou: 'var(--bad, #ff5a4a)',
  spatial: 'var(--component, #ffd27f)',
  note: 'var(--muted, #9fb3c4)',
});

/**
 * Every number the line runs on, live: change one and the next line obeys it. `pool` is read once, when
 * the line is built, because the elements are made then and never grown.
 *
 * `pool`, `kept`, `seconds`, `fade` and `merge` are the design's. `steps`, `maxChars`, `maxCount` and
 * `countEvery` are invented: `steps` is how coarsely the fade is written (the opacity is put on the
 * element only when it changes by one step, so a fading line costs eight writes rather than one a frame),
 * `maxChars` cuts a line that came from somewhere that used to write a paragraph, and `maxCount` and
 * `countEvery` are what keep a message sent from an unguarded per-frame branch from costing a write a
 * frame for ever: the count stops widening at `maxCount` and is written at most once every `countEvery`
 * seconds however often the words are repeated.
 */
export const MESSAGES = {
  /** Line elements made at construction. */
  pool: 8,
  /** Lines shown at once; never more than the pool. */
  kept: 8,
  /** Seconds a line stays. */
  seconds: 8,
  /** The last of those seconds it spends fading. */
  fade: 1,
  /** The same words said again within this many seconds bump a count instead of adding a line. */
  merge: 2,
  /** Invented: steps the fade is written in. */
  steps: 8,
  /** Invented: characters a line is cut to. */
  maxChars: 140,
  /** Invented: where the count stops counting and reads "×99+", so the plate cannot widen without end. */
  maxCount: 99,
  /** Invented: seconds between two writes of one line's count, however often the words are repeated. */
  countEvery: 0.25,
};

/**
 * Invented, and beside the numbers above because it is one of them: an age past any plausible
 * `countEvery`, given to a line as it is said so that the first repeat shows its count at once.
 */
const COUNT_READY = 1e9;

/** What the line is doing, filled in place for the debug helper: never a new object. */
export interface MessageStats {
  /** Lines on the screen now. */
  lines: number;
  /** Of those, how many are fading. */
  fading: number;
  /** Every DOM write the line has made since it was built; sample it a second apart for the rate. */
  writes: number;
  /** Lines said, lines merged into one already there, and lines pushed off the top before their time. */
  said: number;
  merged: number;
  dropped: number;
}

/** Set any of the live numbers at once (the debug helper's one call), clamped to what makes sense. */
export function tuneMessages(o: Partial<typeof MESSAGES>): typeof MESSAGES {
  if (typeof o.kept === 'number') MESSAGES.kept = Math.max(1, Math.round(o.kept));
  if (typeof o.seconds === 'number') MESSAGES.seconds = Math.max(0.1, o.seconds);
  if (typeof o.fade === 'number') MESSAGES.fade = Math.max(0, o.fade);
  if (typeof o.merge === 'number') MESSAGES.merge = Math.max(0, o.merge);
  if (typeof o.steps === 'number') MESSAGES.steps = Math.max(1, Math.round(o.steps));
  if (typeof o.maxChars === 'number') MESSAGES.maxChars = Math.max(8, Math.round(o.maxChars));
  if (typeof o.maxCount === 'number') MESSAGES.maxCount = Math.max(1, Math.round(o.maxCount));
  if (typeof o.countEvery === 'number') MESSAGES.countEvery = Math.max(0, o.countEvery);
  return MESSAGES;
}

/**
 * The words out of a line that used to go to the prompt, which took HTML: the tags go, the handful of
 * entities the prompts use become their characters, and the spaces collapse. Nothing on this line is ever
 * parsed as HTML.
 *
 * Only a real tag is taken out (`<` or `</` then a letter), so words like "hull < 20 % > danger" keep
 * their middle, and every string is collapsed and trimmed whether or not it ever carried markup, so the
 * same sentence reads the same either way.
 */
export function plain(text: string): string {
  if (text.indexOf('<') < 0 && text.indexOf('&') < 0) return text.replace(/\s+/g, ' ').trim();
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A line cut to `maxChars`, with an ellipsis where it was cut. */
function cut(text: string): string {
  const max = MESSAGES.maxChars;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

interface Line {
  readonly el: HTMLElement;
  readonly who: HTMLElement;
  readonly said: HTMLElement;
  readonly count: HTMLElement;
  /** What the element is showing now, so nothing is written twice. */
  kind: MessageKind | '';
  text: string;
  speaker: string;
  colour: string;
  countText: string;
  /** How many times these words have been said, seconds since the last of them, and the opacity step shown. */
  n: number;
  age: number;
  step: number;
  live: boolean;
  /** Seconds since the words were first said, which is what stops a repeat keeping the line alive for ever. */
  first: number;
  /** Seconds since the count was written, and whether a repeat is waiting to be written. */
  countAge: number;
  countDue: boolean;
}

export class MessageLine {
  readonly root: HTMLElement;
  private readonly pool: Line[] = [];
  private readonly free: Line[] = [];
  /** Oldest first: the order they were said in, which is the order they stand in. */
  private readonly live: Line[] = [];
  private readonly stat: MessageStats = { lines: 0, fading: 0, writes: 0, said: 0, merged: 0, dropped: 0 };
  /** The opacity strings, one per step, built once and rebuilt only when the step count is changed live. */
  private opacity: string[] = [];
  private builtSteps = 0;
  private on = true;
  private rootHidden = false;
  /** True when the HUD stylesheet is not loaded and the line has had to style itself. */
  readonly styleless: boolean;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-msgs';
    parent.appendChild(this.root);
    this.styleless = !styled(this.root);
    if (this.styleless) this.root.style.cssText = ROOT_FALLBACK;
    const size = Math.max(1, Math.round(MESSAGES.pool));
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'hud-msg';
      el.hidden = true;
      if (this.styleless) el.style.cssText = LINE_FALLBACK;
      const who = document.createElement('span');
      who.className = 'who';
      const said = document.createElement('span');
      said.className = 'said';
      const count = document.createElement('span');
      count.className = 'count';
      el.appendChild(who);
      el.appendChild(said);
      el.appendChild(count);
      this.root.appendChild(el);
      const line: Line = { el, who, said, count, kind: '', text: '', speaker: '', colour: '', countText: '', n: 0, age: 0, step: -1, live: false, first: 0, countAge: COUNT_READY, countDue: false };
      this.pool.push(line);
      this.free.push(line);
    }
    this.buildOpacity();
  }

  /** How many lines the pool holds: fixed when the line was built. */
  get size(): number {
    return this.pool.length;
  }

  /** Whether the line is shown at all (the setting). Turning it off clears what is up. */
  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) this.clear();
    this.showRoot(on);
  }

  /**
   * Say something. `speaker` and `colour` are for words somebody said (the pilots' taunts, and later
   * chat): the speaker is written in that colour ahead of the words. The same words said again within
   * `merge` seconds bump a count on the line already there rather than adding another.
   */
  say(kind: MessageKind, text: string, speaker?: string, colour?: string): void {
    if (!this.on) return;
    const words = cut(String(text ?? '').trim());
    if (!words) return;
    const who = speaker ? String(speaker) : '';
    const tint = colour ? String(colour) : '';
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      if (l.kind === kind && l.text === words && l.speaker === who && l.age <= MESSAGES.merge) {
        l.n++;
        // A repeat restarts the clock, but only while the line is still inside its own first life: words
        // repeated from a per-frame branch would otherwise keep one line on the screen for ever.
        if (l.first < MESSAGES.seconds) l.age = 0;
        this.stat.merged++;
        this.bumpCount(l);
        this.fadeTo(l);
        // The freshest line stands last and is the last to be pushed off, so a merge moves it to the end
        // of the queue as well as of the parent. Already last: nothing to move, and nothing is written.
        const last = this.live.length - 1;
        if (i !== last) {
          for (let j = i; j < last; j++) this.live[j] = this.live[j + 1];
          this.live[last] = l;
          this.root.appendChild(l.el);
          this.stat.writes++;
        }
        return;
      }
    }
    const kept = Math.max(1, Math.min(Math.round(MESSAGES.kept), this.pool.length));
    while (this.live.length >= kept) {
      this.stat.dropped++;
      this.retire(this.live.shift()!);
    }
    let line = this.free.pop();
    if (!line) {
      // The pool is the live lines plus the free ones, so this cannot happen; it is here so that a
      // miscount would drop the oldest line rather than throw in the frame loop.
      const oldest = this.live.shift();
      if (!oldest) return;
      this.stat.dropped++;
      this.retire(oldest);
      line = this.free.pop()!;
    }
    line.n = 1;
    line.age = 0;
    line.first = 0;
    line.live = true;
    if (line.kind !== kind) {
      if (line.kind) this.classOff(line.el, KIND_CLASS[line.kind]);
      line.kind = kind;
      this.classOn(line.el, KIND_CLASS[kind]);
      if (this.styleless) this.writeStyle(line.el.style, 'borderLeftColor', KIND_RULE[kind]);
    }
    if (line.speaker !== who || line.colour !== tint) {
      line.speaker = who;
      line.colour = tint;
      this.writeText(line.who, who ? `${who}: ` : '');
      this.writeStyle(line.who.style, 'color', tint);
    }
    if (line.text !== words) {
      line.text = words;
      this.writeText(line.said, words);
    }
    // A fresh line has no count, and is ready to show one the moment the same words come again.
    line.countDue = false;
    line.countAge = COUNT_READY;
    if (line.countText !== '') {
      line.countText = '';
      this.writeText(line.count, '');
    }
    // Last said stands last: moving the element is a move, not a build, and happens once per line.
    this.root.appendChild(line.el);
    this.stat.writes++;
    this.show(line.el, true);
    line.step = -1;
    this.fadeTo(line);
    this.live.push(line);
    this.stat.said++;
  }

  /** The game speaking: a refusal, a connection, a jump's notices. */
  system(text: string): void {
    this.say('system', text);
  }

  /** An aside: what a key would do, what is being prepared. */
  note(text: string): void {
    this.say('note', text);
  }

  /** A blow you landed. */
  youHit(text: string): void {
    this.say('youHit', text);
  }

  /** A blow you took. */
  hitYou(text: string): void {
    this.say('hitYou', text);
  }

  /** Somebody else's words, in their own colour. */
  spatial(speaker: string, text: string, colour: string): void {
    this.say('spatial', text, speaker, colour);
  }

  /** Once a frame. Ages the lines, fades the last second of each, and retires the ones that are done. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    let n = 0;
    let fading = 0;
    for (let i = 0; i < this.live.length; i++) {
      const l = this.live[i];
      l.age += step;
      l.first += step;
      l.countAge += step;
      if (l.age >= MESSAGES.seconds) {
        // A count still waiting is not written: the line is going, and nothing would see it.
        this.retire(l);
        continue;
      }
      if (l.countDue && l.countAge >= MESSAGES.countEvery) this.writeCount(l);
      if (MESSAGES.seconds - l.age < MESSAGES.fade) fading++;
      this.fadeTo(l);
      this.live[n++] = l;
    }
    this.live.length = n;
    this.stat.lines = n;
    this.stat.fading = fading;
  }

  /** Everything gone at once: the world is being left. */
  clear(): void {
    for (let i = 0; i < this.live.length; i++) this.retire(this.live[i]);
    this.live.length = 0;
    this.stat.lines = 0;
    this.stat.fading = 0;
  }

  /** What the line is doing, in the object it always answers with: read between frames, it is still true. */
  debug(): MessageStats {
    let fading = 0;
    for (let i = 0; i < this.live.length; i++) {
      if (MESSAGES.seconds - this.live[i].age < MESSAGES.fade) fading++;
    }
    this.stat.lines = this.live.length;
    this.stat.fading = fading;
    return this.stat;
  }

  /** The words on a line, for a test or the debug helper; oldest first. */
  textAt(i: number): string {
    const l = this.live[i];
    if (!l) return '';
    return `${l.speaker ? `${l.speaker}: ` : ''}${l.text}${l.countText ? ` ${l.countText}` : ''}`;
  }

  /**
   * How faded a line is, 0 to 1: the opacity the module last wrote, which is not quite what is painted.
   * The stylesheet eases between the steps, so the screen trails this by up to one step.
   */
  opacityAt(i: number): number {
    const l = this.live[i];
    if (!l || this.builtSteps <= 0) return 0;
    return Math.max(0, Math.min(1, l.step / this.builtSteps));
  }

  // --- the writing ------------------------------------------------------------------------------------

  /**
   * A repeat asks for its count to be shown. It is written at once if the line's count has not been
   * written for `countEvery`, and otherwise left for `update` to write when that time has passed: words
   * repeated every frame cost a few writes a second rather than one a frame.
   */
  private bumpCount(l: Line): void {
    l.countDue = true;
    if (l.countAge >= MESSAGES.countEvery) this.writeCount(l);
  }

  private writeCount(l: Line): void {
    l.countDue = false;
    l.countAge = 0;
    // The stylesheet puts the space in front of it, so the element holds the count alone; past `maxCount`
    // it stops counting rather than widening the plate for ever.
    const max = MESSAGES.maxCount;
    const text = l.n > max ? `×${max}+` : l.n > 1 ? `×${l.n}` : '';
    if (text === l.countText) return;
    l.countText = text;
    this.writeText(l.count, text);
  }

  private fadeTo(l: Line): void {
    if (this.builtSteps !== Math.max(1, Math.round(MESSAGES.steps))) this.buildOpacity();
    const steps = this.builtSteps;
    const fade = MESSAGES.fade > 0 ? MESSAGES.fade : 0;
    const left = MESSAGES.seconds - l.age;
    let step = steps;
    // Down, not up: the last step a line takes is 0, so it is already invisible when it is hidden. With
    // the rounding the other way the smallest opacity ever written was one step, and every line popped.
    if (fade > 0 && left < fade) step = Math.floor((left / fade) * steps);
    if (step > steps) step = steps;
    if (step < 0) step = 0;
    if (step === l.step) return;
    l.step = step;
    this.writeStyle(l.el.style, 'opacity', this.opacity[step]);
  }

  private retire(l: Line): void {
    if (!l.live) return;
    l.live = false;
    this.show(l.el, false);
    this.free.push(l);
  }

  /** A line is taken off the screen by the attribute the stylesheet hides it with, not by moving it. */
  private show(el: HTMLElement, on: boolean): void {
    if (el.hidden !== !on) {
      el.hidden = !on;
      this.stat.writes++;
    }
  }

  private showRoot(on: boolean): void {
    const hide = !on;
    if (hide === this.rootHidden) return;
    this.rootHidden = hide;
    if (hide) this.classOn(this.root, 'hidden');
    else this.classOff(this.root, 'hidden');
  }

  private buildOpacity(): void {
    const steps = Math.max(1, Math.round(MESSAGES.steps));
    this.opacity = new Array<string>(steps + 1);
    for (let i = 0; i <= steps; i++) this.opacity[i] = (i / steps).toFixed(3);
    this.builtSteps = steps;
  }

  /** Every write goes through one of these, so what the debug helper reports is what the DOM actually took. */
  private writeText(el: HTMLElement, value: string): void {
    if (el.textContent === value) return;
    el.textContent = value;
    this.stat.writes++;
  }

  private writeStyle(style: CSSStyleDeclaration, key: string, value: string): void {
    const s = style as unknown as Record<string, string>;
    if (s[key] === value) return;
    s[key] = value;
    this.stat.writes++;
  }

  private classOn(el: HTMLElement, name: string): void {
    if (el.classList.contains(name)) return;
    el.classList.add(name);
    this.stat.writes++;
  }

  private classOff(el: HTMLElement, name: string): void {
    if (!el.classList.contains(name)) return;
    el.classList.remove(name);
    this.stat.writes++;
  }
}

/** Whether the HUD stylesheet has taken the line in hand: it lays it out absolutely, and nothing else does. */
function styled(el: HTMLElement): boolean {
  try {
    const pos = getComputedStyle(el).position;
    return pos === 'absolute' || pos === 'fixed';
  } catch {
    return false;
  }
}

/**
 * What the line looks like with no stylesheet: invented, and kept beside the fallback rule colours above
 * because they are the same fallback. It is deliberately plain — the stylesheet's own rules are better and
 * they win the moment they are there, because none of this is written when they are.
 */
const ROOT_FALLBACK =
  'position:absolute;left:16px;bottom:16px;display:flex;flex-direction:column;align-items:flex-start;gap:3px;max-width:40vw;pointer-events:none;';
const LINE_FALLBACK =
  'padding:2px 4px 2px 6px;border-left:2px solid var(--ink, #e8f1f8);background:rgba(6,10,18,0.35);font-size:13px;line-height:1.35;color:var(--text, #e8f1f8);text-shadow:0 0 2px #060a12;';
