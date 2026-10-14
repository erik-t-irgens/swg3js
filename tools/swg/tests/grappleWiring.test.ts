// The grapple's wiring, read as source text: the order the player's update runs the hook's steps in (and the
// test harness's, which must be the same), the day-one swim, every way the game lets go, the key block in the
// frame and in `__debug.advance`, the mute before the first press, and the side buttons' guard.
//
// Run: node tools/swg/tests/grappleWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const player = read('../../../src/player/player.ts');
const main = read('../../../src/main.ts');
const grapple = read('../../../src/player/grapple.ts');
const input = read('../../../src/core/input.ts');
const harness = read('./grappleBody.ts');

/** A method's text: from its declaration to the next declaration at the same indent. */
function method(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  const rest = src.slice(start + decl.length);
  const next = rest.search(/\n  (?:private |public |protected |static |async |get |set |readonly )*[A-Za-z_$][\w$]*(?:\(|\s*=|:)/);
  return src.slice(start, start + decl.length + (next < 0 ? rest.length : next));
}

/** Whether the tokens come in this order in the text, each after the one before. */
function inOrder(text: string, tokens: string[]): { ok: boolean; at: number[] } {
  const at: number[] = [];
  let from = 0;
  for (const t of tokens) {
    const i = text.indexOf(t, from);
    at.push(i);
    if (i < 0) return { ok: false, at };
    from = i + t.length;
  }
  return { ok: true, at };
}

// The order of a frame, in the player and in the harness.
const update = method(player, '  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {');
ok(update.length > 1000, `the player's update is found (${update.length} characters)`);
const order = ['swimStep(', 'jka.step(', 'grapple.beforeMove(', 'enableSnapToGround(0.35)', 'computeColliderMovement(', 'grapple.clip(', 'computedGrounded()', 'grapple.afterMove('];
const po = inOrder(update, order);
ok(po.ok, `in the player's update: ${order.join(' < ')}`);
const frame = method(harness, '  frame(dt: number): void {');
const ho = inOrder(frame, ['swimStep(', 'jka.step(', 'g.beforeMove(', 'enableSnapToGround(0.35)', 'computeColliderMovement(', 'g.clip(', 'computedGrounded()', 'g.afterMove(']);
ok(ho.ok, "and the harness steps a frame in the very same order (its `g` is the player's `grapple`)");
ok(inOrder(update, ['grapple.syncCollider(', 'computeColliderMovement(']).ok && inOrder(frame, ['g.syncCollider(', 'computeColliderMovement(']).ok, 'the collider is synced before the controller, in both');

// Every rope line the player's update holds, and the harness beside it, so the behaviour tests, which run the
// harness, run what the game runs: a line taken out of the player (or put behind the wrong guard) fails here even
// though every test of the harness still passes. The rewrite of the movement's command is the hook's own `command`,
// which both call; the rest are the lines themselves.
const both: [string, string, string][] = [
  ["the movement is handed the rope's command and its grounded", 'const stepGrounded = this.grapple.command(c, this.grounded);', 'let stepGrounded = this.hooks ? g.command(c, this.grounded) : this.grounded;'],
  ['jka.step is handed that grounded', 'this.jka.step(dt, this.vel, this.pos, stepGrounded, c,', 'this.jka.step(dt, this.vel, this.pos, stepGrounded, c,'],
  ['the rope\'s words are worked out while the hook is out', 'if (this.grapple.out) {\n      this.grapple.refreshModes(this.gview);', 'if (this.hooks && g.out) {\n      g.refreshModes(this);'],
  ['the swim is handed the rope\'s lift only while the hook is out', 'sw.ropeLift = this.grapple.out && this.grapple.liftsSwimmer(this.gview);', 'sw.ropeLift = this.hooks && g.out && g.liftsSwimmer(this);'],
  ['the swum speed is written back', 'speed = swum.speed;', 'speed = swum.speed;'],
  ['the swim\'s grounded is written back', 'this.grounded = swum.grounded;', 'this.grounded = swum.grounded;'],
  ['the step before the move runs while the hook is out', 'if (this.grapple.out) this.grapple.beforeMove(this.gview, dt);', 'if (this.hooks && g.out) g.beforeMove(this, dt);'],
  ['the snap is off while swinging', '|| (this.grapple.attached && this.grapple.modes.swinging)) this.controller.disableSnapToGround();', '|| (this.hooks && g.attached && g.modes.swinging)) this.controller.disableSnapToGround();'],
  ['the collider sync runs only while attached', 'if (this.grapple.attached) {\n      // On the rope: the capsule\'s collider put where the body is', 'if (this.hooks && g.attached) {\n      g.syncCollider(this);'],
  ['the clip runs only while attached', 'if (this.grapple.attached) this.grapple.clip(this.gview);', 'if (this.hooks && g.attached) g.clip(this);'],
  ['the step after the move runs while the hook is out', 'if (this.grapple.out) this.grapple.afterMove(this.gview, dt);', 'if (this.hooks && g.out) g.afterMove(this, dt);'],
];
for (const [what, inPlayer, inHarness] of both) ok(update.includes(inPlayer) && frame.includes(inHarness), `${what}, in the player's update and in the harness`);
const sync = update.slice(update.indexOf('if (this.grapple.attached) {\n      // On the rope'));
ok(inOrder(sync, ['this.grapple.syncCollider(this.gview);', 'moveX += gc.x;', 'moveY += gc.y;', 'moveZ += gc.z;', 'computeColliderMovement(']).ok, "inside that guard the collider is synced and the rope's correction added to the move, before the controller");
const command = method(grapple, '  command(c: { fmove: number; smove: number; jump: boolean; jumpPressed: boolean }, grounded: boolean): boolean {');
ok(/if \(this\.state !== 'attached'\) return grounded;/.test(command) && /if \(m\.swinging\) \{\s*c\.fmove = 0;\s*c\.smove = 0;\s*c\.jump = false;\s*c\.jumpPressed = false;\s*\}/.test(command) && /return m\.sliding \? false : grounded;/.test(command), "the hook's command hands nothing on unless attached, takes the keys and the jump while swinging and the ground while sliding");

// The swim's depth is one number: the player decides it swims by the very constant the swim step and the harness read.
ok(/import \{[^}]*\bSWIM_DEPTH\b[^}]*\} from '\.\/swimStep\.ts';/.test(player) && !/const SWIM_DEPTH\b/.test(player), "the player's swim depth is swimStep's own, imported, never a second copy");
ok(/import \{[^}]*\bSWIM_DEPTH\b[^}]*\} from '\.\.\/\.\.\/\.\.\/src\/player\/swimStep\.ts';/.test(harness) && /this\.swimming = !this\.inside && depth > \(this\.swimming \? SWIM_DEPTH - 0\.3 : SWIM_DEPTH\);/.test(update) && /this\.swimming = !this\.inside && depth > \(this\.swimming \? SWIM_DEPTH - 0\.3 : SWIM_DEPTH\);/.test(frame), 'and the harness decides swimming by the same constant and the same line');

// The mark: stood down whole on a frame the camera does not work it out, and its water test the game's own arithmetic.
const camera = method(main, '  private updateCamera(');
ok(inOrder(camera, ['this.grappleMarkProbed = false;', 'this.placeCamera(blocked, dt);', 'if (!this.grappleMarkProbed) this.player.grapple.markOff();']).ok, "a frame whose camera never reached the mark (a shuttle's passenger, a ship's view) stands the mark down, its flash with it");
const markStep = method(main, '  private stepGrappleMark(dt: number): void {');
ok(markStep.includes('g.markOff();') && markStep.indexOf('g.markOff();') < markStep.indexOf('g.probeMark(') && markStep.indexOf('this.grappleMarkProbed = true;') > markStep.indexOf('g.probeMark('), 'mounted, aboard, adrift, in noclip or in space the mark is stood down, and only a probe that ran says so');
ok(/underWater\(p\.y, flat,/.test(main) && /return w\.lavaAt\(p\.x, p\.y, p\.z\) > 0;/.test(main), "the game's water test is grappleMath's underWater, then a flow's depth (the arithmetic water test 9 runs)");

// The swim: the fall's apex held every swimming frame, and never a let-go.
const swimAt = update.indexOf('if (this.swimming) {');
const swimEnd = update.indexOf("} else if (this.moveProfile === 'jka')", swimAt);
const swim = swimAt >= 0 && swimEnd > swimAt ? update.slice(swimAt, swimEnd) : '';
ok(swim.includes('swimStep(') && swim.includes('jka.holdApex(this.pos.y)'), "the player's swim branch runs swimStep and holds the fall's apex every swimming frame");
ok(swim.length > 0 && !swim.includes('grapple.letGo'), 'and nothing in it lets the grapple go: the rope holds in water');
const hSwimAt = frame.indexOf('if (this.swimming) {');
const hSwim = frame.slice(hSwimAt, frame.indexOf('} else {', hSwimAt));
ok(hSwim.includes('jka.holdApex(this.pos.y)'), "the harness's swim holds the apex too (behind the switch its control case turns off)");
ok(/DIVE_DEPTH_FOR_TESTS = 1\.9/.test(harness) && /const DIVE_DEPTH = 1\.9/.test(player), "the harness's dive depth is the player's 1.9");

// Every way the game lets go (§3.10).
const playerSites = ['board', 'leave', 'death', 'stand', 'reset', 'noclip', 'mount', 'eva'];
const missing = playerSites.filter((r) => !player.includes(`grapple.letGo('${r}')`));
ok(missing.length === 0, `the player lets go at boarding, leaving the rooms, the ragdoll, standing up, a reset, noclip, mounting and adrift (${missing.join(', ') || 'none missing'})`);
const mainSites = ['select', 'travel', 'doorless', 'lift', 'inside', 'placing'];
const missingMain = mainSites.filter((r) => !main.includes(`grapple.letGo('${r}')`));
ok(missingMain.length === 0, `the game lets go on the way to the select screen, a travel, the doorless way in, a lift, crossing indoors and a hand filling (${missingMain.join(', ') || 'none missing'})`);
for (const [name, decl, reason] of [
  ['rideLift', '  private rideLift(index: number): void {', 'lift'],
  ['the doorless branch of handleElevator', '  private handleElevator(): boolean {', 'doorless'],
] as const) {
  const m = method(main, decl);
  const go = m.indexOf(`grapple.letGo('${reason}')`);
  const write = m.indexOf('p.pos.copy(');
  ok(go >= 0 && write >= 0 && go < write, `${name} lets the grapple go before it writes the player's place`);
}
const reset = method(player, '  reset(');
ok(reset.indexOf("grapple.letGo('reset')") >= 0 && reset.indexOf("grapple.letGo('reset')") < reset.indexOf('this.pos.'), "the player's reset lets go before it writes its place");

// The key block: in the frame and in `__debug.advance`, under the frame's guard, the mute applied before a press is read.
const calls = main.split('\n').filter((l) => l.includes('this.stepGrappleKeys()'));
ok(calls.length === 2, `stepGrappleKeys is called twice, by the frame and by advance (${calls.length})`);
const adv = main.slice(main.indexOf('      advance: (seconds: number, keys: string[] = [], hold = false) => {'));
ok(adv.slice(0, 4000).includes('this.stepGrappleKeys()'), "advance steps the grapple's keys");
ok(inOrder(main, ['const hadInHand = this.stepPlacingKeys(dt, takeKey);', 'void this.takeNearestProp();', 'if (!this.map.open && !this.anyPanelOpen() && !this.placing && !this.propPlacing) this.stepGrappleKeys();', "if (input.pressedAction('saberToggle')"]).ok, "the frame steps them after the placing hand's and the pick-up and before the rest of the key block, never with the map, a panel or a hand up");
const stepKeys = method(grapple, '  stepKeys(input: GrappleKeyInput, b: GrappleBody, mutes: string[], fire: () => void): void {');
const keyOrder = inOrder(stepKeys, ['input.muteUntilUp(GRAPPLE_RELEASE_MUTES)', 'input.mute(mutes)', "input.pressedAction('grappleFire')", "input.pressedAction('grappleBoost')"]);
ok(keyOrder.ok, "inside the hook's key block the owed release mute and the frame's mutes come before the fire and the boost are read");
ok(stepKeys.indexOf('input.muteUntilUp(GRAPPLE_RELEASE_MUTES)', keyOrder.at[3]) > keyOrder.at[3], 'and a let-go the boost made mutes at once, in the same block');
ok(harness.includes('g.stepKeys(input, this, this.mutes, this.fireNow)'), 'the harness calls the very same key block');

// The side buttons' guard in the input.
ok(/window\.addEventListener\('mouseup', sideGuard, true\)/.test(input) && /window\.addEventListener\('auxclick', sideGuard, true\)/.test(input), 'the input listens for mouseup and auxclick on the window in the capture phase');
ok(/e\.button === 3 \|\| e\.button === 4/.test(input), 'and its guard names buttons 3 and 4, the back and forward side buttons');

console.log(`\n${checks} checks passed`);
