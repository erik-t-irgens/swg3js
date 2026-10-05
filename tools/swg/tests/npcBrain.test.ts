// A creature's mind crossing between browsers when it changes hands.
//
// Until now a hand-over carried where a creature was and what it looked like doing, and nothing of
// what it was thinking: the target it was fighting, where it was walking and everything on it were
// dropped at the boundary and started fresh on the new keeper. A creature led away from a fight by
// a stun would shrug the stun off as it crossed and walk back into it.
//
// The rules that can be run headless are the wire's own cleaning, which is the server's, and the
// shape of what the browser writes, which is read as text because the two live in different files
// and neither would fail to compile if it drifted from the other.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanNpcBrain, cleanNpcRow, NPC_WIRE } from '../../../server/npcWire.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ what the server lets through
{
  ok(cleanNpcBrain(undefined) === undefined, 'a row with no mind on it is a row with no mind on it');
  ok(cleanNpcBrain({}) === undefined, 'and an empty one is nothing rather than an object full of noughts');
  ok(cleanNpcBrain([]) === undefined, 'an array is not a mind');

  const b = cleanNpcBrain({ t: 'p', st: 2, sl: 1.5, bd: 7, bs: 4, gx: 100, gz: -200 });
  ok(b?.t === 'p', "a bare 'p' from a browser built before players were named by relay id still crosses");
  ok(cleanNpcBrain({ t: 'p:12' })?.t === 'p:12', 'and a player named by the relay id of their browser crosses as the id-shaped word it is');
  ok(b?.st === 2 && b?.sl === 1.5, 'a stun and a slow cross as the seconds they have left');
  ok(b?.bd === 7 && b?.bs === 4, 'and a burn as how much a second and for how much longer');
  ok(b?.gx === 100 && b?.gz === -200, 'and where it was walking');

  ok(cleanNpcBrain({ t: 'some_creature_id' })?.t === 'some_creature_id', 'another creature crosses as the id every browser knows it by');
  ok(cleanNpcBrain({ t: 'x'.repeat(NPC_WIRE.id + 40) })?.t === undefined, 'an id longer than an id is refused');
  ok(cleanNpcBrain({ t: 42 as never })?.t === undefined, 'and a target that is not a word at all is refused');
}

// ------------------------------------------------------------------ nothing may be made nonsense of
{
  // A cap here is a bound on nonsense rather than a rule, as the damage cap is: the point is that a
  // browser on another build cannot hand somebody a creature stunned for the rest of the evening.
  const wild = cleanNpcBrain({ st: 1e9, sl: -5, bs: 1e9, bd: 1e12, gx: 1e12, gz: -1e12 });
  ok((wild?.st ?? 0) <= NPC_WIRE.timer, `a stun is held to ${NPC_WIRE.timer} s, however long it claims`);
  ok(wild?.sl === undefined, 'a slow of less than nothing is simply not there');
  ok((wild?.bd ?? 0) <= NPC_WIRE.damage, 'a burn is held to what a blow may claim');
  ok(Math.abs(wild?.gx ?? 0) <= NPC_WIRE.reach && Math.abs(wild?.gz ?? 0) <= NPC_WIRE.reach, 'and a goal to somewhere inside the world');

  // A burn with no time left carries no damage either: half a burn is not a burn.
  ok(cleanNpcBrain({ bd: 9 })?.bd === undefined, 'a burn with no seconds on it is not carried');
}

// ------------------------------------------------------------------ it rides on the row itself
{
  const row = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1, b: { t: 'p', st: 3 } });
  ok(row?.b?.t === 'p' && row?.b?.st === 3, "a creature's mind rides on its own row, so a hand-over needs no second word on the wire");
  const bare = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1 });
  ok(bare !== undefined && bare.b === undefined, 'and a browser built before any of this sends a row without one, which is read exactly as it always was');
  const junk = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1, b: 'nonsense' });
  ok(junk !== undefined && junk.b === undefined, 'a mind that is not one is dropped and the rest of the row still arrives');
}

// ------------------------------------------------------------------ the two halves must agree
{
  const mobile = readFileSync(new URL('../../../src/world/mobiles/mobile.ts', import.meta.url), 'utf8');

  // A target cannot cross as a key: every living thing's key is handed out by the browser it was
  // made in, so one browser's number is another browser's rock. A player is named by the relay id of
  // the browser they are at (`targetWord` in npcNet.ts, tested in npcWire.test.ts), never as 'p',
  // which the new keeper read as its own player.
  ok(/npcNow\(\)\?\.nameTarget\(t\.key, /.test(mobile), 'a player is written as the word that means the same person everywhere, never as a key');
  ok(!/t\.key === PLAYER_KEY \? 'p' :/.test(mobile), "and never as the bare 'p' that meant whoever received it");
  ok(/npcId\?: string \}\)\.npcId \?\? ''/.test(mobile), 'and any other creature as the id the world knows it by');
  ok(!/b\.t = t\.key/.test(mobile), 'and never as a key, which would name something else entirely on the browser it arrived at');

  // Kept while driven, applied when it is handed over: a driven copy thinks nothing.
  ok(/this\.heldBrain = row\.b \? copyBrain\(row\.b, this\.heldBrain\) : null;/.test(mobile), 'a driven copy keeps its own copy of the last mind it was told, which costs nothing');
  ok(/this\.adoptBrain\(this\.heldBrain\);/.test(mobile), 'and takes it on at the moment it is asked to do the thinking');
  ok(/this\.heldBrain = null;/.test(mobile), 'and lets it go, so a second hand-over is not given a stale one');

  // Every timer is written as what is left, not as when it ends.
  ok(/b\.st = Math\.round\(this\.stunned \* 100\)/.test(mobile), 'a timer is written as the seconds it has left, because two browsers do not share a moment');

  // The target is looked up where there is a list to look in, and not finding it is ordinary.
  ok(/if \(this\.wantTarget\) this\.takeWantedTarget\(ctx\.targets\);/.test(mobile), "the target is found on the first thought after arriving, where the list of the living is at hand");
  ok(/this\.wantTarget = null;/.test(mobile), 'and asked for once: a target that is not here is not waited for');
}

// ------------------------------------------------------------------ a ship pilot keeping clear
// The NPC ship brain's own rule for keeping clear of another ship moved out of it into `pilot.ts` as
// `pushApart`, a pair at a time, so the shuttles' pilot keeps clear by the very same rule. The brain
// cannot be loaded here (it holds a constructor parameter property and extensionless imports), so the
// pair pull it had is written out below exactly as it stood, three's vectors and all, and the moved
// rule is held to it over a fixed table of meetings: one inside the gap, one on a collision course, a
// dead-centre one, one past the look, one going away and one flying alongside.
{
  const { AVOID_TUNE, pushApart } = await import('../../../src/space/pilot.ts');
  const THREE = await import('three');
  /** The brain's `keepApart` for one other ship, as it was before the rule moved. */
  const oldPull = (pos: InstanceType<typeof THREE.Vector3>, vel: InstanceType<typeof THREE.Vector3>, radius: number, oPos: InstanceType<typeof THREE.Vector3>, oVel: InstanceType<typeof THREE.Vector3>, oRadius: number, want: InstanceType<typeof THREE.Vector3>, shipQuat: InstanceType<typeof THREE.Quaternion>): boolean => {
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    let pulled = false;
    const gap = AVOID_TUNE.separation + radius + oRadius;
    const d2 = oPos.distanceToSquared(pos);
    if (d2 < gap * gap && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      want.addScaledVector(tmp.copy(pos).sub(oPos).divideScalar(d), 3 * (1 - d / gap)).normalize();
      pulled = true;
    }
    if (d2 > AVOID_TUNE.dodgeLook * AVOID_TUNE.dodgeLook) return pulled;
    tmp2.copy(oVel).sub(vel);
    const rv2 = tmp2.lengthSq();
    if (rv2 < 1) return pulled;
    tmp.copy(oPos).sub(pos);
    const tca = -tmp.dot(tmp2) / rv2;
    if (tca <= 0 || tca > AVOID_TUNE.collideSeconds) return pulled;
    tmp.addScaledVector(tmp2, tca);
    const miss = tmp.length();
    const room = radius + oRadius + AVOID_TUNE.dodgeMargin;
    if (miss >= room) return pulled;
    if (miss < 1e-3) tmp.set(0, 1, 0).applyQuaternion(shipQuat);
    else tmp.divideScalar(-miss);
    want.addScaledVector(tmp, 4 * (1 - miss / room)).normalize();
    return true;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const banked = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.7));
  const table: [string, InstanceType<typeof THREE.Vector3>, InstanceType<typeof THREE.Vector3>, number, InstanceType<typeof THREE.Vector3>, InstanceType<typeof THREE.Vector3>, number][] = [
    ['inside the gap', V(0, 100, 0), V(0, 0, 80), 12, V(30, 110, 20), V(0, 0, 80), 20],
    ['on a collision course', V(0, 100, 0), V(0, 0, 120), 12, V(8, 104, 250), V(0, 0, -110), 22],
    ['dead centre', V(0, 100, 0), V(0, 0, 100), 10, V(0, 100, 300), V(0, 0, -100), 10],
    ['past the look', V(0, 100, 0), V(0, 0, 100), 10, V(0, 100, 900), V(0, 0, -300), 10],
    ['going away', V(0, 100, 0), V(0, 0, 100), 10, V(20, 90, -150), V(0, 0, -100), 10],
    ['alongside', V(0, 100, 0), V(0, 0, 100), 10, V(45, 100, 5), V(0, 0, 100.5), 10],
  ];
  let worst = 0;
  const said: string[] = [];
  for (const [name, pos, vel, r, oPos, oVel, oR] of table) {
    const wantOld = V(0.2, -0.1, 1).normalize();
    const wantNew = wantOld.clone();
    const up = V(0, 1, 0).applyQuaternion(banked);
    const a = oldPull(pos, vel, r, oPos, oVel, oR, wantOld, banked);
    const b = pushApart(pos, vel, r, oPos, oVel, oR, wantNew, AVOID_TUNE, up);
    worst = Math.max(worst, wantOld.distanceTo(wantNew));
    said.push(`${name} ${a ? 'pulls' : 'leaves it'}`);
    ok(a === b && wantOld.distanceTo(wantNew) < 1e-12, `a ship ${name}: the moved rule pulls as the brain's did (${a ? 'pulled' : 'not pulled'}, ${wantOld.distanceTo(wantNew).toExponential(1)} apart)`);
  }
  ok(said.filter((s) => s.endsWith('pulls')).length >= 3 && said.some((s) => s.endsWith('leaves it')), `and the table has meetings that pull and meetings that do not (${said.join('; ')})`);
  // The brain now asks the moved rule, and reads its look ahead from the same table.
  const brain = readFileSync(new URL('../../../src/space/npcBrain.ts', import.meta.url), 'utf8');
  ok(/pushApart\(pos, vel, v\.radius, other\.pos, velocityOf\(other, tmp2\), other\.radius, want, AVOID_TUNE, shipUp\)/.test(brain), "the ship brain keeps clear through pushApart, a pair at a time, with the ship's own up");
  ok(!/TUNE\.(separation|dodgeLook|dodgeMargin|collideSeconds|rayEvery|rayAhead|rayMin|avoidSeconds)/.test(brain.replace(/AVOID_TUNE/g, '')), 'and none of the moved numbers is left in its own table');
}

// ------------------------------------------------------------------ a ship pilot's hand on its wings
// The game's AI ships opened their wings the frame they took a target to attack and shut them in every other behaviour.
// Ours fly shut on patrol, open on the think that takes a target, and shut `closeAfter` seconds after the last fight. The
// brain cannot be loaded here (above), so its hand (`NpcWingHand`, `npcFighting` in wings.ts) is driven through the
// states a think leaves it in, one think a tenth of a second, and the brain is read for where it writes the answer.
{
  const { NpcWingHand, WING_AUTO, npcFighting } = await import('../../../src/vehicles/wings.ts');
  const saved = { ...WING_AUTO };
  WING_AUTO.npc = 'target';
  WING_AUTO.closeAfter = 3;
  const hand = new NpcWingHand();
  /** One think: the state and the target it settled on, and what it writes into `WingSet.brain`. */
  const think = (state: string, target: boolean, now: number) => hand.want(npcFighting(state, target), now);
  let now = 0;
  // Every think's answer is kept and every one is asked about, the first included: a hand that started out open would
  // show only there, since it would have shut again long before the last.
  const patrol: (boolean | null)[] = [];
  for (let i = 0; i < 50; i++, now += 0.1) patrol.push(think(i % 2 ? 'formation' : 'patrol', false, now));
  ok(patrol.length === 50 && patrol.every((b) => b === false), `a patrol, leader and wingman alike, leaves every think with its wings shut, the very first included (${patrol.filter((b) => b !== false).length} not shut)`);
  // A target is picked at the top of a think and the state goes to engage in the same think.
  ok(think('engage', true, now) === true, 'the think that takes a target opens them');
  // Each fighting state on its own for longer than the hold, so the hold cannot cover a state the rule has dropped: a
  // fighter fleeing for its twelve seconds would otherwise fold its wings three seconds into the flight.
  for (const state of ['breakoff', 'evade', 'flee', 'engage']) {
    const run: (boolean | null)[] = [];
    for (let i = 0; i < 50; i++) run.push(think(state, true, (now += 0.1)));
    ok(run.every((b) => b === true), `and they stay open through 5 s of ${state} while it holds a target, every think of it (${run.filter((b) => b !== true).length} not open)`);
  }
  const lost = now;
  const seen: (boolean | null)[] = [];
  for (now = lost + 0.1; now < lost + 5; now += 0.1) seen.push(think('formation', false, now));
  const shutAt = lost + 0.1 + 0.1 * seen.indexOf(false);
  ok(seen.indexOf(false) > 0 && seen.slice(0, seen.indexOf(false)).every((b) => b === true) && seen.slice(seen.indexOf(false)).every((b) => b === false), 'with the target lost they stay open for a while and then shut, once, for good');
  ok(Math.abs(shutAt - lost - WING_AUTO.closeAfter) < 0.15, `and they shut ${WING_AUTO.closeAfter} s after the last fight (${(shutAt - lost).toFixed(1)} s)`);
  ok(think('engage', false, now) === false && think('return', false, now) === false, 'a state of fighting with nothing held to fight is not a fight');
  // A hold of nought is the game's own rule: open on the think that fights, shut on the first that does not, and never
  // shut for good (a fight is open outright, not "fought within the hold", which with nought would be never).
  WING_AUTO.closeAfter = 0;
  const quick = new NpcWingHand();
  ok(quick.want(false, 10) === false && quick.want(true, 10.1) === true && quick.want(true, 10.2) === true && quick.want(false, 10.3) === false && quick.want(true, 10.4) === true, 'with `closeAfter` at nought they open on every think that fights and shut on the first that does not, as the game did');
  WING_AUTO.closeAfter = 3;
  WING_AUTO.npc = 'flight';
  ok(think('engage', true, now) === null && think('patrol', false, now) === null, "under the 'flight' rule the brain writes null, and the flight rule has the wings as before");
  Object.assign(WING_AUTO, saved);

  const brainSrc = readFileSync(new URL('../../../src/space/npcBrain.ts', import.meta.url), 'utf8');
  const write = brainSrc.indexOf('v.wings.brain = this.wingHand.want(npcFighting(this.state, this.target !== null), now);');
  const settled = brainSrc.indexOf('switch (this.state) {');
  const stick = brainSrc.indexOf('steerToward(local, ');
  ok(write > 0 && write > settled && write < stick, "the brain writes its hand into the wings once a think, after the state is settled (the switch's own moves included) and before the stick");
  ok(/readonly wingHand = new NpcWingHand\(\);/.test(brainSrc), 'with a hand of its own, kept for its life, so nothing is made a think');
}

console.log(`\n${passed} checks passed`);
