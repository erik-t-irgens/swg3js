// What every host of a story answers to, so the game's detectors, the tracker, the conversation window and the
// console speak to one shape whoever holds the book: this browser alone (`localHost.ts`), or a server
// (`remoteHost.ts`). A document read to its end joins it with the wave that brings documents. Pure: types and
// nothing else.

import type { StoryEvent } from './quests.ts';
import type { NodeView } from './talkRules.ts';
import type { StoryView } from './view.ts';

/** What came of asking a host for something: done, or why not. */
export interface HostAnswer {
  ok: boolean;
  why?: string;
}

/**
 * A node a conversation reached, as a host hands it to the window: the browser's own at once, a server's when
 * it answers. No view is the conversation ended (or was never opened), with why when it was refused.
 */
export interface NodeWord {
  speaker: string;
  view: NodeView | null;
  why: string | null;
}

export interface StoryHost {
  /** Who it is, for the console: `local` for this browser's own. */
  readonly kind: string;
  /** Something the detectors saw. Dropped (and counted) while the host cannot take it. */
  event(ev: StoryEvent): HostAnswer;
  accept(quest: string): HostAnswer;
  decline(quest: string): HostAnswer;
  drop(quest: string): HostAnswer;
  restart(quest: string): HostAnswer;
  /** A job on the tracker, or off it. */
  track(quest: string, on: boolean): HostAnswer;
  /** What the interface is shown, or null while there is nothing to show (no book, no set, nobody holding it here). */
  view(): StoryView | null;
  /** Be told whenever the view has changed. Answers the way to stop being told. */
  onView(fn: (view: StoryView | null) => void): () => void;
  /** Whether this host can be asked to speak for somebody just now: false sends the window straight to the game's own greeting. */
  canTalk(speaker: string): boolean;
  /**
   * A conversation: open one with somebody, give an answer (`reply`; null lets a node that goes on by itself
   * go on), or close it. What it reaches comes back through `onNode`, at once from this browser's own host.
   */
  talk(op: 'open' | 'pick' | 'close', speaker: string, reply?: string | null): HostAnswer;
  /** Be told of every node a conversation reaches. Answers the way to stop being told. */
  onNode(fn: (node: NodeWord) => void): () => void;
}
