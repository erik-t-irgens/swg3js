// Wave 4 of the animations, the ledges' hand-overs as text, and their dials through the real table. Every behaviour test of
// the ledges runs the grapple's harness (tools/swg/tests/grappleBody.ts), which makes each hand-over for itself, so a line
// lost from the game alone would pass every one of them: this reads the player's update beside the harness's frame for the
// same order, the rig's hook, the peers' pass, and the game's keys, words, helper and dials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIMB_DIALS, climbDialsFor } from '../../../src/anim/climbDials.ts';
import { CLIMB_CHOICES, CLIMB_RANGES, CLIMB_TUNE, CLIMB_TUNE_SHIPPED, LEDGE_MUTES, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { allDials, movedLine, resetDials, type NumberDial } from '../../../src/ui/dials.ts';
import { FIGHT_ACTIONS } from '../../../src/core/input.ts';
import { isHangState } from '../../../src/player/peerHang.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const has = (text: string, s: string) => text.includes(s);
const count = (text: string, s: string) => text.split(s).length - 1;

const player = read('../../../src/player/player.ts');
const harness = read('./grappleBody.ts');
const main = read('../../../src/main.ts');
const rig = read('../../../src/player/rig.ts');
const ledgeSrc = read('../../../src/player/ledge.ts');
const peers = read('../../../src/net/remotePlayers.ts');
const grapple = read('../../../src/player/grapple.ts');

// ---- the player's update and the harness's frame: one order ---------------------------------------------------------------
const update = player.slice(player.indexOf('  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {'), player.indexOf('  private senseLedge('));
const frame = harness.slice(harness.indexOf('  frame(dt: number'), harness.indexOf('  private hangFrame('));
/** Each token's place in the text, in order: true when every one is found after the one before. */
function inOrder(text: string, tokens: string[]): boolean {
  let at = 0;
  for (const t of tokens) {
    const i = text.indexOf(t, at);
    if (i < 0) return false;
    at = i + t.length;
  }
  return true;
}
ok(inOrder(update, ['this.eva = false;', 'if (this.ledge.holding) {\n      this.hangFrame(dt, input, cam, world);\n      return;\n    }', 'const g = world.planet.gravity;']), 'the player: holding, the hang has the frame in place of the movement, before any of it');
ok(inOrder(frame, ['if (this.ledge.holding) {', 'this.hangFrame(dt);', 'return;']) && frame.indexOf('if (this.ledge.holding) {') < frame.indexOf('computeColliderMovement'), 'the harness: the same, before the move');
const clamp = 'if (!wasGrounded && this.grounded && Math.abs(mv.y) < 1e-4 && this.vel.y > 0) this.grounded = false;';
ok(inOrder(update, [clamp, 'this.ledgeClocks(dt);', 'if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {\n      this.hangFrame(dt, input, cam, world);\n      return;\n    }']), 'the player: after the landing\'s clamp, a let-go\'s clocks, then a grab, whose frame is the hang\'s');
ok(inOrder(frame, [clamp, 'if (this.ledge.tick(dt)) this.heading = this.ledge.turnNow;', 'if (this.ledge.sense(', 'this.takenByLedge();', 'this.hangFrame(dt, true);']), 'the harness: the same, in the same place');
ok(inOrder(update, ['if (this.grapple.lively) this.grapple.look(this.gview, dt);', 'if (this.grapple.haulStuck && this.ledgeFromHaul()) {\n      this.hangFrame(dt, input, cam, world);\n      return;\n    }']) && inOrder(frame, ['if (this.hooks && g.lively) g.look(this, dt);', 'g.haulStuck', 'this.ledge.fromHaul(', "g.letGo('ledge');", 'this.hangFrame(dt, true);']), 'the grapple\'s haul ended under a lip: after its look, in both, a hang there with the rope let go');
ok(has(player, 'li.busy = this.swimming || this.grapple.out || this.grapple.released || ') && has(harness, 'li.busy = this.swimming || (this.hooks && (g.out || g.released)) || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || this.prone;') && has(player, '|| this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) ||') && has(player, '|| this.prone ||'), 'a grab is refused alike with the hook out at all (the hand holds the rope), in a special jump, rising on a Force jump or lying down');
// The hang's own frame: the ledge's step, its clips, the figure placed, then its limbs; the harness's the step alone.
const hang = player.slice(player.indexOf('  private hangFrame('), player.indexOf('  private readonly hangFade'));
ok(inOrder(hang, ['this.loco.idle(0, this.staminaPool);', 'this.ledge.step(', 'this.jka.holdApex(this.pos.y);', 'this.animateHang(dt);', 'this.placeVisual();', 'this.placeHangLimbs();', 'this.body.setNextKinematicTranslation(']), 'the player\'s hang: the speed classes put down, the ledge\'s step, the fall\'s memory held, the clips, the figure placed, the limbs on the lip, the body moved');
ok(inOrder(harness.slice(harness.indexOf('  private hangFrame(')), ['this.ledge.step(', 'this.jka.holdApex(this.pos.y);', 'this.body.setNextKinematicTranslation(', 'this.physics.step(dt);']), 'the harness\'s hang: the same step, the same memory, the same move');
// (Smoothness II moved the hang's clips whole into src/player/hangClips.ts, which the player's `animateHang` calls: the pin moved with them.)
const hangClips = read('../../../src/player/hangClips.ts');
ok(has(hangClips, "if (L.startClip) rig.play(ledgeClipName(L.startClip), { from: L.startFrom, fadeIn: L.startFade, hold: L.holding, keepWeight: CLIMB_TUNE.transitions === 'blend' });\n  else if (L.ended) rig.stopOverride(CLIMB_TUNE.ease);") && has(player, 'driveHangClips(rig, L, dt, this.hangClips);'), 'a one-off is played from where the ledge starts it, held while the body is held, and let go into the loop over the ease at its end');
ok(inOrder(player.slice(player.indexOf('  placeVisual(): void {')), ['if (rig && this.drawn.offset !== 0) rig.root.position.y += this.drawn.offset;', 'if (rig && (this.ledgeRooted || this.ledge.offset)) {', 'if (this.ledge.offset) this.applyLedgeRoot();']), 'the figure\'s line-up against the body goes on the rig\'s root after the drawn body\'s lag, and comes off when it is done');
// (Smoothness II, item 3: the figure's spheres cleared between the line-up and the solves, and settled after them.)
ok(has(player, 'this.ledge.limbsFor(lp, rig, toPhys);\n    this.clearFigure(lp, toPhys);\n    lp.filter = this.moveFilter();\n    lp.place(rig, this.physics.world, toPhys);\n    this.settleFigure(lp, toPhys);'), 'the limbs are handed the lip by the ledge and placed in the move\'s own groups');
ok(/this\.limbPose\?\.restore\(\);\n    this\.legPose\?\.restore\(\);\n    this\.mixer\.update\(dt\);/.test(rig) && count(rig, 'this.limbPose?.restore();') === 2 && /  retakePose\(\): void \{\n    this\.limbPose\?\.restore\(\);\n    this\.legPose\?\.restore\(\);/.test(rig), 'the rig puts the hands\' and wall feet\'s clean pose back before the feet\'s, both before its mixer: the last to turn a joint the first to put it back (and in that same order once more, and only, where a respawn hands the skeleton back, `retakePose`)');
// The fix round's hand-overs (every behaviour test makes them in the harness for itself).
const crouchNow = 'this.ledge.step(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina);\n    // The capsule the ledge\'s step has the body in: standing, but crouched over the top on a climb\'s last leg.\n    this.setCrouchCollider(this.ledge.crouchedNow);';
ok(has(hang, crouchNow) && !has(hang, 'this.setCrouchCollider(false);') && has(harness, 'this.ledge.step(this.physics.world as unknown as LedgeWorld, this, this.fillLedgeIn(dt, null, false), this.stamina);\n    // The capsule the ledge\'s step has the body in: standing, but crouched over the top on a climb\'s last leg.\n    this.setCrouchCollider(this.ledge.crouchedNow);'), 'the hang wears the capsule the ledge\'s step has the body in (crouched on a climb\'s last leg), in the player and the harness alike, after the step');
// (The smoothness round: `tilted` is the lip's tilt or a side's cue leaning the figure, `leanNow`, which is nought under 'before'.)
ok(has(player, '    if (L.tilted) L.applyTilt(rig.root);\n    else rig.root.quaternion.set(0, 0, 0, 1);\n    this.ledgeRooted = true;') && has(player, '        rig.root.quaternion.set(0, 0, 0, 1);\n        this.ledgeRooted = false;') && has(ledgeSrc, 'return this.tilt !== 0 || this.leanNow !== 0;') && has(ledgeSrc, 'const t = this.tilt + this.leanNow;'), 'the figure is turned with a sloping lip (and a side\'s cue\'s lean) on the rig\'s root, and upright again when the line-up is done');
const peerHang = read('../../../src/player/peerHang.ts');
ok(has(peerHang, 'L.applyTilt(rig.root);\n      this.onY += L.tiltLift;\n      this.tilted = true;') && has(peerHang, 'if (this.tilted) root.quaternion.set(0, 0, 0, 1);'), 'another player\'s figure is turned with the lip found under their hands, and put back upright by the undo');
ok(has(main, '|| this.player.grapple.out || this.player.climbHolds) return;') && ['emoteWheel', 'emote1', 'emote2', 'emote3', 'emote4', 'switchClass'].every((a) => LEDGE_MUTES.includes(a)), 'no emote plays while hanging or climbing (its keys muted, and `playEmote` refuses for the band and the console), and the class is not switched');
ok(has(player, 'li.airWallMove = !this.grounded && this.jka.airWallMoveOpen(this.pos, this.vel);') && has(harness, 'li.airWallMove = !this.grounded && this.jka.airWallMoveOpen(this.pos, this.vel);'), 'the wall climb is told when Jedi Academy\'s own wall move is open in the air, in the player and the harness alike');
ok(has(player, 'bi.blocked = !space && this.wallBlocked;'), 'the bracing is told when the move was cut short (a face pressed into is felt for at once)');
{
  // Climbing II's fixer: the hang asks the spine's twist on every frame, as phase 1 did (`twistTorso(0, 0)` eases the steady
  // share and puts the clean pose back), the look-away's twist in its place: no switch of phase 2 may make it a frame's choice.
  const animate = player.slice(player.indexOf('  private animateHang(dt: number): void {'), player.indexOf('  /** The hop clip held as the look-away'));
  const after = animate.slice(animate.lastIndexOf('this.group.updateMatrixWorld(true);'));
  ok(animate.length > 0 && /^this\.group\.updateMatrixWorld\(true\);\n(\s*\/\/[^\n]*\n)*\s*rig\.twistTorso\(L\.lookTwistNow, 0\);\n\s*\}\n/.test(after), 'the hang turns the spine (nought with no look-away) on every frame after its clips, never behind a test');
}

// ---- the grapple, the keys, the words, the helper ---------------------------------------------------------------------------
ok(has(grapple, "if (s.climbing) return 'climbing';") && has(player, 's.climbing = this.climbHolds;'), 'the grapple refuses to fire while the hands hold a lip, and the player says when');
ok(has(main, "if (why === 'climbing') {\n        this.messages.system(CLIMBING_WORDS);\n        return CLIMBING_WORDS;\n      }"), '... and the game says so in words');
ok(has(main, 'private stepLedgeKeys(): void {\n    if (this.player.climbHolds) this.input.mute(LEDGE_MUTES as readonly Action[]);\n  }') && count(main, 'this.stepLedgeKeys();\n') === 2 && count(main, 'this.stepLedgeKeys();') === 2 && /this\.stepLedgeKeys\(\);\n\s+this\.stepSprintKeys\(\);\n\s+this\.stepImpactKeys\(\);/.test(main), 'the game mutes the ledges\' actions while hanging, at two places (the frame loop and the console\'s advance), each straight before the sprint\'s and the impact\'s');
ok(LEDGE_MUTES.every((a) => !['forward', 'back', 'left', 'right', 'jump', 'crouch', 'grappleFire'].includes(a)) && FIGHT_ACTIONS.filter((a) => a !== 'grappleFire').every((a) => LEDGE_MUTES.includes(a)), 'the hang mutes every fighting action but the grapple\'s fire (whose refusal is said), and none of the hang\'s own keys');
ok(has(main, 'this.player.onLedgeWords = (words) => this.messages.system(words);'), 'what a ledge says goes to the message line');
ok(has(main, 'climb: (o: ClimbDebugOptions = {}) => this.climbDebug(o),') && has(main, 'locoDialsFor(helper) ?? climbDialsFor(helper) ??'), '`__debug.climb` is the helper and the debug menu is handed its dials');

// ---- the peers --------------------------------------------------------------------------------------------------------------
const STATES = ['hangBraced', 'hangFree', 'shimmyBracedL', 'shimmyBracedR', 'shimmyFreeL', 'shimmyFreeR', 'climbUpBraced', 'climbUpFree'];
const statesLine = peers.slice(peers.indexOf('const STATES: Set<string> = new Set(['), peers.indexOf(']);', peers.indexOf('const STATES: Set<string> = new Set([')));
const offFeet = peers.slice(peers.indexOf('const OFF_FEET: Set<string> = new Set(['), peers.indexOf(']);', peers.indexOf('const OFF_FEET: Set<string> = new Set([')));
ok(STATES.every((s) => statesLine.includes(`'${s}'`) && offFeet.includes(`'${s}'`) && isHangState(s) && s.length <= 32), 'every hang state is one the peers know, on no feet, a hang to the peers\' pass, and within the relay\'s 32 characters');
ok(inOrder(peers, ['r.feet.step(rig, fw, null);', 'const hanging = !r.down && !r.vehicle && isHangState(r.state);', 'r.hang.step(rig,']) && inOrder(peers, ['if (rig) r.feet.undrop(rig);', 'if (rig && r.hang) r.hang.undo(rig.root);']), 'another player\'s hang is lined up after the feet\'s pass, and taken back off where the feet\'s drop is');

// ---- the dials --------------------------------------------------------------------------------------------------------------
{
  const numbers: string[] = [];
  const walk = (o: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(o)) {
      const at = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v as Record<string, unknown>, at);
      else if (typeof v === 'number') numbers.push(at);
    }
  };
  walk(CLIMB_TUNE as unknown as Record<string, unknown>, '');
  ok(numbers.sort().join() === Object.keys(CLIMB_RANGES).sort().join(), `every number of the tune has a range, and every range a number (${numbers.length})`);
  const dials = allDials(CLIMB_DIALS);
  const keys = dials.map((d) => d.key);
  ok(numbers.every((p) => keys.includes(`tune.${p}`)) && Object.keys(CLIMB_CHOICES).every((c) => keys.includes(`tune.${c}`)) && new Set(keys).size === keys.length && dials.length === numbers.length + Object.keys(CLIMB_CHOICES).length, `every number of the tune is a slider and the switch a choice (${dials.length} dials)`);
  ok(climbDialsFor('climb') === CLIMB_DIALS && climbDialsFor('loco') === null, 'the debug menu is handed them for `climb` and for nothing else');
  let moved = 0;
  for (const d of dials) {
    if (d.kind !== 'number') continue;
    const n = d as NumberDial;
    const to = n.get() === n.max ? n.min : n.max;
    n.set(to);
    if (n.get() === to) moved++;
    const words = n.set(n.max + 1000);
    assert.ok(n.get() === n.max && words.length === 1, `${d.key} is held to its range and says so`);
  }
  ok(moved === dials.filter((d) => d.kind === 'number').length, 'each slider moves its own number, held to its range');
  const line = movedLine(CLIMB_DIALS);
  ok(line.startsWith('__debug.climb({tune:{') || line.startsWith('__debug.climb({ tune: {'), `the line the menu copies out is the helper's own argument (${line.slice(0, 50)}...)`);
  resetDials(CLIMB_DIALS);
  ok(JSON.stringify(CLIMB_TUNE) === JSON.stringify(CLIMB_TUNE_SHIPPED), 'and a reset puts every one back');
  const sw = dials.find((d) => d.key === 'tune.ledges')!;
  sw.set('before');
  ok(CLIMB_TUNE.ledges === 'before', 'the switch takes the word it shows');
  resetClimbTune();
  ok(CLIMB_TUNE.ledges === 'on', '... and the tune is back as shipped');
}
console.log(`ledgeWiring: ${checks} checks passed`);
