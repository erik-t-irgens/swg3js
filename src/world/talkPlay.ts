// A story's conversation played out in the window: which line stands now and for how long, when the answers
// show, when the player's own answer is said, when the next node is asked for, and when it ends. Pure: a clock
// in seconds and the nodes a host hands over go in, and what to show comes out as a step for the game to act
// on (`PlayStep`), so a node test drives the very sequence the game plays.
//
// **In turn.** A node's lines stand one after another, each for as long as its words take (`lineHold`, handed
// in), and a click or any digit moves on at once. After the last: the answers, when the node has any; the next
// node asked for, when it goes on by itself; the end, when it ends.
//
// **The player's answer** is said aloud under its own shot for `replyFor` seconds while the host works out what
// it leads to, and a node that comes back meanwhile waits until it has been said; a silent answer is said for
// no time at all. An answer that ends the conversation ends it once said.
//
// **Waiting.** The window may open before the first node arrives (a server answers when it answers); after
// `wait` seconds with none, or with an answer saying there is nothing to say, it falls back on the game's own
// greeting (`fallback`). A node that never comes after an answer ends the conversation after the same wait.
//
// **A node with nothing to say that only goes on** is asked past at the next step rather than in the same call
// that handed it over: this browser's own host answers inside the very call that asks it, so asked at once a
// run of such nodes would be one call inside another, a whole turn worked out at every level. And a run of more
// than `quietMax` of them in a row ends the conversation, since one going round in a ring would otherwise be
// asked for a frame at a time for ever (the checker refuses such a ring; this is the second line).

import type { NodeWord } from '../story/storyHost.ts';
import type { LineView, NodeView, ReplyView } from '../story/talkRules.ts';
import { TALK_TREE_TUNE, TALK_TUNE } from './talk.ts';

/** 'onward': a node with nothing to say that only goes on, asked past at the next step. */
export type PlayMode = 'over' | 'waiting' | 'line' | 'choose' | 'said' | 'asking' | 'onward';

/** What the game is to do now. */
export type PlayStep =
  /** Show line `index` of the node, its gesture and its shot. */
  | { k: 'line'; index: number }
  /** Show the answers. */
  | { k: 'choose' }
  /** Ask the host for the node that follows by itself. */
  | { k: 'next' }
  /** The conversation is over. */
  | { k: 'end' }
  /** Nothing came, or nothing could be said: the game's own greeting instead. */
  | { k: 'fallback'; why: string | null };

export class TalkPlay {
  mode: PlayMode = 'over';
  node: NodeView | null = null;
  /** The line standing, from 0. */
  line = -1;
  /** When the line or the player's answer stops standing (on the caller's clock). */
  until = 0;
  /** When a node was last asked for. */
  asked = 0;
  /** A node that came while the player's answer was still being said. */
  pending: NodeWord | null = null;
  /** The answer being said. */
  picked: ReplyView | null = null;
  /** Nodes in a row with nothing to say and no answer to offer. */
  quiet = 0;
  /** How long a line stands. */
  private readonly hold: (line: LineView) => number;

  constructor(hold: (line: LineView) => number) {
    this.hold = hold;
  }

  /** The window opens on somebody: waiting for their first node. */
  open(now: number): void {
    this.mode = 'waiting';
    this.node = null;
    this.line = -1;
    this.pending = null;
    this.picked = null;
    this.quiet = 0;
    this.asked = now;
  }

  close(): void {
    this.mode = 'over';
    this.node = null;
    this.pending = null;
    this.picked = null;
    this.quiet = 0;
  }

  get active(): boolean {
    return this.mode !== 'over';
  }

  /** A node from the host (or none, with why). */
  arrive(word: NodeWord, now: number): PlayStep | null {
    if (this.mode === 'over') return null;
    if (this.mode === 'said' && now < this.until) {
      this.pending = word;
      return null;
    }
    return this.take(word, now);
  }

  private take(word: NodeWord, now: number): PlayStep | null {
    this.pending = null;
    this.picked = null;
    if (!word.view) {
      const opening = this.node === null;
      this.mode = 'over';
      return opening ? { k: 'fallback', why: word.why } : { k: 'end' };
    }
    this.node = word.view;
    const n = word.view;
    if (n.lines.length || n.replies.length) this.quiet = 0;
    else if (++this.quiet > TALK_TREE_TUNE.quietMax) {
      this.mode = 'over';
      return { k: 'end' };
    }
    // Nothing to say and only going on: asked past at the next step, never inside the call that handed it over.
    if (!n.lines.length && !n.replies.length && n.next) {
      this.line = 0;
      this.mode = 'onward';
      return null;
    }
    return this.startLine(0, now);
  }

  /** Line `i` of the node, or what comes after its last. */
  private startLine(i: number, now: number): PlayStep {
    const n = this.node!;
    if (i < n.lines.length) {
      this.mode = 'line';
      this.line = i;
      this.until = now + this.hold(n.lines[i]);
      return { k: 'line', index: i };
    }
    this.line = n.lines.length;
    if (n.replies.length) {
      this.mode = 'choose';
      return { k: 'choose' };
    }
    if (n.next) {
      this.mode = 'asking';
      this.asked = now;
      return { k: 'next' };
    }
    this.mode = 'over';
    return { k: 'end' };
  }

  /** A click or a digit while a line stands, or the player's answer: on at once. */
  skip(now: number): PlayStep | null {
    if (this.mode === 'line') return this.startLine(this.line + 1, now);
    if (this.mode === 'said') {
      this.until = now;
      return this.step(now);
    }
    return null;
  }

  /** The player gives an answer, said aloud for `replyFor` (no time at all for a silent one) while the host answers it. */
  said(reply: ReplyView, now: number): void {
    this.mode = 'said';
    this.picked = reply;
    this.pending = null;
    this.asked = now;
    this.until = now + (reply.said === null ? 0 : TALK_TUNE.replyFor);
  }

  /** The clock moved on: a line or an answer that has stood its time, or a wait run out. */
  step(now: number): PlayStep | null {
    switch (this.mode) {
      case 'waiting':
        if (now - this.asked < TALK_TREE_TUNE.wait) return null;
        this.mode = 'over';
        return { k: 'fallback', why: null };
      case 'line':
        return now >= this.until ? this.startLine(this.line + 1, now) : null;
      case 'onward':
        return this.startLine(0, now);
      case 'said':
        if (now < this.until) return null;
        if (this.pending) return this.take(this.pending, now);
        this.mode = 'asking';
        return null;
      case 'asking':
        if (now - this.asked < TALK_TREE_TUNE.wait) return null;
        this.mode = 'over';
        return { k: 'end' };
      default:
        return null;
    }
  }

  /** What the console prints. */
  report(): Record<string, unknown> {
    return { mode: this.mode, tree: this.node?.tree ?? null, node: this.node?.node ?? null, line: this.line, lines: this.node?.lines.length ?? 0, replies: this.node?.replies.map((r) => `${r.id}${r.enabled ? '' : ' (greyed)'}`) ?? [], pending: !!this.pending, quiet: this.quiet };
  }
}
