// The rope chain round, maker A: what only the game hands the chains, pinned as text (every behaviour test builds the rest for
// itself through the harness, so a line lost from the game alone would pass every one of them). Files split on /\r?\n/ and read
// with their line endings folded: a working copy may be CRLF.
//  - The player writes the planet's physics steps the frame's step takes for the chains at the top of its update, straight before
//    the ropes nobody holds are swung (`tickRopes`), ahead of every way out of the update; the harness does the same.
//  - `drawRopes` steps and lays the chains first (`stepRopeChains`), and lays each rope's ribbon from its chain's drawn points where
//    the chain is drawn, else as phase 4 did.
//  - `stepRopeChains` hands the chains how far the frame stands past the last step (the planet's physics' `behind`), the trees' and
//    the rain's wind (`FLORA_WIND`, its strength times the water's full wind), and the held rope's drawn hands (each hand's wrist and
//    index knuckle, the joints the rope's tables measure the grip by), only while the swing holds it (a grab or a hang).
//  - The player's chains query the planet's world with a ray and a box made once, every group but the terrain's, their ground the
//    terrain's cached heights (`nearHeightIfCached`: never a read that makes a block).
//  - The frame loop and `__debug.advance` both call `drawRopes` after the physics' step; the console's climb report says the chains.
//  - The round's other setting puts back through `climbPolesBefore` (so every older digest's chain of puts back holds).
//
// Run: node tools/swg/tests/climbRopeChainWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIMB_ROPELOOK_BEFORE, CLIMB_TUNE, climbPolesBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { ROPE_JOINTS } from '../../../src/anim/ropeClips.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').split(/\r?\n/).join('\n');
const player = read('../../../src/player/player.ts');
const harness = read('./grappleBody.ts');
const main = read('../../../src/main.ts');

/** A method's body: from its signature's line to the first line that is its closing brace at its own indent. */
function body(text: string, sig: string): string {
  const at = text.indexOf(sig);
  assert.ok(at >= 0, `found ${sig}`);
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const indent = text.slice(lineStart, at).match(/^\s*/)![0];
  const end = text.indexOf(`\n${indent}}\n`, at);
  return text.slice(at, end);
}

ok(/this\.ropeChains\.steps = this\.chainPhysics\.stepsAhead\(dt\);\n\s*this\.rope\.tickRopes\(dt\);/.test(player), "the player's update writes the planet's physics steps for the chains straight before `tickRopes`");
const upd = body(player, '  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {');
ok(upd.indexOf('this.ropeChains.steps = ') >= 0 && upd.indexOf('this.ropeChains.steps = ') < upd.indexOf('return;'), '... ahead of every way out of the update');
ok(/this\.ropeChains\.steps = this\.physics\.stepsAhead\(dt\);\n\s*this\.rope\.tickRopes\(dt\);/.test(harness), 'the harness does the same at the top of its frame');
const draw = body(player, '  drawRopes(camera: THREE.PerspectiveCamera, screenH: number): void {');
ok(draw.indexOf('const chained = this.stepRopeChains();') >= 0 && draw.indexOf('const chained = this.stepRopeChains();') < draw.indexOf('for (let i = 0; i < list.length; i++)'), '`drawRopes` steps and lays the chains before it lays any ribbon');
// (Maker B: the chain is drawn as its own strip through its curve, `drawChained`, the straight ribbon hidden; else phase 4's ribbon.)
ok(/if \(chained && strip && drawChained\(r, strip, this\.ropeCurve, camera, screenH\)\) \{\n\s*if \(ribbon\.mesh\.visible\) ribbon\.hide\(\);\n\s*continue;\n\s*\}\n\s*if \(strip && strip\.mesh\.visible\) strip\.hide\(\);\n\s*ropeEnd\.x = r\.endX;[\s\S]*?ribbon\.lay\(r\.pts, r\.count, ropeEnd, camera\);/.test(draw), "... each rope drawn as its chain's strip where the chain is drawn (the straight ribbon hidden), else its ribbon from phase 4's points (the strip hidden)");
const step = body(player, '  private stepRopeChains(): boolean {');
ok(step.includes('C.behind = this.chainPhysics.behind;'), "`stepRopeChains` hands the chains the planet's physics' `behind`");
ok(step.includes('W.x = FLORA_WIND.x;') && step.includes('W.z = FLORA_WIND.z;') && step.includes('W.speed = FLORA_WIND.strength * WATER_WIND_FULL;'), "... the trees' and the rain's wind (`FLORA_WIND`, its strength times the water's full wind)");
const joints = ROPE_JOINTS.slice(1, 5);
ok(joints.every((j) => step.includes(`rig.boneNamed('${j}')`)), `... the held rope's drawn hands from the joints the rope's tables measure the grip by (${joints.join(', ')})`);
ok(/R\.phase === ROPE_GRAB \|\| R\.phase === ROPE_HANG/.test(step) && step.includes('C.hands = 2;') && step.includes('C.handsRope = held;'), '... only while the swing holds the rope (a grab or a hang), naming the rope held');
ok(step.indexOf('C.frame(R.ropes);') > step.indexOf('C.hands = 2;'), '... and steps them after the hands are handed in');
ok(/chains\.world = physics\.world as unknown as ChainWorld;/.test(player) && /chains\.ray = new RAPIER\.Ray\(/.test(player) && /chains\.box = new RAPIER\.Cuboid\(/.test(player), "the player's chains query the planet's world with a ray and a box made once");
ok(/chains\.filter = groups\(Group\.all, Group\.all & ~Group\.terrain\);/.test(player), '... every group but the terrain\'s');
const ground = body(player, '  private chainGround(q: ChainAsk): boolean {');
ok(ground.includes('nearHeightIfCached(q.x, q.z)') && !ground.includes('heightAt('), "... their ground the terrain's cached heights alone (never a read that makes a block)");
const frameDraws = (main.match(/(?<!\.)player\.drawRopes\(this\.cam\.camera, window\.innerHeight\);/g) ?? []).length;
const advanceDraws = main.split('this.player.drawRopes(this.cam.camera, window.innerHeight);').length - 1;
ok(frameDraws === 1 && advanceDraws === 1, 'the frame loop and `__debug.advance` each call `drawRopes` once');
ok(/this\.physics\.step\(dt\);[\s\S]{0,1200}this\.player\.drawRopes\(this\.cam\.camera, window\.innerHeight\);/.test(main), '... `__debug.advance` after its physics step');
ok(main.includes('ropeChain: p.ropeChains.report(p.rope.ropes),'), "the console's climb report says the chains");
resetClimbTune();
climbPolesBefore();
ok(Object.entries(CLIMB_ROPELOOK_BEFORE).every(([k, v]) => (CLIMB_TUNE as unknown as Record<string, unknown>)[k] === v), "`climbPolesBefore` puts the round's switches back to their other settings (so every older digest's chain holds)");
resetClimbTune();
ok(CLIMB_TUNE.ropeLook === 'chain', "and the round ships 'chain'");
console.log(`climbRopeChainWiring: ${checks} checks passed`);
