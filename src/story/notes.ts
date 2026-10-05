// What the message line says about a story: plain words of ours, made from the facts the step machine
// hands over (`StoryNote`) and the set they belong to. Pure: the browser's host says them, and a server's
// host can send the very same words, so a job is announced one way whoever holds it.
//
// The lines are the design's: "Job: <title>", "Objective: <line>", "Done: <title>", "Failed: <title>
// (<why>)", "Reached <waypoint>", "Paid <n> credits", "Experience <n> recorded (it counts for nothing
// yet)". The rest are ours and in the same voice ("Spent <n> credits" for a price a conversation charged,
// "To read: <title>" for a document handed over, "A call from <who>" for a call, "Journal: <title>" for a
// new entry in the journal). Standing says which way it moved and never by how much, since Standing is shown
// as a bar with its numbers hidden; Trust and the ISB's file are never said at all. A rank changing is said in
// words ("Rebellion: promoted to Courier", "Empire: suspended", "Freelance: you are burned"), a fine with what
// it took and what is owed, and the companion joining, waiting, going or coming back by the name the player
// knows them by. A named person's own Standing and Trust, a refusal, a vouching and a death are never said:
// the player learns them from the people themselves, and a death from the page that tells it.

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
 * A note as a server sends it to a browser that holds no set: an objective's own words and whether it was a
 * place to reach go with it, so the browser says it exactly as its own host would have. Any other note is
 * sent as it is; its words are made in the browser, the one side that can read the client's own strings.
 */
export function noteForWire(note: StoryNote, lib: StorySet): StoryNote & { line?: TextRef; goto?: boolean } {
  if (note.k !== 'objective' && note.k !== 'objectiveDone') return note;
  const step = lib.quests[note.quest]?.steps[note.step];
  return step ? { ...note, line: stepText(step, lib), ...(step.type === 'goto' ? { goto: true } : {}) } : note;
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
      // A server's note carries the objective's own words and whether it was a place to reach, since the
      // browser it is sent to holds no set; this browser's own host looks the step up in the set it reads.
      const sent = note as StoryNote & { line?: TextRef; goto?: boolean };
      const step = sent.line ? null : lib.quests[note.quest]?.steps[note.step];
      if (!sent.line && !step) return null;
      const line = deps.text(sent.line ?? stepText(step!, lib));
      if (note.k === 'objective') return `Objective: ${line}`;
      // A place reached is the one an objective of going somewhere is done by.
      return (sent.line ? sent.goto === true : step!.type === 'goto') ? `Reached ${line}` : `Objective done: ${line}`;
    }
    case 'paid':
      return given ? `Paid ${note.credits.toLocaleString('en-GB')} credits` : `${note.credits.toLocaleString('en-GB')} credits could not be paid`;
    case 'charged':
      return given ? `Spent ${note.credits.toLocaleString('en-GB')} credits` : `${note.credits.toLocaleString('en-GB')} credits could not be spent`;
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
    case 'doc':
      // Pointed to, never opened: the journal (J) is where it is read.
      return note.from ? `A call from ${note.fromName ? deps.text(note.fromName) : 'someone'}: ${deps.text(note.title)}` : `To read: ${deps.text(note.title)}`;
    case 'journal':
      return `Journal: ${deps.text(note.title)}`;
    case 'rank':
      return rankWords(note);
    case 'fined': {
      // A host whose purse refused the fine's charge owes it instead and says so (`credits` nought, `owed` the
      // whole); `given` false is a fine that could be neither taken nor owed, which says it was not taken.
      const reason = deps.text(note.reason);
      const took = note.credits > 0 && given ? `Fined ${note.credits.toLocaleString('en-GB')} credits` : 'Fined';
      const lost = note.credits > 0 && !given ? `; ${note.credits.toLocaleString('en-GB')} credits could not be taken` : '';
      const owed = note.owed > 0 ? `; ${note.owed.toLocaleString('en-GB')} credits owed to ${idWords(note.to)}` : '';
      return `${took}${reason ? `: ${reason}` : ''}${lost}${owed}`;
    }
    case 'companion': {
      const name = deps.text(note.name);
      switch (note.what) {
        case 'joined':
          return `${name} is with you`;
        case 'waits':
          return `${name} waits here for you`;
        case 'released':
          return `${name} goes their own way`;
        default:
          return `${name} is with you again`;
      }
    }
  }
}

/** A rank's change in words: the track, then what happened to the character on it. Never a number. */
export function rankWords(note: Extract<StoryNote, { k: 'rank' }>): string {
  const t = TRACK_WORDS[note.track] ?? note.track;
  switch (note.what) {
    case 'promoted':
      return note.rank ? `${t}: promoted to ${note.rank}` : `${t}: promoted`;
    case 'demoted':
      return note.rank ? `${t}: demoted to ${note.rank}` : `${t}: your rank is taken from you`;
    case 'suspended':
      return `${t}: suspended`;
    case 'reinstated':
      return `${t}: your suspension is over`;
    case 'burned':
      return `${t}: you are burned`;
    case 'assigned':
      return `${t}: assigned to ${(note.division ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
    case 'used':
      return `${t}: they have a use for you`;
    default:
      return `${t}: taken on`;
  }
}
