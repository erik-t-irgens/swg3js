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
  ['the clip (and the slam, and from wave 3 the hull test over the controller\'s move) runs only while attached or in that flight', 'if (this.grapple.attached || this.grapple.released) this.grapple.clip(this.gview, mv);', 'if (this.hooks && (g.attached || g.released)) g.clip(this, mv);'],
  ['the swim is handed the tow only while the hook is out (wave 3)', 'sw.towed = this.grapple.out && this.grapple.towsSwimmer(this.gview, sw);', 'sw.towed = this.hooks && g.out && g.towsSwimmer(this, sw);'],
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
const keyOrder = inOrder(stepKeys, ['input.muteUntilUp(this.owedMutes)', 'input.mute(mutes)', "input.pressedAction('grappleFire')", "input.pressedAction('grappleBoost')"]);
ok(keyOrder.ok, "inside the hook's key block the owed release mute and the frame's mutes come before the fire and the boost are read");
ok(stepKeys.indexOf('input.muteUntilUp(this.owedMutes)', keyOrder.at[3]) > keyOrder.at[3], 'and a let-go the boost made mutes at once, in the same block');
// What a let-go owes: every let-go's three, or a loose prop's torch alone (wave 3a), never a list of its own making.
const letGoText = method(grapple, '  letGo(reason: LetGoReason): void {');
ok(/this\.owedMutes = this\.state === 'holding' && !\(this\.muteOwed && this\.owedMutes === GRAPPLE_RELEASE_MUTES\) \? THING_RELEASE_MUTES : GRAPPLE_RELEASE_MUTES;/.test(letGoText) && letGoText.indexOf('this.owedMutes =') < letGoText.indexOf("this.state = 'off';"), "a let-go owes the three, or a loose prop's torch alone, chosen before the state is cleared");
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
const net = method(main, '  private stepNet(dt: number, frameAt: number): void {');
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

// Wave 3a: a loose prop on the rope, and the hook's numbers through the player's stats.
ok(main.includes('this.player.grapple.propAt = hookablePropAt;') && !main.includes('grapple.isProp'), "the game hangs the pool's own hookablePropAt on the hook");
ok(grapple.includes("import type { HookableProp } from '../world/looseProps.ts';") && !/^import (?!type )[^;]*from '\.\.\/world\//m.test(grapple), 'and the hook takes nothing of the world but the prop\'s type, so node loads it with no pool');
ok(player.includes('this.grapple.stats = this.stats;'), "the player hands the hook its own stats, so its range, reel, haul, sway and strength read through them");
ok(/controller\.setCharacterMass\(80\);/.test(player) && /export const GRAPPLE_PLAYER_MASS = 80;/.test(grapple), "the mass rule weighs a thing against the player's own 80 kg, the controller's");
const draw = method(player, '  drawGrapple(camera: THREE.PerspectiveCamera, screenH: number): void {');
ok(inOrder(draw, ['if (g.holding) g.placeThingEnd();', 'const pts = g.rope.hullPoints > 0 ? g.drawnPoints(this.ropeDrawn) : g.rope.pts;', 'ribbon.lay(pts, g.rope.n + 1, h, camera);']).ok, "a hooked prop's end is carried onto the prop as it is drawn, before the ribbon is laid, and a point on a hull is laid where the hull is drawn");
const after = method(grapple, '  afterMove(b: GrappleBody, dt: number): void {');
ok(inOrder(after, ["if (this.state === 'holding') {", 'this.stepThing(b, dt);', "if (this.state !== 'attached') {"]).ok, "the step after the move runs a hooked prop's frame (behind `out`, as both the player and the harness call it) and nothing of the anchor's");
ok(/const haul = live && \(g\.attached \|\| !!g\.holding\) && g\.keys\.haul;/.test(sounds), "the yank winds the haul's own rumble");
const fly = method(grapple, '  private flyDart(b: GrappleBody, dt: number): void {');
ok(inOrder(fly, ["kind === 'prop' ? this.propAt?.(hit.collider.handle)", "this.whoMovesFor(prop.mass) === 'thing'", 'this.attachThing(', "this.say?.('Too heavy to pull.');"]).ok, 'the dart hooks a prop only when the mass rule moves the thing, and says so when it is too heavy');

// Wave 3b: the vehicles this browser simulates. The class every vehicle shares is the grapple's to call into only through
// its one pull, nothing of the player's goes into it, and only the grapple takes a hull out of the controller.
{
  const { readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const srcDir = fileURLToPath(new URL('../../../src/', import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f)) files.push(p);
    }
  };
  walk(srcDir);
  const callers = (re: RegExp) =>
    files
      .filter((f) => re.test(readFileSync(f, 'utf8')))
      .map((f) => relative(srcDir, f).replace(/\\/g, '/'))
      .sort();
  const pulls = callers(/\.pulled\(/);
  ok(pulls.length === 1 && pulls[0] === 'player/grappleFrames.ts', `nothing in src/ calls Vehicle.pulled but the grapple's own vehicle source (${pulls.join(', ')})`);
  const frames = read('../../../src/player/grappleFrames.ts');
  ok(/pull\(j: \{ x: number; y: number; z: number \}, at: \{ x: number; y: number; z: number \}\): void \{\n\s*this\.v\?\.pulled\(j, at\);/.test(frames) && /src\.pull\(j, at\);/.test(grapple), "and that source's pull is the one the grapple's pullHulls makes, with the brake already taken off");
  const vehicle = read('../../../src/vehicles/vehicle.ts');
  ok(!/from '\.\.\/player\//.test(vehicle) && !/import\(['"]\.\.\/player\//.test(vehicle), 'vehicle.ts imports nothing of src/player');
  const marks = callers(/\.markWalkThrough\(/);
  ok(marks.join(',') === 'player/grappleFrames.ts,world/world.ts', `nothing in src/ marks a collider walk-through but the grapple's hulls and the followers' bodies (${marks.join(', ')})`);
  ok(/for \(const c of m\.colliders\) this\.physics\.markWalkThrough\(c, on\);/.test(read('../../../src/world/world.ts')), "and the followers' marking is of a follower's own colliders, never a hull's");
  const remote = read('../../../src/net/remoteBodies.ts');
  const peerColliders = remote.match(/createCollider\([^\n]*\n\s*[a-z]\.collider\.setCollisionGroups\(PEER_GROUPS\);/g) ?? [];
  ok(peerColliders.length === 2 && peerColliders.every((c) => c.includes('.setSensor(true)')) && /const PEER_GROUPS = groups\(Group\.peer, 0\);/.test(remote), "remoteBodies.ts' peer colliders keep PEER_GROUPS (a filter of nought) and their sensor flag");
  ok(/readonly hullController: RAPIER_NS\.KinematicCharacterController \| null;/.test(grapple) && (player.match(/makeHullController\(/g) ?? []).length === 1 && /this\.hullController = makeHullController\(physics\.world\);/.test(player) && /return self\.aboard \? null : self\.hullController;/.test(player), "the hull test's controller is made once, in the player's constructor, and handed to the grapple (none aboard a ship's rooms)");
  // That controller is one maker's, which the harness calls too, and its offset, slopes and mass are the player's own
  // controller's (`makeBody`'s), so every vehicle test runs the hull test the game runs.
  const maker = frames.slice(frames.indexOf('export function makeHullController('), frames.indexOf('\n}\n', frames.indexOf('export function makeHullController(')));
  const makeBody = method(player, '  private static makeBody(');
  const setting = (src: string, re: RegExp) => (src.match(re) ?? [])[1] ?? '?';
  const same = [/createCharacterController\(([^)]*)\)/, /setMaxSlopeClimbAngle\(([^;]*)\);/, /setMinSlopeSlideAngle\(([^;]*)\);/, /setCharacterMass\(([^)]*)\)/].map((re) => [setting(maker, re), setting(makeBody, re)]);
  ok(
    maker.length > 0 && same.every(([a, b]) => a !== '?' && a === b) && /hc\.disableAutostep\(\);/.test(maker) && /hc\.disableSnapToGround\(\);/.test(maker) && /hc\.setApplyImpulsesToDynamicBodies\(false\);/.test(maker),
    `the hull test's controller has the player's own offset, slopes and mass (${same.map(([a]) => a).join(', ')}), no autostep, no snap and no pushing`,
  );
  ok(/this\.hullController = makeHullController\(world\);/.test(harness) && !/createCharacterController\(0\.04\);\s*hc\./.test(harness), 'and the harness makes it with the very same maker, never a copy');
  // Every hand-over of wave 3b in the game, each of which the harness makes for itself: a line lost from the game alone
  // would leave the rope ignoring every vehicle in play while every behaviour test passed.
  ok(main.includes('this.player.grapple.vehicleOf = vehicleOfCollider;') && harness.includes('this.grapple.vehicleOf = vehicleOfCollider;'), 'the game and the harness hang the vehicles\' own collider lookup on the hook');
  ok(inOrder(markStep, ['v.vehicles = this.world.vehicles;', 'g.probeMark(']).ok, "the mark's probe is handed the world's vehicles before it runs");
  const fireNow = method(main, '  private fireGrapple(): string {');
  ok(/g\.fire\([^;]*, g\.markTarget\(\)\);/.test(fireNow) && /g\.fire\([^;]*, g\.markTarget\(\)\);/.test(harness), "the fire hands the dart the mark's hull's own motion to aim true against, in the game and the harness");
  ok(inOrder(update, ['this.grappleVehicles = world.vehicles;', 'this.grapple.refreshModes(this.gview);', 'this.grapple.beforeMove(']).ok && /get vehicles\(\) \{\s*return self\.grappleVehicles;\s*\}/.test(player), "the player's update hands the hook the world's vehicles before the hook's first step of the frame");
  ok(
    inOrder(update, ['const ground = this.aboard ? -1e9 : terrain.heightAt(this.pos.x, this.pos.z);', 'this.groundUnder = ground;', 'if (this.grapple.out) this.grapple.afterMove(this.gview, dt);']).ok &&
      inOrder(frame, ['this.ground = this.groundAt ? this.groundAt(this.pos.x, this.pos.z) : Number.NEGATIVE_INFINITY;', 'if (this.hooks && g.out) g.afterMove(this, dt);']).ok &&
      /get ground\(\) \{\s*return self\.groundUnder;\s*\}/.test(player),
    "the terrain's height under the body (the towed floor's) is read after the move and before the step after it, in both",
  );
  const garage = read('../../../src/vehicles/garage.ts');
  ok(inOrder(method(garage, '  async refit('), ['refitSwap(', 'v.refits++;']).ok, "a refit's swap counts on the hull, which lets an anchor on it go");

  // Wave 3c: another player's vehicle. Every hand-over in the game, which the harness makes for itself, and the one number
  // the rope's pose shares with the peers' own glide.
  ok(main.includes('this.player.grapplePeers = peerBodies().hullBoxes();') && /get peerHulls\(\) \{\s*return self\.grapplePeers;\s*\}/.test(player), "the game hangs the peers' boxes on the player once, and the player hands them to the hook");
  ok(inOrder(markStep, ['v.vehicles = this.world.vehicles;', 'v.peers = p.grapplePeers;', 'g.probeMark(']).ok && harness.includes('probeFrom(g, this.physics, h, d, 0, h, this.filter, this.body, null, 0, this.vehicles, this.peerHulls);'), "the mark's probe is handed the peers' boxes before it runs, in the game and the harness");
  ok(main.includes('this.player.grapple.mayHurtPeer = (id) => combat.mayHurt(id);'), "a slam that came of another player's vehicle asks the fight's own rule whether that player could hurt this one");
  ok(/const k = 1 - Math\.exp\(-dt \/ 0\.1\);\s*r\.group\.position\.lerp\(r\.target, k\);/.test(remotes) && /export const PEER_GLIDE = 0\.1;/.test(frames), "the rope's 'picture' pose and its turn lead the peers' own glide, 1 - exp(-dt / 0.1), by the same constant");
  ok(/pull\(_j: \{ x: number; y: number; z: number \}, _at: \{ x: number; y: number; z: number \}\): void \{\}/.test(frames) && /takesPull\(\): boolean \{\s*return false;\s*\}/.test(frames.slice(frames.indexOf('export class PeerHullSource'))), "another player's vehicle takes no pull and its pull does nothing: it is a picture here");
  ok(!/peerBodies|remoteBodies|remotePlayers/.test(frames) && !/from '\.\.\/net\//.test(grapple), "the rope reads the peers only through the list it is handed, never the peers' own records");
  const bodies = read('../../../src/net/remoteBodies.ts');
  ok(/!p\.shipMount && !p\.shipDocked/.test(bodies) && /rv\.mount = def\.source === 'creature';/.test(remotes), "hullBoxes leaves out a mount (the garage def's own test) and a hull docked onto another");
  // The list's moments: every state's own (`performance.now()` as the message is handled, copied by `viewOf`), and the frame's
  // clock the game read at its start, handed to the peers before they are moved. Nothing on the peers' path or the rope's
  // reads a clock of its own: read in `hullOf`, a fresh number every frame for every player riding anything.
  const viewOf = method(remotes, '  private viewOf(');
  ok(
    ['v.shipTarget.copy(rv.target);', 'v.shipTargetQ.copy(rv.targetQ);', 'v.shipVel.copy(rv.vel);', 'v.shipHeardAt = rv.heardAt;', 'v.shipMount = rv.mount;', 'v.shipDocked = rv.dock !== null;', 'v.shipHeardAt = 0;'].every((s) => viewOf.includes(s)),
    "the peer view carries the ride's state as heard -- its place, turn, the relay's velocity and the moment, in milliseconds -- and says none heard with no ride",
  );
  ok(/h\.heardAt = p\.shipHeardAt \/ 1000;/.test(bodies) && /stampHulls\(ms: number\): void \{\s*this\.hullSet\.stamp = ms \/ 1000;\s*\}/.test(bodies), "hullBoxes keeps each state's moment and the list's stamp in seconds, the stamp handed in");
  const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/performance\.now|Date\.now/.test(codeOf(bodies)) && !/performance\.now|Date\.now/.test(codeOf(frames)), 'neither the peers\' bodies nor the rope\'s frames read a clock');
  const stepNet = method(main, '  private stepNet(dt: number, frameAt: number): void {');
  ok(inOrder(stepNet, ['peerBodies().stampHulls(frameAt);', 'this.remotes.update(dt);']).ok && /const tFrame = performance\.now\(\);/.test(main) && main.includes('this.stepNet(dt, tFrame);'), "the game stamps the peers' list with the clock its frame read at its start, before the peers are moved");
  ok(/if \(now - this\.lastStateSent < 100\) return;/.test(stepNet) && /export const PEER_SEND = 0\.1;/.test(frames), "the jump test's gap between states is the gap the game sends them at, a tenth of a second");
}

console.log(`\n${checks} checks passed`);
