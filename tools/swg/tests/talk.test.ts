// Speaking to somebody (src/world/talk.ts): who may be spoken to, who the use key picks, what they say,
// what may be answered, and where the camera stands while they are listened to -- the pure half the game
// runs, driven with bodies and places written in this file.
//
// Synthetic throughout: nothing here comes from the game's archives, and every line of speech it checks
// is the module's own.
import assert from 'node:assert/strict';
import { GREET_CLIPS, TALK_LINES, TALK_TUNE, TALK_WORDS, easeShare, greetingOf, lineOf, newTalkShot, pickOption, pullIn, reachOf, stepBlend, talkOptions, talkShot, tuneTalk, whyNotTalk, type TalkBody } from '../../../src/world/talk.ts';
import { hostileSides, type Fighter } from '../../../src/combat/targets.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** The player as the rules see them: the matrix every body fights by reads them as this. */
const PLAYER: Fighter = { side: 'player', aggression: 'aggressive' };

/** A person who may be spoken to, with anything a case changes laid over it. */
const body = (over: Partial<TalkBody> = {}): TalkBody => ({ humanoid: true, dead: false, removed: false, ready: true, isDriven: false, npcId: '', fixture: false, engaged: false, side: 'civilian', aggression: 'defensive', ...over });

// --- who may be spoken to ----------------------------------------------------------------------------

{
  ok(whyNotTalk(body(), PLAYER) === null, 'a townsperson minding their own business may be spoken to');
  ok(whyNotTalk(body({ side: 'imperial', aggression: 'defensive' }), PLAYER) === null, "a town's guard who waits to be struck first may be spoken to too");
  ok(whyNotTalk(body({ side: 'neutral', aggression: 'passive' }), PLAYER) === null, 'and so may somebody who never fights at all');
  ok(whyNotTalk(body({ humanoid: false }), PLAYER) === 'not somebody to talk to', 'a creature, a droid or a hologram is not somebody to talk to');
  ok(whyNotTalk(body({ dead: true }), PLAYER) === 'gone' && whyNotTalk(body({ removed: true }), PLAYER) === 'gone', 'the dead and the taken away are gone');
  ok(whyNotTalk(body({ ready: false }), PLAYER) === 'not here yet', 'a body whose model is still coming is nobody yet');
  ok(whyNotTalk(body({ isDriven: true }), PLAYER) !== null && whyNotTalk(body({ npcId: 'npc:7' }), PLAYER) !== null, 'a body the server shares is everybody\'s, and a follower is this browser\'s alone');
  ok(whyNotTalk(body({ fixture: true }), PLAYER) === 'at its post', "a fixture the world cannot work without is at its post (the collector's use key is the shuttle's)");
  ok(whyNotTalk(body({ engaged: true }), PLAYER) === 'in a fight', 'somebody in a fight, or holding a grudge from one, has no time to talk');
  // Hostile is two things: the side, whatever the temper, and a temper that would pick on the player.
  ok(whyNotTalk(body({ side: 'hostile', aggression: 'defensive' }), PLAYER) === 'hostile', 'a bandit waiting to be struck first is still a bandit');
  ok(whyNotTalk(body({ side: 'imperial', aggression: 'aggressive' }), PLAYER) === 'hostile', 'an Imperial who would open fire on the player is hostile');
  ok(whyNotTalk(body({ side: 'rebel', aggression: 'aggressive' }), PLAYER) === null && !hostileSides({ side: 'rebel', aggression: 'aggressive' }, PLAYER), 'while an aggressive rebel leaves the player alone, so the matrix says they may be spoken to');
  // A fighter stood from the console is on the side that fights every person, which is the rule and not
  // a list: no fighter can ever be spoken to.
  ok(whyNotTalk(body({ side: 'fighter', aggression: 'aggressive' }), PLAYER) === 'hostile', 'a fighter from the console fights every person, and is hostile');
  // A follower is on the player's own side and answers blows: it may be spoken to, to be asked to stop.
  ok(whyNotTalk(body({ side: 'player', aggression: 'defensive' }), PLAYER) === null, 'somebody following the player may be spoken to');
  // The order the reasons are said in: what a thing is before anything else about it.
  ok(whyNotTalk(body({ humanoid: false, side: 'hostile', dead: true }), PLAYER) === 'not somebody to talk to', 'a dead creature is first of all not somebody');
}

// --- who the use key picks ---------------------------------------------------------------------------

{
  // The view looks along +z across the ground.
  const fx = 0;
  const fz = 1;
  ok(near(reachOf(0, 0, 2, fx, fz), 2), 'two metres straight ahead is in reach, at two metres');
  ok(Number.isNaN(reachOf(0, 0, TALK_TUNE.reach + 0.1, fx, fz)), `past ${TALK_TUNE.reach} m nobody is`);
  ok(Number.isNaN(reachOf(0, TALK_TUNE.rise + 0.1, 1, fx, fz)), `nor anybody more than ${TALK_TUNE.rise} m above or below`);
  ok(Number.isNaN(reachOf(2, 0, 0, fx, fz)), 'nor somebody off to the side of the view');
  ok(Number.isNaN(reachOf(0, 0, -2, fx, fz)), 'nor somebody behind');
  ok(near(reachOf(0, 0, -1, fx, fz), 1), `but within ${TALK_TUNE.near} m anybody is, whichever way the view points: somebody on your toes is in reach`);
  // The edge of the look: the cosine off the view's forward.
  const a = Math.acos(TALK_TUNE.cone);
  ok(!Number.isNaN(reachOf(Math.sin(a - 0.01) * 2.5, 0, Math.cos(a - 0.01) * 2.5, fx, fz)) && Number.isNaN(reachOf(Math.sin(a + 0.01) * 2.5, 0, Math.cos(a + 0.01) * 2.5, fx, fz)), `and the view's edge is ${((a * 180) / Math.PI).toFixed(0)} degrees either side of its middle`);
  ok(Number.isNaN(reachOf(Number.NaN, 0, 1, fx, fz)), 'a place that is not a number is in reach of nothing');
}

// --- what may be answered ------------------------------------------------------------------------------

{
  const options = talkOptions(false, false);
  ok(options.length === 2 && options[0].label === TALK_WORDS.follow && options[1].label === TALK_WORDS.leave, `two answers, the owner's own: "${options[0].label}" and "${options[1].label}"`);
  ok(options[0].id === 'follow' && options[1].id === 'leave' && options.every((o) => o.enabled), 'both may be chosen');
  const follower = talkOptions(true, true);
  ok(follower[0].id === 'stay' && follower[0].label === TALK_WORDS.stay && follower[0].enabled, `to somebody following you the first is "${follower[0].label}", whatever the count`);
  const full = talkOptions(false, true);
  ok(!full[0].enabled && full[0].why === TALK_WORDS.full && full[1].enabled, 'with as many following as may, "follow me" is refused in words and the way out stays open');
  // The number keys: 1 is the first, a refused one does nothing, one past the list is nothing.
  ok(pickOption(options, 1)?.id === 'follow' && pickOption(options, 2)?.id === 'leave', 'the number keys pick the answers in order, from 1');
  ok(pickOption(full, 1) === null && pickOption(full, 2)?.id === 'leave', 'a refused answer picked by its number is no answer');
  ok(pickOption(options, 0) === null && pickOption(options, 3) === null && pickOption(options, 1.5) === null, 'and a number off the list is nothing');
  // Written into a kept list when one is handed in, which is what a frame's window reuses.
  const kept: ReturnType<typeof talkOptions> = [];
  const back = talkOptions(false, false, kept);
  ok(back === kept && kept.length === 2 && talkOptions(true, false, kept) === kept && kept[0].id === 'stay', 'the answers are written into the list handed in, emptied first');
}

// --- what they say ------------------------------------------------------------------------------------

{
  ok(lineOf(TALK_LINES.hello, 42) === lineOf(TALK_LINES.hello, 42), 'the same body says the same thing every time it is spoken to');
  const said = new Set<string>();
  for (let k = 2; k < 200; k++) said.add(lineOf(TALK_LINES.hello, k));
  ok(said.size === TALK_LINES.hello.length, `and the crowd between them says every one of the ${TALK_LINES.hello.length} lines`);
  ok(TALK_LINES.guard.includes(greetingOf('imperial', false, 9)) && TALK_LINES.guard.includes(greetingOf('rebel', false, 9)), "a side that keeps order speaks as a guard");
  ok(TALK_LINES.hello.includes(greetingOf('civilian', false, 9)) && TALK_LINES.hello.includes(greetingOf('neutral', false, 9)), 'anybody else as a stranger');
  ok(TALK_LINES.follower.includes(greetingOf('player', true, 9)), 'and somebody following you as one who is');
  ok(lineOf([], 3) === '', 'a list with nothing in it says nothing');
  ok(GREET_CLIPS.length > 0 && GREET_CLIPS.every((c) => /^emt_/.test(c)), "the greeting is one of the game's own emotes, played where the body has it");
}

// --- where the camera stands -------------------------------------------------------------------------

{
  // The player's eye at the origin, 1.5 m up; the one spoken to 2 m ahead along +z, their face at 1.7 m.
  const shot = talkShot(0, 1.5, 0, 0, 1.7, 2, newTalkShot());
  ok(near(shot.cz, -TALK_TUNE.back) && near(shot.cy, 1.5 + TALK_TUNE.raise), `the camera stands ${TALK_TUNE.back} m behind the player's eye and ${TALK_TUNE.raise} m above it`);
  // A camera looking along +z has the world's -x on its right.
  ok(near(shot.cx, -TALK_TUNE.shoulder), `and ${TALK_TUNE.shoulder} m to the player's right, which for a camera looking along +z is the world's -x`);
  ok(shot.lx === 0 && shot.ly === 1.7 && shot.lz === 2, 'looking at the face of the one spoken to');
  ok(near(shot.reach, Math.hypot(TALK_TUNE.back, TALK_TUNE.shoulder, TALK_TUNE.raise)), 'and knows how far it stands from the eye, which is what the block test pulls in along');
  // Turned the other way, the shot turns with the line between the two.
  const back = talkShot(0, 1.5, 0, 0, 1.7, -2, newTalkShot());
  ok(near(back.cz, TALK_TUNE.back) && near(back.cx, TALK_TUNE.shoulder), 'facing the other way, it stands behind and to the right again, on the other side of the world');
  const on = talkShot(1, 1.5, 1, 1, 1.7, 1, newTalkShot());
  ok(Number.isFinite(on.cx) && Number.isFinite(on.cz) && near(on.cz, 1 - TALK_TUNE.back), 'two bodies on top of each other take +z for the line rather than dividing by nought');
  // Nothing is made: the shot handed in is the one written.
  const kept = newTalkShot();
  ok(talkShot(0, 0, 0, 3, 0, 4, kept) === kept, 'the shot is written into the one handed in');
}

{
  // The camera's own block rule, with the conversation's numbers.
  const reach = 1.6;
  ok(pullIn(reach, null) === reach, 'nothing in the way: the camera stands where it asked to');
  ok(pullIn(reach, reach + TALK_TUNE.pad + 0.5) === reach, 'something past where it stands is no matter');
  ok(near(pullIn(reach, 1.0), 1.0 - TALK_TUNE.pad), `a wall one metre behind: it stops ${TALK_TUNE.pad} m short of the wall`);
  ok(near(pullIn(reach, 0.2), TALK_TUNE.nearest), `a wall on the player's back: never nearer the eye than ${TALK_TUNE.nearest} m`);
  ok(near(pullIn(0.3, 0.1), 0.3), 'and never farther out than it asked to be, even at that floor');
}

{
  // The ease: in over `easeIn` seconds, back over `easeOut`, and smooth at both ends.
  let b = 0;
  let frames = 0;
  while (b < 1 && frames < 1000) {
    b = stepBlend(b, 1, 1 / 60);
    frames++;
  }
  ok(Math.abs(frames / 60 - TALK_TUNE.easeIn) <= 1 / 60 + 1e-9, `the view comes over the shoulder in ${TALK_TUNE.easeIn} s (${frames} frames at 60 a second)`);
  frames = 0;
  while (b > 0 && frames < 1000) {
    b = stepBlend(b, 0, 1 / 60);
    frames++;
  }
  ok(Math.abs(frames / 60 - TALK_TUNE.easeOut) <= 1 / 60 + 1e-9, `and goes back in ${TALK_TUNE.easeOut} s`);
  ok(stepBlend(0.4, 1, 10) === 1 && stepBlend(0.4, 0, 10) === 0, 'a long step lands on the end and never past it');
  ok(easeShare(0) === 0 && easeShare(1) === 1 && near(easeShare(0.5), 0.5) && easeShare(0.1) < 0.1 && easeShare(-2) === 0 && easeShare(3) === 1, 'the picture is drawn at a share smooth at both ends');
  const was = TALK_TUNE.easeIn;
  tuneTalk({ easeIn: 0 });
  ok(stepBlend(0, 1, 0.001) === 1, 'an ease of nought is there at once');
  tuneTalk({ easeIn: was });
}

// --- the knob ----------------------------------------------------------------------------------------

{
  const was = { ...TALK_TUNE };
  tuneTalk({ reach: 5, greet: false, cone: Number.NaN, back: -3, nosuch: 4 } as never);
  ok(TALK_TUNE.reach === 5 && TALK_TUNE.greet === false, 'the numbers and the switch move live');
  ok(TALK_TUNE.cone === was.cone, 'a value that is not a number is left alone');
  ok(TALK_TUNE.back === 0, 'a length never goes below nought');
  ok(!('nosuch' in TALK_TUNE), 'and a name the table has not got is not added to it');
  tuneTalk({ greet: 1 } as never);
  ok(TALK_TUNE.greet === false, 'a switch is only ever moved by a switch');
  Object.assign(TALK_TUNE, was);
  ok(tuneTalk(null) === TALK_TUNE, 'asked with nothing it answers the table in force');
}

console.log(`\n${checks} checks passed`);
