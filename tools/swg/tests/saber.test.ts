// The saber move rules that do not need a rig: the leap attacks on a jump press, the standing
// chain working round the quadrants, and the leap cutting a chain short.
import assert from 'node:assert/strict';
import { MOVES, SaberCombat, attackForMovement, jumpAttackFor, type AttackContext, type SaberInput } from '../../../src/combat/saber.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const ground = (over: Partial<AttackContext> = {}): AttackContext => ({ fmove: 0, smove: 0, grounded: true, vy: 0, aboveGround: 0, jumpHeld: false, crouch: false, attack: true, force: 100, ...over });

// --- the leap attacks on a fresh jump press
ok(jumpAttackFor('medium', ground({ fmove: 1 }))?.move === 'A_FLIP_SLASH', 'medium, forward: the flip slash');
ok(jumpAttackFor('strong', ground({ fmove: 1 }))?.move === 'A_JUMP_T2B', 'strong, forward: the leap into the overhead');
ok(jumpAttackFor('dual', ground({ fmove: 1 }))?.move === 'JUMPATTACK_DUAL', 'dual, forward: the double leap');
ok(jumpAttackFor('staff', ground({ fmove: 1 }))?.move === 'JUMPATTACK_STAFF_RIGHT', 'staff, forward: the butterfly');
ok(jumpAttackFor('fast', ground({ fmove: 1 })) === null, 'fast has no forward leap (its special is the crouched lunge)');
ok(jumpAttackFor('medium', ground({ smove: 1 }))?.move === 'JUMPATTACK_ARIAL_RIGHT', 'sideways: the cartwheel');
ok(jumpAttackFor('staff', ground({ smove: -1 }))?.move === 'BUTTERFLY_LEFT', 'staff sideways: its butterfly');
ok(jumpAttackFor('staff', ground({ fmove: -1 }))?.move === 'A_BACKFLIP_ATK', 'staff, back: the backflip attack');
ok(jumpAttackFor('medium', ground({ fmove: -1 })) === null, 'back with a single saber: nothing');
ok(jumpAttackFor('medium', ground({ fmove: 1, attack: false })) === null, 'attack must be held');
ok(jumpAttackFor('medium', ground({ fmove: 1, force: 10 })) === null, 'and the Force must be there');
ok(jumpAttackFor('medium', ground({ fmove: 1, grounded: false, aboveGround: 3, vy: 2 })) === null, 'not from high in the air');
ok(jumpAttackFor('medium', ground({ fmove: 1, grounded: false, aboveGround: 0.5, vy: 2 }))?.move === 'A_FLIP_SLASH', 'but just off the ground is fine');

// --- the standing chain
ok(attackForMovement('medium', ground(), 'READY').move === 'A_T2B', 'from ready, standing still: the overhead');
const after = attackForMovement('medium', ground(), 'A_T2B').move;
ok(after === 'A_BR2TL', `after the overhead (ending at the bottom) the next swing starts there: ${after}`);
ok(MOVES.get(after)!.start === MOVES.get('A_T2B')!.end || MOVES.get('A_T2B')!.end === 'B', 'the chain continues from where the last swing ended');
ok(attackForMovement('medium', ground({ fmove: 1 }), 'A_BR2TL').move === 'A_T2B', 'pushing forward still asks for the overhead');

// --- the leap cuts a chain short
const s = new SaberCombat();
s.style = 'medium';
const noClip = () => null;
const input = (over: Partial<SaberInput> = {}): SaberInput => ({ ...ground(), attackPressed: false, altAttack: false, altAttackPressed: false, rollEnding: false, inSpecialJump: false, ...over });
s.update(0.016, true, input({ attack: false }), noClip);
ok(s.move === 'READY', 'drawn: ready');
s.update(0.016, true, input({ attack: true, attackPressed: true }), noClip);
ok(s.move.startsWith('S_'), `attack held from ready: a wind-up (${s.move})`);
let steps = 0;
while (!s.move.startsWith('A_') && steps++ < 200) s.update(0.016, true, input({ attack: true }), noClip);
ok(s.move.startsWith('A_'), `then the swing (${s.move})`);
const play = s.update(0.016, true, input({ attack: true, fmove: 1, jumpPressed: true }), noClip);
ok(s.move === 'A_FLIP_SLASH' && play?.impulse?.up === 400, 'jump pressed mid-swing with forward and attack held: the flip slash at once, with its leap');
ok(s.update(0.016, true, input({ attack: true, fmove: 1, jumpPressed: true }), noClip) === null, 'pressing again during the special does nothing');

console.log(`${checks} checks passed`);
