// What the message line says about a story: plain words of ours, made from the facts the step machine
// hands over (`StoryNote`) and the set they belong to. Pure: the browser's host says them, and a server's
// host can send the very same words, so a job is announced one way whoever holds it.
//
// The lines are the design's: "Job: <title>", "Objective: <line>", "Done: <title>", "Failed: <title>
// (<why>)", "Reached <waypoint>", "Paid <n> credits", "Experience <n> recorded (it counts for nothing
// yet)". The rest are ours and in the same voice. Standing says which way it moved and never by how
// much, since Standing is shown as a bar with its numbers hidden; Trust is never said at all.

import type { StoryNote } from './quests.ts';
import type { StorySet } from './set.ts';
import type { TextRef } from './text.ts';
import { stepText } from './view.ts';

export interface NoteWordsDeps {
  /** The words a text stands for: a literal as it is, a client string looked up, `[…]` when nothing answers. */
  text(ref: TextRef): string;
  /** A thing's own name, where the host knows it; its id with the underscores taken out otherwise. */
  itemName?(kind: 'wear' | 'weapon', id: string): string;
}

const TRACK_WORDS: Readonly<Record<string, string>> = Object.freeze({ rebellion: 'Rebellion', empire: 'Empire', freelance: 'Freelance' });

/** An outcome's name as words: `late` stays `late`, `walked_out` reads `walked out`. */
export function outcomeWords(outcome: string): string {
  return outcome.replace(/[_.-]+/g, ' ').trim();
}

/** A thing's id as words, for a host that has no name for it. */
export function idWords(id: string): string {
  return id.replace(/[_./-]+/g, ' ').trim();
}

/**
 * The line one note is said as, or null for one that says nothing. `given` is false for a thing the
 * host could not hand over (it was owned already, and a character holds one of each kind) or credits it
 * could not pay (nobody in play to pay them to): the line says so rather than claiming they arrived.
 */
export function noteWords(note: StoryNote, lib: StorySet, deps: NoteWordsDeps, given = true): string | null {
  switch (note.k) {
    case 'job':
      return `Job: ${deps.text(note.title)}`;
    case 'offered':
      return `Offered: ${deps.text(note.title)}`;
    case 'restarted':
      return `Started over: ${deps.text(note.title)}`;
    case 'dropped':
      return `Dropped: ${deps.text(note.title)}`;
    case 'done':
      return note.outcome === 'done' ? `Done: ${deps.text(note.title)}` : `Done: ${deps.text(note.title)} (${outcomeWords(note.outcome)})`;
    case 'failed':
      return note.outcome === 'failed' ? `Failed: ${deps.text(note.title)}` : `Failed: ${deps.text(note.title)} (${outcomeWords(note.outcome)})`;
    case 'stalled':
      return `Held: ${deps.text(note.title)} (${note.why})`;
    case 'objective':
    case 'objectiveDone': {
      const step = lib.quests[note.quest]?.steps[note.step];
      if (!step) return null;
      const line = deps.text(stepText(step, lib));
      if (note.k === 'objective') return `Objective: ${line}`;
      // A place reached is the one an objective of going somewhere is done by.
      return step.type === 'goto' ? `Reached ${line}` : `Objective done: ${line}`;
    }
    case 'paid':
      return given ? `Paid ${note.credits.toLocaleString('en-GB')} credits` : `${note.credits.toLocaleString('en-GB')} credits could not be paid`;
    case 'item': {
      const name = deps.itemName ? deps.itemName(note.kind, note.id) : idWords(note.id);
      if (!given) return `${name}: owned already, so nothing more was given`;
      return note.n > 1 ? `Received ${name} ×${note.n}` : `Received ${name}`;
    }
    case 'xp':
      return `Experience ${note.n.toLocaleString('en-GB')} recorded (it counts for nothing yet)`;
    case 'standing':
      return note.n === 0 ? null : `${TRACK_WORDS[note.track] ?? note.track} standing ${note.n > 0 ? 'rose' : 'fell'}`;
    case 'say':
      return deps.text(note.text);
  }
}
