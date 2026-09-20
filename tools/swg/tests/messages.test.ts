// The message line (src/ui/messages.ts): the pool never grows, the oldest line goes, the same words said
// again bump a count, a line's words are written once and never again, and - the bug this line exists for
// - a one-shot message lives out its whole eight seconds with a prompt being rewritten every frame
// underneath it. A tiny stand-in for the browser's DOM, which counts every write it is given, so the
// module's own count of what it wrote can be checked against what the elements actually took.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the stand-in DOM -------------------------------------------------------------------------------

/** Every write the stand-in took, by kind, so a claim about per-frame cost can be checked from outside. */
const dom = { text: 0, style: 0, className: 0, attr: 0, moves: 0 };
/** Whether the stylesheet is pretended to be loaded: the line lays itself out only when it is not. */
let hasStyleSheet = true;

/** The style object counts every write it takes, the way the real one would cost a recalculation. */
const styleStore = (): Record<string, string> =>
  new Proxy({} as Record<string, string>, {
    get: (t, k: string) => t[k],
    set: (t, k: string, v: string) => {
      t[k] = v;
      dom.style++;
      return true;
    },
  });

class El {
  readonly children: El[] = [];
  parent: El | null = null;
  style = styleStore();
  /** Writes this element itself took. */
  textWrites = 0;
  private cls: string[] = [];
  private text = '';
  private off = false;
  readonly classList = {
    add: (name: string) => {
      if (this.cls.includes(name)) return;
      this.cls.push(name);
      dom.className++;
    },
    remove: (name: string) => {
      const i = this.cls.indexOf(name);
      if (i < 0) return;
      this.cls.splice(i, 1);
      dom.className++;
    },
    contains: (name: string) => this.cls.includes(name),
  };

  tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  get className(): string {
    return this.cls.join(' ');
  }

  set className(v: string) {
    this.cls = v.split(/\s+/).filter(Boolean);
    dom.className++;
  }

  get hidden(): boolean {
    return this.off;
  }

  set hidden(v: boolean) {
    this.off = v;
    dom.attr++;
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(v: string) {
    this.text = v;
    this.textWrites++;
    dom.text++;
  }

  appendChild(child: El): void {
    if (child.parent) {
      const i = child.parent.children.indexOf(child);
      if (i >= 0) child.parent.children.splice(i, 1);
      dom.moves++;
    }
    child.parent = this;
    this.children.push(child);
  }
}

(globalThis as any).document = { createElement: (tag: string) => new El(tag) };
(globalThis as any).getComputedStyle = () => ({ position: hasStyleSheet ? 'absolute' : 'static' });

const { MESSAGES, MessageLine, MESSAGE_KINDS, plain, tuneMessages } = await import('../../../src/ui/messages.ts');

/** The numbers back as they were, so one block cannot colour the next. */
const DEFAULTS = { ...MESSAGES };
const reset = () => {
  Object.assign(MESSAGES, DEFAULTS);
  dom.text = 0;
  dom.style = 0;
  dom.className = 0;
  dom.attr = 0;
  dom.moves = 0;
};
/** A line built on a fresh parent. */
const build = () => {
  reset();
  return new MessageLine(new El('div') as unknown as HTMLElement);
};
/** Run `seconds` of frames at 60 a second. */
const run = (m: InstanceType<typeof MessageLine>, seconds: number) => {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) m.update(dt);
};
/** The elements standing on the screen, in the order they stand in. */
const shownOf = (m: InstanceType<typeof MessageLine>): El[] => (m.root as unknown as El).children.filter((c) => !c.hidden);

const TIMES = '×';

// --- the pool ---------------------------------------------------------------------------------------
{
  const m = build();
  ok(m.size === MESSAGES.pool && m.size === 8, 'the pool is eight lines, made once');
  const root = m.root as unknown as El;
  ok(root.children.length === 8, 'eight elements exist before a word is said');
  for (let i = 0; i < 40; i++) m.say('system', `line ${i}`);
  ok(root.children.length === 8, 'forty messages later there are still eight elements');
  ok(m.debug().lines === 8, 'eight of them are shown');
  ok(m.textAt(0) === 'line 32' && m.textAt(7) === 'line 39', 'the oldest went and the newest stands last');
  ok(m.debug().dropped === 32, 'and the line knows how many it pushed off');
}

// --- the oldest goes in order -----------------------------------------------------------------------
{
  const m = build();
  m.say('system', 'first');
  m.say('system', 'second');
  m.say('system', 'third');
  ok(m.textAt(0) === 'first' && m.textAt(2) === 'third', 'lines stand oldest first');
  const root = m.root as unknown as El;
  const last = root.children[root.children.length - 1];
  ok((last.children as El[])[1].textContent === 'third', 'the newest is the last element in the parent, so it stands at the bottom');
  tuneMessages({ kept: 2 });
  m.say('system', 'fourth');
  ok(m.debug().lines === 2 && m.textAt(0) === 'third' && m.textAt(1) === 'fourth', 'a smaller keep drops the oldest at once');
  reset();
}

// --- a repeat merges --------------------------------------------------------------------------------
{
  const m = build();
  m.say('hitYou', 'engine hit');
  run(m, 0.5);
  m.say('hitYou', 'engine hit');
  ok(m.debug().lines === 1, 'the same words within two seconds do not add a line');
  ok(m.textAt(0) === `engine hit ${TIMES}2`, 'they bump a count on the line already there');
  run(m, 1);
  m.say('hitYou', 'engine hit');
  ok(m.textAt(0) === `engine hit ${TIMES}3` && m.debug().merged === 2, 'and again');
  run(m, 2.5);
  m.say('hitYou', 'engine hit');
  ok(m.debug().lines === 2 && m.textAt(1) === 'engine hit', 'said again after the window it is a line of its own, with no count');
  m.say('system', 'engine hit');
  ok(m.debug().lines === 3, 'the same words of another kind are another line');
  const m2 = build();
  m2.say('spatial', 'you fly well', 'a pilot', '#ff9a6a');
  m2.say('spatial', 'you fly well', 'another pilot', '#9fb8d8');
  ok(m2.debug().lines === 2, 'the same words from two speakers are two lines');
}

// --- a line's words are written once ----------------------------------------------------------------
{
  const m = build();
  m.say('system', 'crashed at 48 km/h: 12 damage');
  const said = (shownOf(m)[0].children as El[])[1];
  ok(said.textContent === 'crashed at 48 km/h: 12 damage', 'the words are on the element');
  ok(said.textWrites === 1, 'written once');
  run(m, 7.5);
  ok(said.textWrites === 1, 'and not written again in seven and a half seconds of frames');
  const before = m.debug().writes;
  run(m, 1.5);
  ok(said.textWrites === 1, 'nor while it fades and goes');
  ok(m.debug().writes - before <= MESSAGES.steps + 2, 'a whole fade costs one write a step, not one a frame');
}

// --- nothing is written in a steady frame -----------------------------------------------------------
{
  const m = build();
  m.say('note', 'preparing the ship');
  m.say('youHit', 'shields down');
  run(m, 1);
  const writes = m.debug().writes;
  const text = dom.text;
  const style = dom.style;
  run(m, 3); // three seconds in the middle of a line's life: nothing shown changes
  ok(m.debug().writes === writes, 'three seconds of frames with nothing fading write nothing at all');
  ok(dom.text === text && dom.style === style, 'and the elements took nothing either');
  ok(m.debug().fading === 0, 'nothing is fading yet');
  run(m, 3.5);
  ok(m.debug().fading === 2, 'the last second of a line is the fading one');
  ok(m.opacityAt(0) < 1 && m.opacityAt(0) > 0, 'and it is part way faded');
}

// --- the line the prompt used to eat ----------------------------------------------------------------
{
  // The bug: the prompt was rebuilt and rewritten every frame from outside every guard, so a one-shot
  // message lived one frame. Here a prompt is rewritten every frame underneath a one-shot line, and the
  // line has to live out its whole eight seconds regardless.
  const m = build();
  const prompt = new El('div');
  m.say('system', 'crashed at 48 km/h: 12 damage');
  let seen = 0;
  const frames = Math.round(7.9 * 60);
  for (let i = 0; i < frames; i++) {
    prompt.textContent = `E leave - W/S throttle - ${i} km/h`; // the prompt, rebuilt every frame
    m.update(1 / 60);
    if (m.textAt(0) === 'crashed at 48 km/h: 12 damage') seen++;
  }
  ok(seen === frames, `a one-shot line is still there on every one of the ${frames} frames of its life`);
  ok(m.debug().lines === 1 && !shownOf(m)[0].hidden, 'and still on the screen at the end of them');
  ok(prompt.textWrites === frames, 'though the prompt beneath it was rewritten on every one');
  run(m, 0.3);
  ok(m.debug().lines === 0, 'after its eight seconds it is gone');
  const root = m.root as unknown as El;
  ok(root.children.length === 8 && root.children[7].hidden === true, 'its element is hidden, not removed');
  m.say('system', 'connected to the relay');
  ok(m.debug().lines === 1 && m.textAt(0) === 'connected to the relay', 'and the element is used again for the next one');
}

// --- kinds, speakers and colours --------------------------------------------------------------------
{
  const m = build();
  ok(MESSAGE_KINDS.length === 5, 'five kinds');
  for (const kind of MESSAGE_KINDS) m.say(kind, `a ${kind} line`);
  const classes = shownOf(m).map((c) => c.className);
  ok(classes.length === 5 && classes.every((c) => c.startsWith('hud-msg ')), 'every line keeps the class the stylesheet lays it out by');
  const kinds = classes.map((c) => c.split(' ').find((x) => x !== 'hud-msg'));
  ok(kinds.includes('system') && kinds.includes('you-hit') && kinds.includes('hit-you') && kinds.includes('spatial') && kinds.includes('note'), 'each kind puts its own class on its line');
  ok(new Set(kinds).size === 5, 'and the five are five different ones');
  const m2 = build();
  m2.spatial('a pilot', 'you are outmatched', '#ff9a6a');
  const who = (shownOf(m2)[0].children as El[])[0];
  ok(who.textContent === 'a pilot: ' && who.style.color === '#ff9a6a', "a speaker's name is written ahead of the words in their own colour");
  ok(m2.textAt(0) === 'a pilot: you are outmatched', 'and the line reads as one');
}

// --- what is refused and what is cut ----------------------------------------------------------------
{
  const m = build();
  m.say('system', '');
  m.say('system', '   ');
  ok(m.debug().lines === 0, 'an empty line (the old clears) is not a message');
  m.say('system', `${'word '.repeat(60)}end`);
  // The cut trims a trailing space before the ellipsis, so a cut that lands on one is a character short.
  ok(m.textAt(0).length <= MESSAGES.maxChars && m.textAt(0).length >= MESSAGES.maxChars - 1 && m.textAt(0).endsWith('…'), 'a long line is cut to its limit with an ellipsis');
  m.say('system', `${'x'.repeat(200)}`);
  ok(m.textAt(1).length === MESSAGES.maxChars && m.textAt(1).endsWith('…'), 'a line with nowhere to trim is cut to the limit exactly');
  tuneMessages({ maxChars: 20 });
  m.say('system', 'a line of more than twenty characters');
  ok(m.textAt(2).length === 20, 'and the limit is live');
  reset();
}

// --- the knobs are live -----------------------------------------------------------------------------
{
  const m = build();
  tuneMessages({ seconds: 2, fade: 0.5, merge: 0.25, steps: 4, kept: 3 });
  ok(MESSAGES.seconds === 2 && MESSAGES.steps === 4 && MESSAGES.kept === 3, 'every number the line runs on can be set live');
  m.say('system', 'short');
  run(m, 1.4);
  ok(m.debug().lines === 1 && m.opacityAt(0) === 1, 'a line is whole until its fade begins');
  run(m, 0.3);
  ok(m.opacityAt(0) < 1 && m.opacityAt(0) > 0, 'part way through the fade it is part way faded');
  run(m, 0.4);
  ok(m.debug().lines === 0, 'and it goes at the seconds it was given');
  m.say('system', 'a');
  m.say('system', 'b');
  m.say('system', 'c');
  m.say('system', 'd');
  ok(m.debug().lines === 3 && m.textAt(0) === 'b', 'the keep is live too');
  tuneMessages({ kept: 99 });
  ok(MESSAGES.kept === 99, 'a keep past the pool is allowed to be set');
  for (let i = 0; i < 20; i++) m.say('note', `n${i}`);
  ok(m.debug().lines === m.size, 'but never shows more lines than the pool holds');
  reset();
}

// --- off, and cleared -------------------------------------------------------------------------------
{
  const m = build();
  m.say('system', 'one');
  m.say('system', 'two');
  m.clear();
  ok(m.debug().lines === 0, 'the world being left clears every line');
  const root = m.root as unknown as El;
  ok(root.children.every((c) => c.hidden), 'every element is hidden');
  m.say('system', 'after');
  ok(m.debug().lines === 1, 'and the line works again after a clear');
  m.setEnabled(false);
  ok(m.debug().lines === 0 && root.className.includes('hidden'), 'switched off, it clears and hides itself');
  m.say('system', 'unheard');
  ok(m.debug().lines === 0 && m.enabled === false, 'and says nothing while it is off');
  m.setEnabled(true);
  m.say('system', 'heard');
  ok(m.debug().lines === 1 && !root.className.includes('hidden'), 'switched on again it shows and takes lines');
}

// --- it stands up without its stylesheet ------------------------------------------------------------
{
  const m = build();
  ok(m.styleless === false, 'with the stylesheet loaded the line writes no style of its own');
  ok(!(m.root as unknown as El).style.position, 'nothing is laid out inline');
  hasStyleSheet = false;
  const bare = build();
  hasStyleSheet = true;
  ok(bare.styleless === true, 'without it, it knows');
  const root = bare.root as unknown as El;
  ok(root.style.cssText.includes('position:absolute') && root.style.cssText.includes('bottom'), 'and lays itself out at the bottom left');
  bare.say('hitYou', 'hit');
  ok(shownOf(bare)[0].style.borderLeftColor.includes('--bad'), "a kind's rule colour falls back to the name with a literal behind it");
}

// --- the words out of an old prompt line ------------------------------------------------------------
{
  ok(plain('at the controls of the ship <b>E</b> lets go') === 'at the controls of the ship E lets go', 'the markup an old prompt carried is taken out');
  ok(plain('plain words') === 'plain words', 'plain words are handed back untouched');
  ok(plain('<b>W</b>/<b>S</b>&nbsp;throttle') === 'W/S throttle', 'entities become their characters and the spaces collapse');
  ok(plain('  two   spaces  ') === 'two spaces', 'a line with no markup is collapsed and trimmed the same way, so both read alike');
  ok(plain('hull < 20 % > danger') === 'hull < 20 % > danger', 'and a bare angle bracket in the words is not a tag');
  const m = build();
  m.say('note', plain('aboard: <b>E</b> steps out'));
  ok(m.textAt(0) === 'aboard: E steps out', 'so an old prompt line reads as words');
}

// --- the fade ends at nothing -----------------------------------------------------------------------
{
  // Rounding the step up meant the smallest opacity ever written was one step and the line was then
  // hidden outright: every line popped off the screen part-lit. The last step a line takes is zero.
  const m = build();
  m.say('system', 'a line that fades away');
  const el = shownOf(m)[0];
  const seen: string[] = [];
  let hiddenAt = -1;
  for (let i = 0; i < Math.round(9 * 60); i++) {
    m.update(1 / 60);
    const o = el.style.opacity;
    if (o && seen[seen.length - 1] !== o) seen.push(o);
    if (hiddenAt < 0 && el.hidden) hiddenAt = i;
  }
  ok(seen[0] === '1.000', 'a line is written whole when it is said');
  ok(Number(seen[seen.length - 1]) === 0, `the last opacity written is nothing, not a step of it (${seen[seen.length - 1]})`);
  ok(seen.length === MESSAGES.steps + 1, `the fade is written in its steps and no more (${seen.length - 1} steps)`);
  ok(hiddenAt >= 0 && Number(el.style.opacity) === 0, 'and the line is already invisible when it is hidden');
  const m2 = build();
  tuneMessages({ fade: 0, seconds: 1 });
  m2.say('system', 'no fade at all');
  run(m2, 0.9);
  ok(m2.opacityAt(0) === 1 && m2.debug().lines === 1, 'with no fade a line stays whole to the end');
  run(m2, 0.2);
  ok(m2.debug().lines === 0, 'and then simply goes');
  reset();
}

// --- a repeat keeps its place in the queue ----------------------------------------------------------
{
  // The freshest line must be the last to be pushed off. Before this, a merge left the line where it was
  // and the eviction dropped it while older, untouched lines stayed.
  const m = build();
  tuneMessages({ kept: 3, merge: 10 });
  m.say('hitYou', 'engine hit');
  run(m, 1);
  m.say('system', 'b');
  run(m, 1);
  m.say('system', 'c');
  run(m, 1);
  m.say('hitYou', 'engine hit'); // merges into the first line, which is now the freshest thing said
  ok(m.debug().lines === 3 && m.textAt(2) === `engine hit ${TIMES}2`, 'a merged line moves to the newest place');
  const root = m.root as unknown as El;
  const live = root.children.filter((c) => !c.hidden);
  ok((live[live.length - 1].children as El[])[1].textContent === 'engine hit', 'and its element moves with it, so it stands at the bottom');
  m.say('system', 'd');
  ok(m.debug().lines === 3 && m.textAt(2) === 'd', 'the keep pushes one off');
  ok(m.textAt(0) === 'c' && m.textAt(1) === `engine hit ${TIMES}2`, 'and it is the oldest that goes, not the line just repeated');
  const moves = dom.moves;
  m.say('system', 'd');
  ok(dom.moves === moves, 'a repeat of the line already last moves nothing at all');
  reset();
}

// --- words repeated every frame cost almost nothing --------------------------------------------------
{
  // The safety net for the mistake this whole line exists to fix: a message sent from an unguarded
  // per-frame branch. It must not become a DOM write a frame, a count without end, or an immortal line.
  const m = build();
  const el0 = () => (shownOf(m)[0].children as El[])[2];
  const before = dom.text;
  for (let i = 0; i < 120; i++) {
    m.say('hitYou', 'engine hit');
    m.update(1 / 60);
  }
  const writes = dom.text - before;
  ok(writes <= 12, `two seconds of the same words said every frame cost a handful of writes, not one a frame (${writes})`);
  ok(m.debug().lines === 1, 'and one line, not a screenful');
  ok(el0().textContent === `${TIMES}99+`, 'the count stops widening the plate at its limit');
  const said = m.debug().said;
  let most = 0;
  for (let i = 0; i < 60 * 20; i++) {
    m.say('hitYou', 'engine hit');
    m.update(1 / 60);
    if (m.debug().lines > most) most = m.debug().lines;
  }
  ok(m.debug().said > said, 'a line repeated every frame for ever still ages out and is said afresh');
  // Two at the changeover: the old line finishes fading while the new one takes the repeats. Never more.
  ok(most <= 2, `and over twenty seconds of it the screen never holds more than two of it (${most})`);
  reset();
}

// --- a pooled element is cleaned before it is used again ---------------------------------------------
{
  // Every other block takes virgin elements out of the pool, so the paths that clear a stale kind,
  // speaker, colour and count never run - and those are where a bug wears the wrong kind's colour.
  const m = build();
  tuneMessages({ kept: 1 });
  m.say('hitYou', 'you are hit');
  const el = shownOf(m)[0];
  ok(el.className === 'hud-msg hit-you', 'the first message has its own kind');
  m.say('youHit', 'shields down');
  ok(shownOf(m)[0] === el, 'the same element is used again');
  ok(el.className === 'hud-msg you-hit', 'and it wears only the new kind, not both');
  m.spatial('a pilot', 'you fly well', '#ff9a6a');
  ok((el.children as El[])[0].textContent === 'a pilot: ' && (el.children as El[])[0].style.color === '#ff9a6a', 'a speaker and a colour go on');
  m.say('system', 'connected');
  ok((el.children as El[])[0].textContent === '' && (el.children as El[])[0].style.color === '', 'and both are taken off again for a line with no speaker');
  m.say('system', 'connected');
  ok((el.children as El[])[2].textContent === `${TIMES}2`, 'a count goes on');
  m.say('note', 'other words');
  ok((el.children as El[])[2].textContent === '' && el.className === 'hud-msg note', 'and the stale count is cleared with the kind');
  reset();
}

// --- odd frames ---------------------------------------------------------------------------------------
{
  const m = build();
  m.say('system', 'steady');
  const writes = m.debug().writes;
  m.update(0);
  m.update(NaN);
  m.update(-1);
  ok(m.debug().lines === 1 && m.debug().writes === writes, 'a frame of no time, no number or a step backwards ages nothing and writes nothing');
  run(m, 7.5);
  ok(m.debug().fading === 1, 'read between frames the fade count is still true');
  m.setEnabled(false);
  ok(m.debug().lines === 0 && m.debug().fading === 0, 'switched off while a line is fading, everything goes at once');
  m.setEnabled(true);
  m.say('system', 'after');
  run(m, 0.1);
  ok(m.opacityAt(0) === 1, 'and the next line starts whole rather than where the last one left off');
}

// --- a frame allocates nothing ----------------------------------------------------------------------
{
  const gc = (globalThis as any).gc as (() => void) | undefined;
  if (gc) {
    const m = build();
    for (let i = 0; i < 8; i++) m.say('note', `line ${i}`);
    run(m, 0.5);
    gc();
    const start = process.memoryUsage().heapUsed;
    // Six thousand frames, a hundred seconds of them, so every line ages, fades and is retired along the way.
    for (let i = 0; i < 6000; i++) {
      m.update(1 / 60);
      m.debug();
    }
    gc();
    const grew = process.memoryUsage().heapUsed - start;
    ok(grew < 64 * 1024, `six thousand frames leave the heap within 64 KB (${grew} bytes)`);
  } else console.log('skip six thousand frames allocate nothing: run with node --expose-gc to measure');
}

console.log(`\nmessages: ${checks} checks passed`);
