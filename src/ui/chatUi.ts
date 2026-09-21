// The chat line: Enter opens it, what you type goes to the people around you or to your group, and
// what anybody says floats over their head for a few seconds and stands in the message line.
//
// It is DOM, because it carries words. Three rules hold it to the display's own habits. Nothing is
// allocated in a frame: the bubbles are a fixed pool made once and reused. Nothing is written to the
// page unless what is shown has changed: a bubble's text is written when it changes, its place when it
// has moved by a whole pixel. And nothing runs at all when there is nothing to show: the loop that
// follows the heads is started when the first bubble goes up and stopped when the last one goes down,
// so a screen with nobody talking costs nothing.
//
// Words from another player are data. They are written with `textContent` and are never HTML, never a
// selector and never a key.

import { GROUP_TUNE, Groups, parseLine, type ChatLine, type ChatScope, type PointOut } from '../net/groups.ts';
import { moodTag } from '../player/moods.ts';

/** Where a world point landed on the screen, in pixels from the top left. Filled in place. */
export interface ChatScreenPoint {
  x: number;
  y: number;
}

/**
 * The numbers this file invents, live: `__debug.chat({ bubbleWidth: 320 })` sets one and the next
 * bubble obeys it. How long a bubble stands is the group module's `bubbleSeconds`, because the same
 * number is what the log and the bubble both mean by "recent".
 */
export const CHAT_TUNE = {
  /** Invented: how far up from the bottom the typing line sits, in pixels at scale 1, clear of the message line. */
  bottomPx: 200,
  /**
   * Invented: bubbles made at construction, and so the most that can be up at once. It is read once,
   * when the line is built, because that is what a fixed pool means; setting it from the console
   * afterwards moves the number and not the pool, and `tuneChat` leaves it alone for that reason.
   */
  pool: 6,
  /** Invented: how wide a bubble may be, in pixels. */
  bubbleWidth: 260,
  /** Invented: metres above a figure's feet that their bubble hangs. */
  bubbleLift: 2.35,
  /** Invented: the last share of a bubble's life spent fading. */
  fade: 0.25,
  /**
   * Invented: how many steps that fade is written in. A bubble costs this many writes over its whole
   * life rather than one a frame, which is the point; more of them is a smoother fade and more writes.
   */
  fadeSteps: 8,
  /** Invented: metres past which a bubble is not drawn at all; a shout from across the valley is in the log. */
  bubbleRange: 60,
  /**
   * Invented: milliseconds the game's keys are kept standing aside after Escape has shut the line.
   * Escape is also the browser's own way out of a pointer lock, so the same press drops the lock and
   * the change that follows would otherwise read as "the player pressed Escape while playing" and
   * open the game's menu behind the closed line. Holding the keys aside until that change has gone by
   * is what stops it; the game's own menu guard is 300 ms, and this is a little over it.
   */
  escapeHoldMs: 400,
  /** Whether a line also goes to the message line, which is the log until the display grows one of its own. */
  toMessageLine: true,
  /**
   * Invented: whether Enter opens the line when there is no server. It did not, and the reason was a
   * good one -- a game played alone must be the game it was, and a line with nobody to say anything
   * to explains itself for nothing. What changed is that the line is no longer only for saying
   * things to people: `/mood` poses your own body and is saved on your own character, and it is the
   * only way in that this wave built (the design's other one, a list in the Skills panel, was not).
   * With this at false the line is shut again with no server and `__debug.mood({ set })` is the only
   * way to a mood, which is the old behaviour exactly.
   *
   * Nothing else about playing alone moves: a line of plain words typed with no server is kept in
   * the log and answered with "there is no server here, so nobody heard that", which is what the
   * group module has always done with one.
   */
  aloneOpens: true,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneChat(o: Partial<typeof CHAT_TUNE>): typeof CHAT_TUNE {
  if (typeof o.bottomPx === 'number') CHAT_TUNE.bottomPx = Math.max(0, Math.min(2000, Math.round(o.bottomPx)));
  if (typeof o.bubbleWidth === 'number') CHAT_TUNE.bubbleWidth = Math.max(80, Math.min(800, Math.round(o.bubbleWidth)));
  if (typeof o.bubbleLift === 'number') CHAT_TUNE.bubbleLift = Math.max(0, Math.min(20, o.bubbleLift));
  if (typeof o.fade === 'number') CHAT_TUNE.fade = Math.max(0, Math.min(0.9, o.fade));
  if (typeof o.fadeSteps === 'number') CHAT_TUNE.fadeSteps = Math.max(1, Math.min(64, Math.round(o.fadeSteps)));
  if (typeof o.escapeHoldMs === 'number') CHAT_TUNE.escapeHoldMs = Math.max(0, Math.min(2000, Math.round(o.escapeHoldMs)));
  if (typeof o.bubbleRange === 'number') CHAT_TUNE.bubbleRange = Math.max(1, Math.min(2000, o.bubbleRange));
  if (typeof o.toMessageLine === 'boolean') CHAT_TUNE.toMessageLine = o.toMessageLine;
  if (typeof o.aloneOpens === 'boolean') CHAT_TUNE.aloneOpens = o.aloneOpens;
  return CHAT_TUNE;
}

/** What the chat line is doing, filled in place for the console: never a new object. */
export interface ChatStats {
  open: boolean;
  scope: ChatScope;
  bubbles: number;
  /** Every write this file has made to the page since it was built; sample it a second apart for the rate. */
  writes: number;
  /** Frames the bubble loop has run, and whether it is running now. */
  frames: number;
  running: boolean;
}

/** What the chat line needs of the game. Everything is a function, so nothing here holds a stale copy. */
export interface ChatDeps {
  /** The group and the chat as this browser holds them. */
  groups: Groups;
  /** A line for the message line: who said it, what they said, and the colour their name wears. */
  say: (speaker: string, text: string, colour: string) => void;
  /** A world point onto this frame's screen; false when it is behind the camera. */
  project: (x: number, y: number, z: number, out: ChatScreenPoint) => boolean;
  /** Where a speaker's figure is, in the world; false when they are not on this world. */
  anchor: (id: number, out: PointOut) => boolean;
  /** Where this player stands, for how far away a speaker is. */
  meAt: (out: PointOut) => boolean;
  /** Whether Enter should open the line here: in the world, no panel up, not travelling. */
  canOpen: () => boolean;
  /** The keyboard is being typed into (or is free again): the game's input stands aside. */
  typing: (on: boolean) => void;
  /**
   * Ask for the pointer back. Escape shuts this line, and it is also the browser's own way out of a
   * pointer lock, so the game loses the mouse on the press that closes the line and has to ask for it
   * again. The game's own `requestLock` already knows that a browser refuses one asked for straight
   * after Escape and tries again a moment later.
   */
  relock?: () => void;
  /**
   * `/mood <name>`, or `/mood` on its own for the list. The answer is what to tell the player, in
   * words; a mood the pack has no body branch for is still set and still says so, because "not yet"
   * is not an error. Absent (a page that has not wired the moods) and `/mood` says so rather than
   * looking like a command that does nothing.
   */
  mood?: (arg: string) => string;
  /**
   * The mood a speaker is in, by name, so that what they say is marked with it: their own id for a
   * peer, 0 for this player, and a negative id for a speaker nobody could name, which must answer ''
   * rather than falling back on anybody. '' when they are in none, which is the ordinary case, and
   * the whole hook is optional.
   */
  moodOf?: (id: number) => string;
}

interface Bubble {
  readonly el: HTMLElement;
  readonly who: HTMLElement;
  readonly what: HTMLElement;
  id: number;
  /** Seconds left; 0 when the bubble is free. */
  left: number;
  /** What the element is showing now, so nothing is written twice. */
  name: string;
  text: string;
  scope: ChatScope;
  x: number;
  y: number;
  step: number;
  shown: boolean;
}

const CSS = `
.chat-line {
  position: absolute;
  left: calc(14px * var(--hud-scale, 1));
  display: flex;
  align-items: center;
  gap: calc(6px * var(--hud-scale, 1));
  padding: calc(4px * var(--hud-scale, 1)) calc(8px * var(--hud-scale, 1));
  border-radius: 4px;
  background: color-mix(in srgb, var(--void) 72%, transparent);
  border: 1px solid var(--rule);
  font: 500 calc(13px * var(--hud-scale, 1))/1.3 system-ui, sans-serif;
  color: var(--ink);
  pointer-events: auto;
  z-index: 6;
}
.chat-line.hidden { display: none; }
.chat-line > .scope { color: var(--accent); white-space: nowrap; }
.chat-line > input {
  width: calc(360px * var(--hud-scale, 1));
  background: transparent;
  border: 0;
  outline: 0;
  color: inherit;
  font: inherit;
}
.chat-bubbles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 5;
}
.chat-bubble {
  position: absolute;
  top: 0;
  left: 0;
  max-width: 260px;
  padding: 3px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--void) 72%, transparent);
  border: 1px solid var(--rule);
  font: 500 13px/1.3 system-ui, sans-serif;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  will-change: transform, opacity;
}
.chat-bubble.hidden { display: none; }
.chat-bubble.group { border-color: var(--accent); }
.chat-bubble > b { color: var(--accent); font-weight: 600; margin-right: 4px; }
`;

/** The colour a speaker's name wears in the message line: the group's own channel stands apart. */
const SAY_COLOUR = 'var(--ink)';
const GROUP_COLOUR = 'var(--accent)';

export class ChatUi {
  readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly scopeEl: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly layer: HTMLElement;
  private readonly bubbles: Bubble[] = [];
  private scope: ChatScope = 'say';
  private raf = 0;
  private last = 0;
  /** The timer that gives the game its keys back after Escape; 0 when there is none outstanding. */
  private hold = 0;
  /**
   * The bubble loop's callback, made once and used for every frame: a fresh closure per frame is an
   * allocation per frame, which is the one thing nothing in this game is allowed to do.
   */
  private readonly onFrame: () => void = () => this.tick();
  /** The group module's chat handler as it was before this line chained onto it, and this line's own. */
  private hadChat: (line: ChatLine) => void = () => {};
  private mineChat: (line: ChatLine) => void = () => {};
  private readonly at: ChatScreenPoint = { x: 0, y: 0 };
  private readonly where: PointOut = { x: 0, y: 0, z: 0 };
  private readonly me: PointOut = { x: 0, y: 0, z: 0 };
  private readonly stat: ChatStats = { open: false, scope: 'say', bubbles: 0, writes: 0, frames: 0, running: false };
  private readonly onKey: (e: KeyboardEvent) => void;
  /**
   * What the chat line needs of the game. It is assigned in the body rather than written as a
   * parameter property, because a node test runs this file as it is -- node strips the types and
   * nothing else, and a parameter property is not something it can strip.
   */
  private readonly deps: ChatDeps;

  constructor(parent: HTMLElement, deps: ChatDeps) {
    this.deps = deps;
    if (!document.getElementById('chat-style')) {
      const style = document.createElement('style');
      style.id = 'chat-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'chat-root';
    parent.appendChild(this.root);

    this.layer = document.createElement('div');
    this.layer.className = 'chat-bubbles';
    this.root.appendChild(this.layer);

    this.bar = document.createElement('div');
    this.bar.className = 'chat-line hidden';
    this.bar.style.bottom = `calc(${CHAT_TUNE.bottomPx}px * var(--hud-scale, 1))`;
    this.bar.innerHTML = '<span class="scope"></span><input type="text" autocomplete="off" spellcheck="false" />';
    this.root.appendChild(this.bar);
    this.scopeEl = this.bar.querySelector<HTMLElement>('.scope')!;
    this.field = this.bar.querySelector<HTMLInputElement>('input')!;
    this.field.maxLength = GROUP_TUNE.chars;
    this.field.addEventListener('keydown', (e) => this.fieldKey(e));
    // Clicking away closes rather than leaving a field with the keyboard and no sign of it.
    this.field.addEventListener('blur', () => {
      if (this.open) this.close();
    });

    // A fixed pool, made once: a bubble is borrowed and given back, and none is ever made in a frame.
    for (let i = 0; i < CHAT_TUNE.pool; i++) {
      const el = document.createElement('div');
      el.className = 'chat-bubble hidden';
      const who = document.createElement('b');
      const what = document.createElement('span');
      el.appendChild(who);
      el.appendChild(what);
      this.layer.appendChild(el);
      this.bubbles.push({ el, who, what, id: 0, left: 0, name: '', text: '', scope: 'say', x: -1e6, y: -1e6, step: -1, shown: false });
    }

    this.onKey = (e) => this.worldKey(e);
    window.addEventListener('keydown', this.onKey);

    // Everything anyone says arrives here: the log, the message line and a bubble over their head.
    // Whatever was listening before still is -- the display may grow a log of its own, and a panel
    // that had taken the hook would otherwise be silently unplugged by this one being built.
    // What was there is kept with our own wrapper, so `dispose` can put the chain back the way it was
    // -- but only where this line's wrapper is still the one hanging there. Somebody who chained onto
    // ours after we were built owns the hook now, and putting ours back would unplug them.
    this.hadChat = deps.groups.onChat;
    this.mineChat = (line) => {
      this.hadChat(line);
      this.heard(line);
    };
    deps.groups.onChat = this.mineChat;
  }

  // ---- the typing line -----------------------------------------------------------------------------

  get open(): boolean {
    return !this.bar.classList.contains('hidden');
  }

  /** Enter in the world opens the line; nothing else here touches the game's keys. */
  private worldKey(e: KeyboardEvent): void {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (this.open) return;
    const t = e.target as HTMLElement | null;
    // Something else is being typed into (a name in the creator, an address in the menu): not ours.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // With no server there is nobody to say anything to -- but the line is not only for saying things
    // to people any more: `/mood` poses your own body and is kept on your own character, and is the
    // one way to a mood the game has (the design's other, a list in the Skills panel, is not built).
    // So the line opens alone as well, and `CHAT_TUNE.aloneOpens` at false is the old rule back, with
    // `__debug.chat({ open: true })` and `__debug.mood({ set })` still reaching both halves.
    if (!this.deps.groups.active && !(CHAT_TUNE.aloneOpens && this.deps.mood)) return;
    if (!this.deps.canOpen()) return;
    e.preventDefault();
    this.show();
  }

  private fieldKey(e: KeyboardEvent): void {
    // The game never sees these: the field has the keyboard, and `Input` stands aside for a field.
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
      return;
    }
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    e.stopPropagation();
    const typed = this.field.value;
    this.field.value = '';
    this.close();
    if (!typed.trim()) return;
    // The channel sticks: a group having a conversation does not type /g on every line. Which channel
    // the line named is the group module's reading of it, not a guess at the raw string here: `/group
    // on my way` and `/gtell on my way` are both lines to the group, and sniffing for `/g ` missed
    // them both and left the next line going to the room.
    const line = parseLine(typed, this.scope);
    if (line.kind === 'chat') this.scope = line.scope;
    else if (line.command === 'group') this.scope = 'group';
    else if (line.command === 'say') this.scope = 'say';
    // The mood is this line's own command and never the group module's: what it writes is a rig, a
    // character record and a hello, none of which the group knows anything about, and a command the
    // group does not know would otherwise come back as "there is no /mood".
    if (line.kind === 'command' && line.command === 'mood') {
      this.deps.say('', this.deps.mood ? this.deps.mood(line.arg) : 'there are no moods here', SAY_COLOUR);
      return;
    }
    // What the line meant is the group module's to decide: a command does its work there, and words go
    // on whichever channel they named or on the one this line is set to.
    const answer = this.deps.groups.type(typed, this.scope);
    if (answer) this.deps.say('', answer, SAY_COLOUR);
  }

  /** Open the line, on the channel it was last left on (the group's, if you are still in one). */
  show(scope?: ChatScope): void {
    if (scope) this.scope = scope;
    if (this.scope === 'group' && !this.deps.groups.roster) this.scope = 'say';
    // Where the line sits and how long it takes are read here rather than only at build time, so that
    // both are worth setting from the console while the game is running.
    const bottom = `calc(${CHAT_TUNE.bottomPx}px * var(--hud-scale, 1))`;
    if (this.bar.style.bottom !== bottom) {
      this.bar.style.bottom = bottom;
      this.stat.writes++;
    }
    if (this.field.maxLength !== GROUP_TUNE.chars) {
      this.field.maxLength = GROUP_TUNE.chars;
      this.stat.writes++;
    }
    this.write(this.scopeEl, 'textContent', this.scope === 'group' ? 'group:' : 'say:');
    this.bar.classList.remove('hidden');
    this.stat.open = true;
    this.stat.scope = this.scope;
    this.cancelHold();
    this.deps.typing(true);
    this.field.focus();
  }

  /**
   * Shut the line. Escape is the one way out that also costs the pointer lock, because the browser
   * takes it back on that press: the mouse is asked for again, and the game's keys are held aside
   * until the lock change that follows has gone by, so that one press does not both close this line
   * and open the game's menu behind it. Every other way out gives the keys back at once.
   */
  close(byEscape = false): void {
    if (!this.open) return;
    this.bar.classList.add('hidden');
    this.stat.open = false;
    this.field.blur();
    if (byEscape && this.deps.relock && this.deps.canOpen()) {
      this.deps.relock();
      this.holdKeys(CHAT_TUNE.escapeHoldMs);
    } else this.holdKeys(0);
  }

  private cancelHold(): void {
    if (!this.hold) return;
    window.clearTimeout(this.hold);
    this.hold = 0;
  }

  /** Give the game its keys back, now or after a moment. Only ever one hold is outstanding. */
  private holdKeys(ms: number): void {
    this.cancelHold();
    if (ms <= 0) {
      this.deps.typing(false);
      return;
    }
    this.hold = window.setTimeout(() => {
      this.hold = 0;
      if (!this.open) this.deps.typing(false);
    }, ms);
  }

  // ---- what people said ----------------------------------------------------------------------------

  /**
   * The mood a speaker is in, as it is written after their name: the chat half of a mood, which
   * happens whether or not their pack has a branch for it and whether or not the name is one this
   * game offers. Their own word for it, from their hello, never a guess from anything drawn.
   */
  private moodOf(line: ChatLine): string {
    if (!this.deps.moodOf) return '';
    // Who to ask about. 0 is this player and a positive id is that peer -- but a line the server put
    // no id on arrives as id 0 and `mine` false, and 0 already means "this player" here, so asking
    // with it would write **your** mood after a stranger's name, which is a statement about somebody
    // else that is simply untrue. A speaker nobody could name is asked for as -1, which is nobody,
    // and the answer is no mark at all.
    const who = line.mine ? 0 : line.id > 0 ? line.id : -1;
    return moodTag(this.deps.moodOf(who));
  }

  private heard(line: ChatLine): void {
    const mood = this.moodOf(line);
    if (CHAT_TUNE.toMessageLine) {
      const who = `${line.mine ? 'you' : line.name}${mood}`;
      this.deps.say(line.scope === 'group' ? `[group] ${who}` : who, line.text, line.scope === 'group' ? GROUP_COLOUR : SAY_COLOUR);
    }
    // Your own words are in the line you typed them on; a bubble over your own head is for nobody.
    if (line.mine || line.id <= 0) return;
    this.bubble(line);
  }

  private bubble(line: ChatLine): void {
    // Not on this world, or too far to make out: the log has it, the air does not.
    if (!this.deps.anchor(line.id, this.where)) return;
    if (this.deps.meAt(this.me)) {
      const away = Math.hypot(this.where.x - this.me.x, this.where.y - this.me.y, this.where.z - this.me.z);
      if (away > CHAT_TUNE.bubbleRange) return;
    }
    // One bubble per speaker: a second line replaces their first rather than stacking two on one head.
    let b = this.bubbles.find((x) => x.left > 0 && x.id === line.id);
    if (!b) b = this.bubbles.find((x) => x.left <= 0);
    if (!b) {
      // All of them are up: the oldest gives way, which is what a fixed pool means.
      b = this.bubbles[0];
      for (const x of this.bubbles) if (x.left < b.left) b = x;
    }
    b.id = line.id;
    b.left = GROUP_TUNE.bubbleSeconds;
    // The name over their head wears their mood, as the line in the log does; written only when it
    // has changed, so a speaker who has not changed their mood writes nothing.
    const named = `${line.name}${this.moodOf(line)}`;
    if (b.name !== named) {
      b.name = named;
      this.write(b.who, 'textContent', named);
    }
    if (b.text !== line.text) {
      b.text = line.text;
      this.write(b.what, 'textContent', line.text);
    }
    if (b.scope !== line.scope) {
      b.scope = line.scope;
      b.el.classList.toggle('group', line.scope === 'group');
      this.stat.writes++;
    }
    const width = `${CHAT_TUNE.bubbleWidth}px`;
    if (b.el.style.maxWidth !== width) {
      b.el.style.maxWidth = width;
      this.stat.writes++;
    }
    this.start();
  }

  // ---- the loop that follows the heads ---------------------------------------------------------------

  /** Started when the first bubble goes up; it stops itself when the last one comes down. */
  private start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.stat.running = true;
    this.raf = requestAnimationFrame(this.onFrame);
  }

  private tick(): void {
    this.raf = 0;
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.stat.frames++;
    let live = 0;
    for (const b of this.bubbles) {
      if (b.left <= 0) continue;
      b.left -= dt;
      if (b.left <= 0) {
        this.hideBubble(b);
        continue;
      }
      live++;
      this.place(b);
    }
    this.stat.bubbles = live;
    if (live > 0) {
      this.stat.running = true;
      this.raf = requestAnimationFrame(this.onFrame);
    } else this.stat.running = false;
  }

  private place(b: Bubble): void {
    if (!this.deps.anchor(b.id, this.where) || !this.deps.project(this.where.x, this.where.y + CHAT_TUNE.bubbleLift, this.where.z, this.at)) {
      if (b.shown) {
        b.el.classList.add('hidden');
        b.shown = false;
        this.stat.writes++;
      }
      return;
    }
    if (!b.shown) {
      b.el.classList.remove('hidden');
      b.shown = true;
      this.stat.writes++;
    }
    // Written only when it has moved a whole pixel: a figure standing still writes nothing at all.
    const x = Math.round(this.at.x);
    const y = Math.round(this.at.y);
    if (x !== b.x || y !== b.y) {
      b.x = x;
      b.y = y;
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      this.stat.writes++;
    }
    // The fade is written in steps, so a bubble costs a handful of writes over its life, not one a frame.
    const life = Math.max(0.001, GROUP_TUNE.bubbleSeconds);
    const fadeAt = life * CHAT_TUNE.fade;
    const share = b.left >= fadeAt ? 1 : b.left / fadeAt;
    const steps = Math.max(1, Math.round(CHAT_TUNE.fadeSteps));
    const step = Math.max(0, Math.min(steps, Math.round(share * steps)));
    if (step !== b.step) {
      b.step = step;
      b.el.style.opacity = step >= steps ? '' : String(step / steps);
      this.stat.writes++;
    }
  }

  private hideBubble(b: Bubble): void {
    b.left = 0;
    b.id = 0;
    b.step = -1;
    b.x = -1e6;
    b.y = -1e6;
    if (b.shown) {
      b.el.classList.add('hidden');
      b.shown = false;
      this.stat.writes++;
    }
  }

  private write(el: HTMLElement, key: 'textContent', value: string): void {
    if (el[key] === value) return;
    el[key] = value;
    this.stat.writes++;
  }

  /** Everything down: the line closed and every bubble taken away (a travel, the select screen). */
  clearAll(): void {
    this.close();
    for (const b of this.bubbles) this.hideBubble(b);
    this.stat.bubbles = 0;
  }

  /** What the chat line is doing, in the object it always answers with. */
  debug(): ChatStats {
    this.stat.scope = this.scope;
    this.stat.open = this.open;
    return this.stat;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    if (this.deps.groups.onChat === this.mineChat) this.deps.groups.onChat = this.hadChat;
    this.cancelHold();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stat.running = false;
    this.root.remove();
  }
}
