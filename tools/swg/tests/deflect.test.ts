// Blocking bolts with the saber: who may block, where the parry is chosen from, and where a
// blocked bolt goes at each defence rank.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { canBlock, inFront, parryClip, parryZone, reflectDirection, DEFLECT_SCATTER } from '../../../src/combat/deflect.ts';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- who may block
ok(canBlock({ blocking: true, saberOn: true, inHand: true, attacking: false, special: false, rank: 1 }), 'a lit saber in hand blocks while the block is held');
ok(!canBlock({ blocking: false, saberOn: true, inHand: true, attacking: false, special: false, rank: 3 }), 'nothing is blocked without holding the block');
ok(!canBlock({ blocking: true, saberOn: false, inHand: true, attacking: false, special: false, rank: 3 }), 'a saber that is off does not');
ok(!canBlock({ blocking: true, saberOn: true, inHand: false, attacking: false, special: false, rank: 3 }), 'a thrown saber does not');
ok(!canBlock({ blocking: true, saberOn: true, inHand: true, attacking: false, special: true, rank: 3 }), 'not in the middle of a flip or a roll');
ok(!canBlock({ blocking: true, saberOn: true, inHand: true, attacking: true, special: false, rank: 2 }), 'not mid-swing below the top rank');
ok(canBlock({ blocking: true, saberOn: true, inHand: true, attacking: true, special: false, rank: 3 }), 'mid-swing is fine at the top rank');
ok(!canBlock({ blocking: true, saberOn: true, inHand: true, attacking: false, special: false, rank: 0 }), 'no defence rank, no block');

// --- in front of the view
const eye = v(0, 1.55, 0);
const fwd = v(0, 0, 1);
ok(inFront(v(0, 1.2, 5), eye, fwd), 'a bolt ahead is in front');
ok(!inFront(v(0, 1.2, -5), eye, fwd), 'a bolt from behind is not');
ok(!inFront(v(5, 1.2, 0.5), eye, fwd), 'one from the side is not (0.2 threshold)');
ok(inFront(v(1, 1.2, 4), eye, fwd), 'one ahead and a little to the side is');

// --- where the parry comes from
const right = v(1, 0, 0);
ok(parryZone(v(0, 1.6, 1), eye, right) === 'top', 'at eye height, ahead: top');
ok(parryZone(v(1, 1.6, 1), eye, right) === 'upperRight', 'at eye height, to the right: upper right');
ok(parryZone(v(-1, 1.6, 1), eye, right) === 'upperLeft', 'at eye height, to the left: upper left');
ok(parryZone(v(0.05, 1.2, 1), eye, right) === 'upperRight', 'a little below the eyes: upper, to the nearer side');
ok(parryZone(v(-0.05, 1.2, 1), eye, right) === 'upperLeft', 'a little below the eyes, left of centre: upper left');
ok(parryZone(v(0.3, 0.6, 1), eye, right) === 'lowerRight', 'well below: lower right');
ok(parryZone(v(-0.3, 0.6, 1), eye, right) === 'lowerLeft', 'well below, left: lower left');

// --- which clip
const all = new Set(['BOTH_P1_S1_T_', 'BOTH_P1_S1_TR', 'BOTH_P6_S6_T_', 'BOTH_P7_S7_BL']);
const has = (c: string) => all.has(c);
ok(parryClip('medium', 'top', has) === 'BOTH_P1_S1_T_', 'the single styles share the P1 set');
ok(parryClip('dual', 'top', has) === 'BOTH_P6_S6_T_', 'the dual sabers use their own');
ok(parryClip('dual', 'upperRight', has) === 'BOTH_P1_S1_TR', 'and fall back to the single set for a zone they lack');
ok(parryClip('staff', 'lowerLeft', has) === 'BOTH_P7_S7_BL', 'the staff uses its own');
ok(parryClip('fast', 'lowerLeft', has) === null, 'nothing when neither set has the zone');

// --- where a blocked bolt goes
const out = v(0, 0, 0);
const incoming = v(0, 0, -1);
const look = v(0.6, 0, 0.8);
const noRandom = () => 0;
reflectDirection(3, incoming, look, out, noRandom);
ok(out.distanceTo(look) < 1e-6, 'rank 3 sends it where the player looks');
reflectDirection(2, incoming, look, out, noRandom);
ok(out.distanceTo(v(0, 0, 1)) < 1e-6, 'rank 2 turns it straight back');
reflectDirection(1, incoming, look, out, () => 1);
ok(Math.abs(out.length() - 1) < 1e-6, 'the result is unit length');
ok(out.x > 0.3 && out.y > 0.3, 'and rank 1 scatters it widely');
reflectDirection(2, incoming, look, out, () => 1);
ok(out.x < 0.25 && out.x > 0.1, 'rank 2 scatters it less');
ok(DEFLECT_SCATTER[1] > DEFLECT_SCATTER[2] && DEFLECT_SCATTER[2] > DEFLECT_SCATTER[3], 'scatter shrinks with rank');
reflectDirection(2, v(0, 0, 1), look, out, () => -1e-9);
ok(Math.abs(out.length() - 1) < 1e-6, 'a degenerate scatter still gives a direction');

console.log(`${checks} checks passed`);
