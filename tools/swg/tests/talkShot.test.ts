// The camera of a story's conversation (src/world/talk.ts): shot and reverse shot, the side of the line kept,
// the least a shot is held, and every shot pulled in before whatever stands behind it -- the pure arithmetic
// the game runs, on places written in this file.
//
// What is pinned:
//
//   - the reverse shot stands behind the one spoken to, out to the same side of the line between the two as
//     the shot over the player's shoulder does, looking back at the player's face: the 180-degree rule;
//   - a close single, a two-shot and a wide shot stand where their numbers put them, on that same side;
//   - the side is the player's right unless something stands in the way there and the left has more room;
//   - a cut is instant, but one asked for before the shot standing has been held `hold` seconds waits; a
//     `hold` asks for no cut at all;
//   - a long line after another of the speaker's cuts in close, and a line stands for its words within its
//     least and most;
//   - every shot pulls in along the line from whoever it hangs off (`pullShot`, the function the game draws
//     with), and one pulled in past `cramped` of its reach is given up for the shot over the player's shoulder,
//     which is never given up and is not cut away from again.
//
// Synthetic throughout.
import assert from 'node:assert/strict';
import { SHOT_TUNE, TALK_TREE_TUNE, TALK_TUNE, askCut, autoLineShot, chooseSide, giveUpCramped, lineHold, newCut, newTalkShot, pullIn, pullShot, shotCramped, stepCut, talkShot, talkShotOf, tuneShots, tuneTalkTree } from '../../../src/world/talk.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
/** Which side of the line from the player to the other a point is on: +1 the player's right (the world's -x looking along +z), -1 the left. */
const sideOf = (px: number, pz: number, nx: number, nz: number, x: number, z: number): number => Math.sign((nx - px) * (z - pz) - (nz - pz) * (x - px));

// The player's eye at the origin, 1.5 m up; the one spoken to 2 m ahead along +z, their face at 1.7 m.
const P = [0, 1.5, 0] as const;
const N = [0, 1.7, 2] as const;

// ---- shot and reverse shot -----------------------------------------------------------------------------------
{
  const over = talkShotOf('over-player', 'right', ...P, ...N, newTalkShot());
  const old = talkShot(...P, ...N, newTalkShot());
  ok(near(over.cx, old.cx) && near(over.cz, old.cz) && near(over.reach, old.reach), 'the shot over the player\'s shoulder is the one the game always had');
  ok(over.ax === 0 && over.ay === 1.5 && over.az === 0 && over.lz === 2, 'it hangs off the player\'s eye and looks at the other\'s face');
  const rev = talkShotOf('over-npc', 'right', ...P, ...N, newTalkShot());
  ok(near(rev.cz, 2 + SHOT_TUNE.reverseBack) && near(rev.cy, 1.7 + SHOT_TUNE.reverseRaise) && rev.lx === 0 && rev.ly === 1.5 && rev.lz === 0, `the reverse shot stands ${SHOT_TUNE.reverseBack} m behind the one spoken to, a touch above their face, looking back at the player's eye`);
  ok(rev.ax === 0 && rev.ay === 1.7 && rev.az === 2 && near(rev.reach, Math.hypot(SHOT_TUNE.reverseBack, SHOT_TUNE.reverseShoulder, SHOT_TUNE.reverseRaise)), 'and hangs off their face, which is what it is pulled in from');
  ok(sideOf(0, 0, 0, 2, over.cx, over.cz) === 1 && sideOf(0, 0, 0, 2, rev.cx, rev.cz) === 1, 'both stand on the player\'s right of the line between the two, which from the other\'s place is their left shoulder: the 180-degree rule');
  const left = talkShotOf('over-npc', 'left', ...P, ...N, newTalkShot());
  ok(sideOf(0, 0, 0, 2, left.cx, left.cz) === -1 && near(left.cx, -rev.cx), 'kept to the left, both stand on the other side, mirrored');
  // Turned through the world, the shots turn with the line.
  const turned = talkShotOf('over-npc', 'right', 5, 1.5, 5, 7, 1.7, 5, newTalkShot());
  ok(sideOf(5, 5, 7, 5, turned.cx, turned.cz) === 1 && near(turned.cx, 7 + SHOT_TUNE.reverseBack), 'facing along +x, the reverse shot still stands behind the other and to the same side');
}

// ---- the other shots ---------------------------------------------------------------------------------------------
{
  const close = talkShotOf('close-npc', 'right', ...P, ...N, newTalkShot());
  ok(near(close.cz, 2 - SHOT_TUNE.closeBack) && near(close.lz, 2) && near(close.reach, Math.hypot(SHOT_TUNE.closeBack, SHOT_TUNE.closeBack * SHOT_TUNE.closeSide, SHOT_TUNE.closeRaise)) && sideOf(0, 0, 0, 2, close.cx, close.cz) === 1, `a close single stands ${SHOT_TUNE.closeBack} m in front of the face, a little to the side`);
  const me = talkShotOf('close-player', 'right', ...P, ...N, newTalkShot());
  ok(near(me.cz, SHOT_TUNE.closeBack) && me.lz === 0 && me.ly === 1.5, 'and one on the player looks back at the player from the other\'s side');
  const two = talkShotOf('two', 'right', ...P, ...N, newTalkShot());
  ok(near(two.lz, 1) && near(two.ly, 1.6) && near(Math.abs(two.cx), SHOT_TUNE.twoSide) && near(two.cz, 1 - SHOT_TUNE.twoBack) && sideOf(0, 0, 0, 2, two.cx, two.cz) === 1, `the two-shot stands ${SHOT_TUNE.twoSide} m out to the side of the middle of the two, looking at it`);
  const wide = talkShotOf('wide', 'right', ...P, ...N, newTalkShot());
  ok(near(wide.cz, -SHOT_TUNE.wideBack) && near(wide.cy, 1.5 + SHOT_TUNE.wideRaise) && near(wide.lz, 1), `the wide shot stands ${SHOT_TUNE.wideBack} m back and ${SHOT_TUNE.wideRaise} m up, looking between them`);
  const hold = talkShotOf('hold', 'right', ...P, ...N, newTalkShot());
  ok(near(hold.cx, talkShot(...P, ...N, newTalkShot()).cx), 'asked to place `hold` itself, it stands over the shoulder');
  const on = talkShotOf('over-npc', 'right', 1, 1.5, 1, 1, 1.7, 1, newTalkShot());
  ok(Number.isFinite(on.cx) && Number.isFinite(on.cz), 'two bodies on top of each other take +z for the line rather than dividing by nought');
  const kept = newTalkShot();
  ok(talkShotOf('two', 'left', ...P, ...N, kept) === kept, 'and nothing is made: the shot handed in is written');
}

// ---- the side ---------------------------------------------------------------------------------------------------------
{
  const reach = 1.6;
  ok(chooseSide(reach, reach, 0.3) === 'right', 'the right shoulder first, when nothing stands in its way');
  ok(chooseSide(reach, 0.6, 1.6) === 'left', 'the left when the right is walled in and the left has more room');
  ok(chooseSide(reach, 0.6, 0.5) === 'right', 'and still the right when the left has less');
}

// ---- cuts: instant, held, and never for `hold` ---------------------------------------------------------------------------
{
  const cut = newCut('over-player', 'right');
  askCut(cut, 'over-npc', 'right');
  ok(!stepCut(cut, 0.5) && cut.kind === 'over-player', 'a cut asked for before the shot has stood its time waits');
  ok(stepCut(cut, SHOT_TUNE.hold) && cut.kind === 'over-npc' && cut.held === 0 && cut.cuts === 1, `once it has stood ${SHOT_TUNE.hold} s it is made at once`);
  askCut(cut, 'hold', 'left');
  ok(!stepCut(cut, 10) && cut.kind === 'over-npc' && cut.side === 'right', '`hold` asks for no cut, and changes no side');
  askCut(cut, 'over-npc', 'right');
  ok(!stepCut(cut, 10) && cut.cuts === 1, 'asking for the shot standing is no cut');
  askCut(cut, 'close-npc', 'right');
  askCut(cut, 'over-player', 'right');
  ok(stepCut(cut, 0.01) && cut.kind === 'over-player', 'the last shot asked for is the one cut to');
  const was = SHOT_TUNE.hold;
  tuneShots({ hold: 0 });
  askCut(cut, 'wide', 'right');
  ok(stepCut(cut, 0) && cut.kind === 'wide', 'with no hold a cut is made the frame it is asked for');
  tuneShots({ hold: was, reverseBack: -2 });
  ok(SHOT_TUNE.reverseBack === 0, 'a length is never below nought');
  tuneShots({ reverseBack: 1.5 });
}

// ---- which shot a line gets, and how long it stands ----------------------------------------------------------------------------
{
  ok(autoLineShot(0, 40) === 'over-player' && autoLineShot(1, SHOT_TUNE.closeWords) === 'close-npc' && autoLineShot(1, SHOT_TUNE.closeWords - 1) === 'over-player', `a line of ${SHOT_TUNE.closeWords} words or more after another of the speaker's cuts in close; the first line of a node, or a shorter one, is over the shoulder`);
  ok(lineHold(1) === TALK_TREE_TUNE.lineMin && near(lineHold(10), 10 * TALK_TREE_TUNE.perWord) && lineHold(1000) === TALK_TREE_TUNE.lineMax && near(lineHold(10, 2), 10 * TALK_TREE_TUNE.perWord + 2), `a line stands for its words, at least ${TALK_TREE_TUNE.lineMin} s and at most ${TALK_TREE_TUNE.lineMax} s, and its own wait after`);
  const was = { ...TALK_TREE_TUNE };
  tuneTalkTree({ lineMin: 3, greetAtOpen: false, wait: Number.NaN });
  ok(TALK_TREE_TUNE.lineMin === 3 && TALK_TREE_TUNE.greetAtOpen === false && TALK_TREE_TUNE.wait === was.wait, 'the numbers and the switch move live, and a value that is not a number is left alone');
  Object.assign(TALK_TREE_TUNE, was);
}

// ---- pulled in when blocked ------------------------------------------------------------------------------------------------------
{
  const rev = talkShotOf('over-npc', 'right', ...P, ...N, newTalkShot());
  const wall = 0.9;
  const allowed = pullIn(rev.reach, wall);
  ok(near(allowed, wall - TALK_TUNE.pad) && allowed < rev.reach, `a wall ${wall} m behind the one spoken to brings the reverse shot in short of it`);
  // The shot pulled in along the line from its anchor, by the very function the game draws it with.
  const was = { cx: rev.cx, cy: rev.cy, cz: rev.cz, reach: rev.reach };
  const pulled = pullShot(rev, allowed);
  ok(pulled === rev && near(Math.hypot(rev.cx - rev.ax, rev.cy - rev.ay, rev.cz - rev.az), allowed) && near(rev.reach, allowed) && sideOf(0, 0, 0, 2, rev.cx, rev.cz) === 1, 'pulled in along the line from their face, still on the same side, written in place');
  ok(near((rev.cx - rev.ax) * was.reach, (was.cx - rev.ax) * allowed) && near((rev.cz - rev.az) * was.reach, (was.cz - rev.az) * allowed) && rev.lx === 0 && rev.lz === 0, 'in the very direction it stood, from its own anchor rather than the player\'s eye, still looking where it looked');
  const far = talkShotOf('over-npc', 'right', ...P, ...N, newTalkShot());
  const cx = far.cx;
  ok(pullShot(far, far.reach + 1).cx === cx && pullShot(far, far.reach).cx === cx, 'a shot already within what is allowed is left where it stands');
  ok(pullIn(was.reach, null) === was.reach && pullIn(was.reach, 0.05) === Math.min(TALK_TUNE.nearest, was.reach), 'with nothing in the way it stands where it asked, and never nearer than the camera\'s floor');
}

// ---- too cramped to stand: given up for the shot over the player's shoulder ---------------------------------------
{
  const rev = talkShotOf('over-npc', 'right', ...P, ...N, newTalkShot());
  const room = (wall: number) => pullIn(rev.reach, wall);
  ok(!shotCramped('over-npc', rev.reach, room(5)) && !shotCramped('over-npc', rev.reach, rev.reach * SHOT_TUNE.cramped), `a reverse shot with room behind the one spoken to stands, down to ${SHOT_TUNE.cramped} of its reach`);
  ok(shotCramped('over-npc', rev.reach, room(0.5)) && shotCramped('close-npc', 1, 0.4) && shotCramped('two', 2, 0.5), 'one pulled in further than that -- a wall at their back -- is too cramped, and so is any shot but the one over the player\'s shoulder');
  ok(!shotCramped('over-player', rev.reach, room(0.05)) && !shotCramped('hold', 1, 0), 'the shot over the player\'s shoulder is never given up: it is the one the others give way to');
  const cut = newCut('over-player', 'left');
  askCut(cut, 'over-npc', 'left');
  stepCut(cut, SHOT_TUNE.hold);
  giveUpCramped(cut);
  ok(cut.kind === 'over-player' && cut.side === 'left' && cut.want === 'over-player' && cut.wantSide === 'left' && cut.cramped === 1, 'given up, the cut stands over the player\'s shoulder on the same side, and asks for nothing else');
  ok(!stepCut(cut, 10) && cut.kind === 'over-player', 'so it does not cut back to the cramped shot once it has been held');
}

console.log(`\n${checks} checks passed`);
