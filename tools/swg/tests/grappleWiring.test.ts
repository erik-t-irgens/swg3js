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
  ['the collider sync runs only while attached or in the fast flight after a let-go', 'if (this.grapple.attached || this.grapple.released) {\n      // On the rope, or in the fast flight after letting go of it: the capsule\'s collider put where the body is', 'if (this.hooks && (g.attached || g.released)) {\n      g.syncCollider(this);'],
  ['the clip (and the slam) runs only while attached or in that flight', 'if (this.grapple.attached || this.grapple.released) this.grapple.clip(this.gview);', 'if (this.hooks && (g.attached || g.released)) g.clip(this);'],
  ['the step after the move runs while the hook is out', 'if (this.grapple.out) this.grapple.afterMove(this.gview, dt);', 'if (this.hooks && g.out) g.afterMove(this, dt);'],
  ['the rest of the frame (the stagger, the jolt, the camera\'s pull, the lean, the arm) runs while anything of it is lively', 'if (this.grapple.lively) this.grapple.look(this.gview, dt);', 'if (this.hooks && g.lively) g.look(this, dt);'],
];
for (const [what, inPlayer, inHarness] of both) ok(update.includes(inPlayer) && frame.includes(inHarness), `${what}, in the player's update and in the harness`);
ok(inOrder(update, ['grapple.afterMove(', 'grapple.look(']).ok && inOrder(frame, ['g.afterMove(', 'g.look(']).ok, 'the look comes after the step after the move, in both');
const sync = update.slice(update.indexOf('if (this.grapple.attached || this.grapple.released) {\n      // On the rope'));
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

// Wave 2: the sounds, the daze, the look.
const sounds = read('../../../src/audio/grappleSounds.ts');
const grade = read('../../../src/core/fx/grade.ts');
const { GRAPPLE_SOUND, GRAPPLE_SOUND_IDS } = await import('../../../src/audio/grappleSounds.ts');
const roles = Object.keys(GRAPPLE_SOUND) as (keyof typeof GRAPPLE_SOUND)[];
const played = [...sounds.matchAll(/GRAPPLE_SOUND\.(\w+)/g)].map((m) => m[1]);
const unprepared = roles.filter((r) => !GRAPPLE_SOUND_IDS.includes(GRAPPLE_SOUND[r]));
ok(unprepared.length === 0 && played.every((r) => roles.includes(r as keyof typeof GRAPPLE_SOUND)), `every grapple sound id is in the prepared list (${roles.length} roles; ${unprepared.join(', ') || 'none missing'})`);
const step = method(sounds, '  step(g: GrappleSoundSource, hand: { x: number; y: number; z: number }, vel: { readonly x: number; readonly y: number; readonly z: number }, space: SoundSpace, live: boolean): void {');
ok(/while \(s\.ratchets < c\.ratchets\) \{\s*s\.ratchets\+\+;\s*this\.once\(host, 'ratchet', GRAPPLE_SOUND\.ratchet, g\.clock\);/.test(step), 'the ratchet is played one for one with the hook\'s own ratchet count');
// The step runs every frame of the session for a player who may never fire: it is handed the velocity record, never a
// speed worked out in the call (a fresh number a frame), and reads the speed only while the wind is wanted.
const soundStep = method(main, '  private stepGrappleSounds(): void {');
ok(soundStep.includes('grappleSounds.step(p.grapple, p.grappleHand(this.grappleSoundAt), p.vel, this.listenerPose.space,') && !soundStep.includes('Math.sqrt'), 'the game hands the sound step the velocity record, not a speed it worked out');
ok(/live && \(g\.out \|\| g\.released\) && GRAPPLE_TUNE\.windGain > 0 \? windGainFor\(len3\(vel\.x, vel\.y, vel\.z\), GRAPPLE_TUNE\) : 0;/.test(step), 'and the step works the speed out only while the wind is wanted');
ok(main.includes('grappleSounds.attach(this.audio, sabers);') && /const files = this\.jka \? this\.jka\.jkaFiles : null;\s*if \(files !== this\.boostFor\) \{/.test(sounds), "the boost's Jedi Academy file is looked for once for each pack the sabers adopt, never every frame");
const srcFiles = ['../../../src/main.ts', '../../../src/player/player.ts', '../../../src/player/grapple.ts', '../../../src/audio/audio.ts', '../../../src/audio/grappleSounds.ts'];
const ratchetIn = srcFiles.filter((f) => read(f).includes('item_ratchet'));
ok(ratchetIn.length === 1 && ratchetIn[0].endsWith('grappleSounds.ts') && (sounds.match(/GRAPPLE_SOUND\.ratchet/g) ?? []).length === 2, 'and that is the only place the ratchet is played (named once in the table, asked for once)');
ok(inOrder(method(main, '  private arrive('), ['this.world.load(', 'grappleSounds.renew();', 'this.world.loadPack(']).ok, "every arrival asks for the grapple's sounds again behind its loading screen");
const feet = method(main, '  private stepFeet(');
ok(feet.includes('this.stepGrappleSounds();'), "the sounds step beside the feet's, which both the frame and advance reach every step");
// The daze: one frame input into the vignette, never a pass turned on.
const pass = grade.slice(grade.indexOf('export class GrainVignettePass'));
const enabled = method(pass, '  enabled(ctx: FxFrameContext): boolean {');
ok(/u\.uVignette\.value = s\.vignette \? Math\.min\(1, s\.vignetteStrength \+ AIM_VIGNETTE \* ctx\.aimAmount \+ ctx\.vignetteKick\) : 0;/.test(pass), "the vignette adds the grapple's kick only inside its own `s.vignette ?` branch");
ok(enabled.length > 0 && !enabled.includes('vignetteKick'), 'and the pass\'s `enabled` never reads it, so the kick can never turn the pass on');
ok(main.includes('f.vignetteKick = this.grappleDaze;') && main.includes('this.grappleDaze = simulate ? player.grapple.dazeNow : 0;'), 'the kick is the stagger\'s daze on a simulated frame and nought on any other');
// And the frame's input reaches the context the pass reads, by the effects' own `updateContext`, run here.
{
  const THREE = await import('three');
  const { createContext, updateContext } = await import('../../../src/core/fx/context.ts');
  const ctx = createContext({} as never, {} as never, { width: 4, height: 4, texture: null, depthTexture: null } as never);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 9000);
  camera.updateMatrixWorld();
  const input = { camera, dt: 1 / 60, sun: null, portalView: false, cameraInHull: false, inside: false, aboard: false, space: false, fog: null, daylight: 1, dayIndex: 0, lighting: null, planetId: '', aiming: false, aimAmount: 0, vignetteKick: 0.37, firstPerson: false, orbitDistance: 0, waterInView: false, followFar: 0, blades: ctx.blades, lights: ctx.lights, skyLights: [], skyLightCount: 0, clouds: [], cloudCount: 0, cameraUnderwater: false, cameraSubmerged: false, underwaterDepth: 0, underwaterColor: new THREE.Color(), underwaterOpacity: 0.75, underwaterReach: 0, room: null, weather: null };
  ok(ctx.vignetteKick === 0, 'a fresh context starts with no kick');
  updateContext(ctx, input as never, new THREE.Vector2(4, 4));
  const kicked = ctx.vignetteKick;
  input.vignetteKick = 0;
  updateContext(ctx, input as never, new THREE.Vector2(4, 4));
  ok(kicked === 0.37 && ctx.vignetteKick === 0, `updateContext carries the frame's kick into the context the vignette reads (${kicked}), and nought the frame after`);
}
// The look, in the player: the lean in `placeVisual`, the arm after the arm chain, the heading on the rope.
const place = method(player, '  placeVisual(): void {');
ok(place.includes('this.leanedAt(this.group.position);') && place.includes('if (this.grapple.leaning) this.group.quaternion.premultiply(this.leanTurn(grappleLeanQ));'), 'the lean is written in placeVisual, once a frame before the render, about the rope point');
const animate = method(player, '  private animateRig(dt: number, speed: number, moving: boolean, mz = 0, mx = 0): void {');
ok(inOrder(animate, ["} else if (this.saberOn) {", 'if (this.grapple.armWeight > 0 && !this.mounted) this.aimGrappleArm(rig);']).ok, 'the left arm is aimed up the rope after the arm chain, while its weight is up');
ok(update.includes('|| (this.grapple.attached && this.grapple.modes.swinging);'), 'and the heading follows the view while swinging on the rope');
// The arm's weight reaches the bones: the rig hands it to the aim (passed as 1, the arm would snap up the rope).
const rig = read('../../../src/player/rig.ts');
const aimArm = method(rig, '  aimArm(side: ');
ok(/aimArmBones\(this\.root, upper, fore, [^;]*, dir, roll, weight\);/.test(aimArm), "the rig's aimArm hands its weight to the bones' aim");
ok(method(player, '  private aimGrappleArm(rig: CharacterRig): void {').includes("rig.aimArm('left', d.set(grappleArmLocal.x, grappleArmLocal.y, grappleArmLocal.z), 0, g.armWeight);"), "and the player aims the left arm by the hook's eased weight");
// The lean on the wire (§3.15): the whole turn and the leaned origin go while `leanSends`, the one rule the hook keeps.
const net = method(main, '  private stepNet(dt: number): void {');
ok(net.includes('const leans = !p.aboard && !p.eva && p.grapple.leanSends;') && net.includes('const at = leans ? p.leanedAt(leanedAt) : p.worldPos;'), "stepNet sends while the hook says the lean goes out, from the origin the leaning figure is drawn at");
ok(net.includes('const q = p.aboard || p.eva || leans ? (p.group.quaternion.toArray().map(n3)') && net.includes("this.net.sendState({ p: [n2(at.x), n2(at.y), n2(at.z)],") && /sendState\(\{[^\n]*\bq,/.test(net), 'and puts the whole turn in the state while it does, with that origin as the place');
// The receiver: the glide of a peer's turn is `peerTurn.ts`'s, which the node test runs over a let-go at the wire's rate.
const remotes = read('../../../src/net/remotePlayers.ts');
ok(remotes.includes("import { glidePeerTurn } from './peerTurn.ts';") && remotes.includes('glidePeerTurn(r.group, r.targetQ, r.heading, k, r);') && !/r\.group\.rotation\.set\(0, r\.group\.rotation\.y/.test(remotes), "a peer's turn is glided by peerTurn.ts, never by the Euler yaw a whole turn leaves behind");
// The camera's pull and the shake: the camera's own arguments and register, nothing new in it.
ok(main.includes('this.cam.update(input, player.worldPos, blocked, dt, eyes, player.grapple.camScaleNow, player.eyeHeight);'), "the on-foot camera is handed the hook's own scale in place of its 1");
const feel = method(main, '  private stepGrappleFeel(): void {');
ok(feel.includes('this.hurtFrom(this.grappleSlamAt.set(s.x, s.y, s.z));') && feel.includes('setViewShake(g.shakeNow);') && feel.includes('setViewShake(g.joltNow);'), "a slam raises the flash and the arc at its contact, and the shake and the jolt go through the camera's register");
ok((main.match(/this\.stepGrappleFeel\(\);/g) ?? []).length === 2, 'the feel is handed over by the frame and by advance alike');

console.log(`\n${checks} checks passed`);
