// Wave 4, item B's hand-overs only the game makes, pinned as text (every behaviour test builds the rest for itself, so a
// line lost from the game alone would pass them all): the player's update and the grapple's harness step the wall climb in
// the same order (the climb's own frame in place of the movement after the hang's, its clocks beside the ledges', the move
// cut short worked out before the ledges' sense and the climb's sense after it), the bracing after the feet and at the end
// of the drift in space, the root's lean put on after the hang's offset; the rig's states; the peers' lists, their wall and
// bracing passes and their one limbs' solve; the console's helper; the pack's clips; the Controls page's words; and every
// number of the table on a slider.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './oldModules.ts';
import { CLIMB_GROUPS } from '../../../src/anim/climbDials.ts';
import { CLIMB_CHOICES, CLIMB_RANGES, CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { WALL_STATES } from '../../../src/player/wallClimb.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (p: string) => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const player = read('src/player/player.ts');
const harness = read('tools/swg/tests/grappleBody.ts');
const order = (text: string, marks: string[]): boolean => {
  let at = -1;
  for (const m of marks) {
    const i = text.indexOf(m, at + 1);
    if (i < 0) return false;
    at = i;
  }
  return true;
};
const body = (text: string, head: string): string => {
  const i = text.indexOf(head);
  if (i < 0) return '';
  const end = text.indexOf('\n  }\n', i);
  return text.slice(i, end < 0 ? undefined : end);
};

// ---- the update and the harness, in the same order ---------------------------------------------------------------------
ok(order(player, ['if (this.ledge.holding) {\n      this.hangFrame(dt, input, cam, world);', 'if (this.wall.holding) {\n      this.wallFrame(dt, input, cam, world);', 'const g = world.planet.gravity;']), "the player's update: the hang's frame, then the wall's, in place of the movement, before it");
ok(order(harness, ['if (this.ledge.holding) {\n      this.hangFrame(dt);', 'if (this.wall.holding) {\n      this.wallFrame(dt);', 'let mx = 0;']), 'the harness: the same, in the same place');
// A hang the climb handed over to eases the climb's lean out in its own frame (it never runs the clocks after it).
ok(body(player, '  private hangFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {').includes('this.moveAmount += (0 - this.moveAmount) * Math.min(1, dt * 10);\n    // Wave 4, item B: a hang a wall climb handed over eases the climb\'s lean out (the hang never runs the clocks after it).\n    this.wall.tick(dt);\n    this.updateThrown(dt, input, cam);') && body(harness, '  private hangFrame(dt: number, mid = false): void {').includes('} else this.grounded = this.ledge.stood;\n    // Wave 4, item B: a hang a wall climb handed over eases the climb\'s lean out (the player\'s `hangFrame` too).\n    this.wall.tick(dt);\n    this.body.setNextKinematicTranslation('), "every frame of a hang ticks the wall's clocks, in the player and the harness alike (the lean a climb handed over eases out)");
ok(order(player, ['this.ledgeClocks(dt);', 'this.wallBlocked = askH > 1e-8 && mv.x * mv.x + mv.z * mv.z < askH * 0.36;', 'if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {', 'if (this.senseWall(dt, input, move, wasGrounded, atControls)) {\n      this.wallFrame(dt, input, cam, world);']), "the player: the let-go's clocks, the move cut short, the ledges' grab, then the climb's start, after the move");
ok(order(harness, ['if (this.wall.tick(dt)) this.heading = this.wall.turnNow;', 'this.wallBlocked = askH > 1e-8 && mv.x * mv.x + mv.z * mv.z < askH * 0.36;', 'if (this.ledge.sense(', 'if (this.wall.sense(']), 'the harness: the same, in the same order');
ok(body(player, 'private ledgeClocks(').includes('if (this.wall.tick(dt)) this.heading = this.wall.turnNow;'), "the player's let-go clocks tick the wall's too (its lean and offset eased out, the jump off's turn)");
ok(body(player, 'private fillLedgeIn(').includes('li.blocked = this.wallBlocked;') && body(harness, 'private fillLedgeIn(').includes('li.blocked = this.wallBlocked;'), 'both hand the climb whether the move was cut short');
ok(order(player, ['this.placeVisual();\n    this.placeFeet(dt);', 'this.placeBrace(dt, world, false);']), "the bracing after the feet, at the end of the player's frame on foot");
ok(order(body(player, 'private evaUpdate('), ['this.rig?.update(dt);', 'this.group.updateMatrixWorld(true);', 'this.placeBrace(dt, null, true);']), 'and at the end of the drift in space, after the figure is posed and placed');
ok(order(body(player, 'placeVisual(): void {'), ['if (this.ledge.offset) this.applyLedgeRoot();', 'if (rig && (this.wallRooted || this.wall.drawn)) {', 'this.applyWallRoot();', 'rig.root.quaternion.set(0, 0, 0, 1);']), "placeVisual: the wall's offset and lean on after the hang's (they add in the frame a climb hands over to a lip), the lean put back upright after");
ok(player.includes("this.ledge.reset('stood elsewhere');\n    this.wall.reset('stood elsewhere');\n    this.brace.reset();\n    this.limbs.reset();"), 'stood somewhere new, nothing holds a wall and no hand braces');
ok(body(player, 'private feetOff(').includes("if (this.wall.holding) this.wall.reset('off the feet');"), 'off the feet for any other reason, the wall lets go');
ok(body(player, 'get climbHolds(').includes('return this.ledge.holding || this.wall.holding;'), "on a wall the hands are full: the fight muted and the grapple refused (the ledges' own `climbHolds`)");
ok(body(player, 'private takenByLedge(').includes('this.brace.reset();'), "a grab lets the bracing go (the hang has the hands)");
ok(order(body(player, 'private wallFrame('), ['W.step(this.physics.world as unknown as LedgeWorld, this, li, this.loco.stamina, this.ledge);', 'if (this.ledge.holding) {\n      this.animateHang(dt);\n      this.placeVisual();\n      this.placeHangLimbs();', 'this.animateWall(dt);\n      this.placeVisual();\n      this.placeWallLimbs();']), "the wall's frame: the climb's step, then the hang's look on the frame it hands over, else the climb's");

// ---- the rig, the peers, the console, the pack, the Controls page ------------------------------------------------------------
const rig = read('src/player/rig.ts');
ok(WALL_STATES.every((s) => rig.includes(`| '${s}'`) && rig.includes(`  ${s}: ['mx_climbing_`)) && WALL_STATES.every((s) => s.length <= 32), `the rig knows the climb's five states (${WALL_STATES.join(', ')}), each within the relay's 32 characters`);
const peers = read('src/net/remotePlayers.ts');
const lists = peers.match(/const (OFF_FEET|STATES): Set<string> = new Set\(\[[^\]]*\]\)/g) ?? [];
ok(lists.length === 2 && lists.every((l) => WALL_STATES.every((s) => l.includes(`'${s}'`))), "the peers' state list and their off-the-feet list both carry the climb's states");
ok(peers.includes('if (!r.hang) r.hang = new PeerHang(makeFootRay, makeHangCapsule, limbsOf(r));') && peers.includes('if (!r.wall) r.wall = new PeerWall(makeFootRay, makeHangCapsule, limbsOf(r));') && peers.includes('const lp = limbsOf(r);'), "a figure's hang, wall and bracing share its one limbs' solve (a rig has one hook)");
ok(order(peers, ['if (rig && r.hang) r.hang.undo(rig.root);', 'if (rig && r.wall) r.wall.undo(rig.root);']), "the wall's offset and lean come off a figure's root before anything writes it again");
ok(order(peers, ['if (isWallState(state)) {', 'PEER_WALL.rate = wallRateOf(state, figureScaleOf(rig));', 'rig.setState(state, 0, null, PEER_WALL);']), "a figure on a wall plays the climb's clip at the rate its state's speed asks");
ok(order(peers, ['r.hang.step(rig, fw as unknown as never, hq);', 'r.wall.step(rig, fw as unknown as never, hq);', 'B.step(fw as unknown as never, bi, crowd);', 'lp.place(rig, fw as unknown as never, null);']), "the peers' passes: the hang's, the wall's, then the bracing's");
const main = read('src/main.ts');
ok(body(main, 'private climbDebug(').includes('wall: p.wall.report(),') && body(main, 'private climbDebug(').includes('brace: p.brace.report(),') && main.includes("if (typeof o.wall === 'boolean') words.push(...tuneClimb({ wall: o.wall ? 'on' : 'before' }));"), '`__debug.climb()` reports the wall and the bracing and switches each');
ok(order(main, ['this.remotes.cameraAt.copy(this.cam.camera.position);', 'this.remotes.playerKnown = ', 'this.remotes.playerAt.copy(this.player.pos);', 'this.remotes.update(dt);']), 'the peers are told where this player stands (for their hands to brace on) before their pass');
const packText = read('src/anim/mixamoPack.ts');
ok(packText.includes('...LEDGE_IDS, ...WALL_IDS]') && packText.includes('if (STAIR_IDS.includes(id) || WALL_IDS.includes(id)) return {'), 'the game asks the pack for both wall clips, fitted as loops with their climb taken out');
const menu = read('src/ui/menu.ts');
ok(menu.includes("forward: 'Move forward (held into a steep face: climb it; on a wall: up; hanging: the way you look, up a ladder-like hold or showing a hop for Space)'") && menu.includes("crouch: 'Crouch (tap moving: roll; on a wall: let go; hanging: a tap drops to the lip beneath, held lets go; under a low roof: duck further)'") && menu.includes("jump: 'Jump (hold: Force jump; on a wall or a ledge: climb up, hop, jump off; hanging: takes the hop shown, else a small jump off)'"), "the Controls page says what the move keys, the jump and the crouch do on a wall or a ledge (no key of its own)");

// ---- every number on a slider, and the switches --------------------------------------------------------------------------------
resetClimbTune();
const dialed = new Set(CLIMB_GROUPS.flatMap((g) => g.dials.map((d) => d.key.replace(/^tune\./, ''))));
const mine = Object.keys(CLIMB_RANGES).filter((k) => /^(wall|brace)/.test(k));
ok(mine.length >= 13 && mine.every((k) => dialed.has(k)), `every number of the wall climb and the bracing is a slider under \`climb\` (${mine.length})`);
ok(['wall', 'brace.rule', 'brace.people'].every((k) => dialed.has(k) && !!CLIMB_CHOICES[k]), 'and the switches: climb.wall, brace.rule, brace.people');
ok(CLIMB_TUNE.wall === 'on' && CLIMB_TUNE.brace.rule === 'on' && CLIMB_TUNE.brace.people === 'on', "each ships 'on' (the brief's)");
console.log(`wallWiring: ${checks} checks passed`);
