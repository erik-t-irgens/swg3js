// The world editor's keys (DESIGN.md §2.14): every default of the editor's own lands on a key no other action holds, or
// one the editor mutes while it is on, or one it reads in that action's own sense; every editor action is the dev
// server's (`DEV_ONLY_ACTIONS`) and the Controls page of a release lists none; no editor default holds Ctrl (W held
// with Ctrl closes the tab); while Ctrl is held every action is muted; with the old tabs' hand holding something the
// attack is left for its click; and the next wave's Shift rule (with R it tips only while no move key is held). That the
// editor's key block really applies these lists is pinned as text in `editorWiring.test.ts`.
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS, DEV_ONLY_ACTIONS, controlsActions, type Action } from '../../../src/core/input.ts';
import { ALL_ACTIONS, EDITOR_ACTIONS, EDITOR_MUTES, EDITOR_READS, ctrlRule, editorDefaultCodes, editorMutes, shiftTips } from '../../../src/editor/editorKeys.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const holders = (code: string): Action[] => (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => DEFAULT_BINDINGS[a].includes(code));

{
  const bad: string[] = [];
  for (const a of EDITOR_ACTIONS) {
    for (const code of DEFAULT_BINDINGS[a]) {
      for (const other of holders(code)) {
        if (other === a || EDITOR_ACTIONS.includes(other)) continue;
        if (!EDITOR_MUTES.includes(other) && !EDITOR_READS.includes(other)) bad.push(`${a} on ${code} shares it with ${other}`);
      }
    }
  }
  ok(bad.length === 0, `every editor default is free, muted while the editor is on, or read in its own sense${bad.length ? `: ${bad.join('; ')}` : ''}`);
  ok(EDITOR_ACTIONS.every((a) => DEV_ONLY_ACTIONS.has(a)), "every editor action is the dev server's");
  ok(EDITOR_ACTIONS.every((a) => !controlsActions(false).includes(a)), "and a release's Controls page lists none of them");
  ok(EDITOR_ACTIONS.every((a) => controlsActions(true).includes(a)), "the dev server's lists every one");
  ok(!editorDefaultCodes().some((c) => c === 'ControlLeft' || c === 'ControlRight'), 'no editor default holds Ctrl');
  ok(EDITOR_MUTES.length === 43, `the editor mutes 43 actions (${EDITOR_MUTES.length})`);
  ok(EDITOR_MUTES.every((a) => Object.hasOwn(DEFAULT_BINDINGS, a)) && EDITOR_READS.every((a) => Object.hasOwn(DEFAULT_BINDINGS, a)), 'every action it mutes or reads is one the game has');
  ok(!EDITOR_MUTES.some((a) => ['map', 'inventory', 'waypoints', 'journal', 'group', 'debugMenu', 'fastForward', 'forward', 'back', 'left', 'right', 'walk', 'placeTurn', 'placeLift', 'takeProp', 'putAway', 'placeLayer'].includes(a)), 'the panels, the day\'s fast-forward, the move keys and the hand\'s own keys are kept');
}

{
  ok(ctrlRule(true) === ALL_ACTIONS && ALL_ACTIONS.length === Object.keys(DEFAULT_BINDINGS).length, 'while Ctrl is held every action is muted for the frame');
  ok(ctrlRule(false).length === 0, 'and none with it up');
  ok(editorMutes(false) === EDITOR_MUTES && editorMutes(false).includes('attack'), "with the old tabs' hand empty the editor mutes all 43, the attack among them (it read the click first)");
  const handHeld = editorMutes(true);
  ok(!handHeld.includes('attack') && handHeld.length === EDITOR_MUTES.length - 1 && handHeld.every((a) => EDITOR_MUTES.includes(a)), "with the old tabs' hand holding something the attack is left for its click to put the thing down, and nothing else changes");
  // The next wave's rule (W2, the hand's turn): kept here so it is held from the day it is written; nothing reads it yet.
  ok(shiftTips(true, false), "W2's rule: Shift with R tips while no move key is held");
  ok(!shiftTips(true, true), "W2's rule: with a move key held Shift is the fast flight and R turns");
  ok(!shiftTips(false, false), "W2's rule: without Shift, R turns");
}

console.log(`\n${checks} checks passed`);
