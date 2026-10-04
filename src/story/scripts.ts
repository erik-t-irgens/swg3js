// The named escape: `call(name, …)`, for the rare thing the vocabulary cannot say. A script is a generic
// function registered here by name, never story written in code: a condition reads what it is handed
// and answers true or false, and an action answers the vocabulary's own actions for the step machine to
// run, so a script can never reach past the rules. A name nothing registered, or a script that fails,
// reads false and does nothing, and is counted (`StoryResult.misses`) rather than thrown, so an importer
// that writes `call("bespoke:<method>")` for what it could not translate leaves a quest that is merely
// stuck rather than one that breaks the host. The checker counts every name it cannot find.
//
// Empty but for the test set's own functions, every one named `test.<something>`. Pure.

import type { ActionJson, Lit } from './expr.ts';

/** What a script may read: the flags and the shared clock. Nothing that would let it change anything. */
export interface ScriptLook {
  flag(name: string): number | string | undefined;
  now: number;
}

export interface StoryScript {
  /** As a condition: true or false. */
  cond?(args: readonly Lit[], look: ScriptLook): boolean;
  /** As an action: the vocabulary's own actions to run in its place. */
  act?(args: readonly Lit[], look: ScriptLook): ActionJson[];
}

const SCRIPTS: Record<string, StoryScript> = Object.create(null);

/** Register a script by name. A later registration of the same name replaces the earlier. */
export function registerScript(name: string, script: StoryScript): void {
  SCRIPTS[name] = script;
}

/** A script by name, or null. */
export function scriptOf(name: string): StoryScript | null {
  return SCRIPTS[name] ?? null;
}

/** Every name registered: what the checker counts a `call` against. */
export function scriptNames(): string[] {
  return Object.keys(SCRIPTS);
}

// ---- the test set's own -----------------------------------------------------------------------------

registerScript('test.always', { cond: () => true });
registerScript('test.never', { cond: () => false });
/** True when the flag named first holds the value named second. */
registerScript('test.flagIs', { cond: (args, look) => look.flag(String(args[0])) === args[1] });
/** Sets the flag named first to the value given second, through the vocabulary's own `flag`. */
registerScript('test.setFlag', { act: (args) => [{ act: 'flag', args: [String(args[0]), args[1] ?? 1] }] });
