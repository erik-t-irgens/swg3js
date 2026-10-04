// What every host of a story answers to, so the game's detectors, the tracker and the console speak to
// one shape whoever holds the book: this browser alone (`localHost.ts`), or a server (a later wave's
// `remoteHost.ts`). A conversation's answers and a document read to its end join it with the waves that
// bring them. Pure: a type and nothing else.

import type { StoryEvent } from './quests.ts';
import type { StoryView } from './view.ts';

/** What came of asking a host for something: done, or why not. */
export interface HostAnswer {
  ok: boolean;
  why?: string;
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
}
