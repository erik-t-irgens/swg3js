// The people who follow the player (src/world/followers.ts): where each walks, what its decision becomes,
// whom it fights, and how it is taken on, asked to stop and handed back -- the pure half the game runs,
// driven with bodies written in this file.
//
// Four things are pinned, and the fourth is the one an edit elsewhere would break without a sound:
// **the places** behind the player, **the decision** kept to them (the brain's own fight left alone),
// **the set's bookkeeping** (what a body was, what it becomes, what it goes back to, and who takes it
// away), and **the wiring**: a follower never turns on the player, the player walks through it, the
// standing people do not put it down, and the use key's rules offer to talk to it -- each read out of the
// source that has to say so, since those files load three and cannot be run here.
//
// Synthetic throughout: every body, place and number below is written here or read out of the module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOLLOW_TUNE, FollowerSet, keepFollow, slotOf, tuneFollow, type FollowOrder, type FollowerBody } from '../../../src/world/followers.ts';
import type { Decision, Post } from '../../../src/world/mobiles/brain.ts';
import type { Aggression, Living, Side } from '../../../src/combat/kit.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** The player, as the set is handed them: a place that moves and a key. */
function leader(x = 0, z = 0): Living {
  return { key: 1, label: 'you', side: 'player', aggression: 'aggressive', pos: { x, y: 0, z } as never, halfHeight: 0.9, dead: false, damage: () => {}, radiusToward: () => 0.35 } as unknown as Living;
}

/** A body the set can take on, with a record of what was done to it. */
interface Body extends FollowerBody {
  pos: { x: number; y: number; z: number };
  heading: number;
  dead: boolean;
  removed: boolean;
  canFight: boolean;
  provoked: Living[];
  unfollowed: number;
}
let nextKey = 10;
function person(over: Partial<Body> = {}): Body {
  const post: Post = { kind: 'still', heading: 0.7, tune: { postRadius: 3, postEvery: [8, 20] } };
  const b: Body = {
    key: nextKey++,
    label: 'somebody',
    pos: { x: 5, y: 0, z: 5 },
    heading: 0.4,
    dead: false,
    removed: false,
    canFight: true,
    side: 'civilian' as Side,
    aggression: 'passive' as Aggression,
    essential: true,
    post,
    patrol: { round: true },
    homeX: 5,
    homeZ: 5,
    follow: null,
    provoked: [],
    unfollowed: 0,
    provoke(a: Living) {
      this.provoked.push(a);
    },
    unfollow() {
      this.unfollowed++;
    },
    ...over,
  };
  return b;
}

/** The set, with deps that record what they were asked. */
function aSet(): { set: FollowerSet<Body>; removed: Body[]; through: Map<Body, boolean>; said: string[] } {
  const set = new FollowerSet<Body>();
  const removed: Body[] = [];
  const through = new Map<Body, boolean>();
  const said: string[] = [];
  set.deps = { remove: (b) => removed.push(b), walkThrough: (b, on) => through.set(b, on), say: (t) => said.push(t) };
  return { set, removed, through, said };
}

/** A decision as the brain hands one back, with anything a case changes laid over it. */
function decision(over: Partial<Decision> = {}): Decision {
  return { state: 'idle', targetKey: null, moveTo: null, pace: 'stand', posture: 'stand', cover: false, face: null, attack: null, emote: null, wanderAt: 0, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, clearMemory: false, ...over };
}

/** An order as the set writes one, for the decision's own checks. */
function order(over: Partial<FollowOrder> = {}): FollowOrder {
  return { leader: leader(), index: 0, slotX: 0, slotZ: -2, leaderX: 0, leaderZ: 0, heading: 0, run: false, spot: { x: 0, z: 0 }, look: { x: 0, z: 0 }, parked: false, parkX: 0, parkZ: 0, stuckSeen: 0, ...over };
}

// --- 1: the places behind the player ------------------------------------------------------------------

{
  const at = { x: 0, z: 0 };
  // Walking along +z (heading 0): forward is +z, the body's left is +x.
  slotOf(0, 0, 0, 0, at);
  ok(near(at.x, FOLLOW_TUNE.side) && near(at.z, -FOLLOW_TUNE.back), `the first follows ${FOLLOW_TUNE.back} m behind and ${FOLLOW_TUNE.side} m to the left`);
  slotOf(1, 0, 0, 0, at);
  ok(near(at.x, -FOLLOW_TUNE.side) && near(at.z, -FOLLOW_TUNE.back), 'the second beside it on the right');
  slotOf(2, 0, 0, 0, at);
  ok(near(at.x, FOLLOW_TUNE.side) && near(at.z, -FOLLOW_TUNE.back - FOLLOW_TUNE.row), `the third a row further back, ${FOLLOW_TUNE.row} m`);
  // Turned a quarter to the right (heading pi/2: walking along +x), the places turn with the walk.
  slotOf(0, 10, 20, Math.PI / 2, at);
  ok(near(at.x, 10 - FOLLOW_TUNE.back, 1e-9) && near(at.z, 20 - FOLLOW_TUNE.side, 1e-9), 'and they turn with the way the player walks, about the player');
  ok(slotOf(0, 0, 0, 0, at) === at, 'written into the point handed in');
}

// --- 2: a decision kept to its place ------------------------------------------------------------------

{
  // A fight, a flight and the run back past the leash are the brain's own and are left exactly as they are
  // (the run back while it is still more than `settle` from the leader).
  for (const [what, d] of [
    ['a fight', decision({ state: 'attack', targetKey: 7, attack: 'melee' })],
    ['a chase', decision({ state: 'chase', targetKey: 7, pace: 'run', moveTo: { x: 30, z: 30 } })],
    ['a flight', decision({ state: 'flee', pace: 'run', moveTo: { x: 9, z: 9 } })],
    ['the run back past the leash', decision({ state: 'return', pace: 'run', moveTo: { x: 0, z: -2 } })],
  ] as const) {
    const before = JSON.stringify(d);
    keepFollow(d, { x: 20, z: 20 }, order());
    ok(JSON.stringify(d) === before, `${what} is the brain's and is left alone`);
  }
  // Far from its place: walk there, and run when far or when the player runs.
  const o = order({ slotX: 0, slotZ: -2 });
  const d = decision({ state: 'wander', goal: { x: 40, z: 40 }, moveTo: { x: 40, z: 40 }, face: { x: 40, z: 40 }, pace: 'walk', emote: 'idle' });
  keepFollow(d, { x: 4, z: -2 }, o);
  ok(d.state === 'wander' && d.moveTo === o.spot && d.goal === o.spot && d.face === o.spot && o.spot.x === 0 && o.spot.z === -2, "the brain's own wander becomes a walk to its place, written into the order's own point");
  ok(d.pace === 'walk' && d.emote === null, 'a walk, with no fidget over it');
  keepFollow(d, { x: FOLLOW_TUNE.run + 1, z: -2 }, o);
  ok(d.pace === 'run', `and a run from more than ${FOLLOW_TUNE.run} m off`);
  const running = order({ run: true });
  const d2 = decision();
  keepFollow(d2, { x: 4, z: -2 }, running);
  ok(d2.pace === 'run', 'and a run whenever the player is running');
  // At its place: stand, looking the way the player walks.
  const d3 = decision({ state: 'wander', goal: { x: 1, z: 1 }, moveTo: { x: 1, z: 1 }, pace: 'walk' });
  keepFollow(d3, { x: 0.5, z: -2 }, order({ heading: Math.PI / 2 }));
  ok(d3.state === 'idle' && d3.moveTo === null && d3.goal === null && d3.pace === 'stand', 'at its place it stands');
  ok(!!d3.face && near(d3.face.x, 1.5) && near(d3.face.z, -2), 'looking the way the player walks');
  // Near enough the player and not in front of them counts as there, so a wall across its place does not
  // have it walk round and round the player; in front of them, or on top of them, does not.
  const d4 = decision();
  keepFollow(d4, { x: 1.5, z: -1 }, order({ slotX: 0, slotZ: -2.2 }));
  ok(d4.state === 'idle', `within ${FOLLOW_TUNE.settle} m of the player and not ahead of them, it stands where it is`);
  const d5 = decision();
  keepFollow(d5, { x: 0.2, z: 2 }, order({ slotX: 0, slotZ: -2.2 }));
  ok(d5.state === 'wander', 'in front of the player it walks back to its place: it stays out of their way');
  // The run back past the leash is the brain's until the follower is beside the leader again, where it
  // stands rather than running on at a place it may never reach.
  const d6 = decision({ state: 'return', pace: 'run', moveTo: { x: 0, z: -2.2 } });
  keepFollow(d6, { x: 1, z: -1 }, order({ slotX: 0, slotZ: -2.2 }));
  ok(d6.state === 'idle' && d6.pace === 'stand', 'back beside the leader, the run back ends where it stands');
  // A place a wall stands on: stuck trying to reach it beside the leader, it stands where it is -- in
  // front of the player or not -- until the leader moves on, and then tries again.
  const o7 = order({ slotX: -1.3, slotZ: -2.2, stuckSeen: 0 });
  const d7 = decision();
  keepFollow(d7, { x: 0.2, z: 1.5, stuck: 0 }, o7);
  ok(d7.state === 'wander' && !o7.parked, 'ahead of the player, it makes for its place');
  const d8 = decision();
  keepFollow(d8, { x: 0.2, z: 1.5, stuck: 1 }, o7);
  ok(d8.state === 'idle' && o7.parked, 'found stuck beside the player, it gives the place up and stands where it is');
  const d9 = decision();
  keepFollow(d9, { x: 0.2, z: 1.5, stuck: 1 }, o7);
  ok(d9.state === 'idle' && o7.parked, 'and keeps standing there while the player stays put');
  o7.leaderX += FOLLOW_TUNE.turn + 0.2;
  const d10 = decision();
  keepFollow(d10, { x: 0.2, z: 1.5, stuck: 1 }, o7);
  ok(!o7.parked && d10.state === 'wander', 'until the player moves on, when it makes for its place again');
  const far = order({ slotX: 40, slotZ: 40, stuckSeen: 0 });
  keepFollow(decision(), { x: 20, z: 20, stuck: 5 }, far);
  ok(!far.parked, 'stuck far from the leader is the brain’s own stuck, and nothing is given up for it');
  // A body that joins with a stuck count of its own is not taken as stuck the first time it is asked.
  const fresh = order({ slotX: -1.3, slotZ: -2.2, stuckSeen: Number.POSITIVE_INFINITY });
  keepFollow(decision(), { x: 0.2, z: 1.5, stuck: 46 }, fresh);
  ok(!fresh.parked && fresh.stuckSeen === 46, 'a count carried in from before it followed is only noted');
}

// --- 3: taken on, asked to stop, handed back -----------------------------------------------------------

{
  const { set, through } = aSet();
  const you = leader();
  const b = person();
  const post = b.post;
  ok(set.add(b, 'stood', you, 0) === null && set.count === 1 && set.following(b) && set.holds(b), 'a person asked to follow follows');
  ok(b.side === 'player' && b.aggression === 'defensive' && b.essential === false, "it takes the player's side and answers blows, and it may be struck now");
  ok(b.post === null && b.patrol === null && b.follow !== null && b.follow.leader === you, 'it keeps no post and walks no round, and is told whom it follows');
  ok(through.get(b) === true, 'and the player walks through it');
  ok(set.add(b, 'stood', you, 0) === 'already following you' && set.count === 1, 'asked again it is already following');
  // Somebody with nothing to fight with keeps its passive temper: it follows and does not fight.
  const unarmed = person({ canFight: false });
  set.add(unarmed, 'own', you, 0);
  ok(unarmed.aggression === 'passive', 'somebody with nothing to fight with follows and keeps out of fights');
  // The most who may follow.
  for (let i = set.count; i < FOLLOW_TUNE.most; i++) set.add(person(), 'own', you, 0);
  ok(set.full && set.add(person(), 'own', you, 0) === 'you have as much company as you can take' && set.count === FOLLOW_TUNE.most, `no more than ${FOLLOW_TUNE.most} at once, refused in words`);
  // The dead and the gone cannot be taken on.
  const { set: s2 } = aSet();
  ok(s2.add(person({ dead: true }), 'own', you, 0) === 'gone' && s2.add(person({ removed: true }), 'own', you, 0) === 'gone', 'the dead and the gone cannot follow anybody');

  // Asked to stop: what it was comes back, at the spot it stands on now.
  b.pos.x = 33;
  b.pos.z = -8;
  b.heading = 1.2;
  ok(set.dismiss(b) && !set.following(b) && set.holds(b), 'asked to stop it stops, and the set still holds it until the player is far off');
  ok(b.side === 'civilian' && b.aggression === 'passive' && b.essential === true, 'back on its own side and temper, and part of the furniture again');
  ok(b.follow === null && b.homeX === 33 && b.homeZ === -8, 'its home is where it was left');
  ok(!!b.post && b.post !== post && b.post.kind === 'near' && b.post.heading === 1.2 && b.post.tune === post!.tune, 'a post there, facing the way it faces, on the same numbers as its old one');
  ok(b.unfollowed === 1 && through.get(b) === false, 'its steering let go of, and the player no longer walks through it');
  ok(!set.dismiss(b), 'asked twice it is not following to be asked');
  ok(set.full === false, 'and there is room again');
}

{
  // Handed back once the player is far enough off: one of ours or a lair's is taken away by the set,
  // since it was given up to it; the standing people's own and one stood by hand are left where they are.
  const { set, removed } = aSet();
  const you = leader(0, 0);
  const ours = person({ pos: { x: 2, y: 0, z: 0 } });
  const row = person({ pos: { x: 3, y: 0, z: 0 } });
  set.add(ours, 'adopted', you, 0);
  set.add(row, 'stood', you, 0);
  set.dismiss(ours);
  set.dismiss(row);
  set.step(0.1, you);
  ok(set.holds(ours) && set.holds(row) && removed.length === 0, 'near the player they stay held');
  (you.pos as { x: number }).x = FOLLOW_TUNE.letGo + 10;
  set.step(0.1, you);
  set.step(0.1, you);
  ok(!set.holds(ours) && !set.holds(row), `past ${FOLLOW_TUNE.letGo} m both are handed back`);
  ok(removed.length === 1 && removed[0] === ours, 'and only the one given up to the set is taken away by it');
  ok(set.tally.handedBack === 2, 'counted');
}

{
  // A follower killed is let go of and said to have fallen; one taken away by the game goes quietly.
  const { set, through, said } = aSet();
  const you = leader();
  const a = person({ label: 'Lirin' });
  const c = person();
  set.add(a, 'stood', you, 0);
  set.add(c, 'own', you, 0);
  a.dead = true;
  c.removed = true;
  c.dead = true;
  set.step(0.1, you);
  ok(set.count === 0 && a.follow === null && c.follow === null, 'the fallen and the gone follow nobody');
  ok(through.get(a) === false && through.get(c) === false, 'and nobody walks through them any more');
  ok(said.length === 1 && said[0] === 'Lirin has fallen' && set.tally.fell === 1, 'a fall is said in words, and a body taken away is not');
}

{
  // The way the player walks and how fast, from where they have been: the places turn by the walk and not
  // by the view, and a move longer than a step can be is a jump of place and no speed at all.
  const { set } = aSet();
  const you = leader(0, 0);
  const b = person();
  set.add(b, 'own', you, 0);
  const p = you.pos as { x: number; z: number };
  for (let i = 0; i < 30; i++) {
    p.x += 0.1;
    set.step(1 / 30, you);
  }
  ok(near(set.heading, Math.PI / 2, 1e-6), 'walking along +x, the heading is a quarter turn');
  ok(set.speed > 2.5 && set.speed < 3.1, `and its speed is read off the walk (${set.speed.toFixed(2)} m/s of a true 3)`);
  ok(b.follow!.slotX < p.x && near(b.follow!.slotZ, -FOLLOW_TUNE.side, 1e-6), "the follower's place is behind the player and to their left");
  for (let i = 0; i < 30; i++) {
    p.x += 0.3;
    set.step(1 / 30, you);
  }
  ok(b.follow!.run && set.speed > FOLLOW_TUNE.runWith, 'a player running has their followers run');
  p.x += FOLLOW_TUNE.jump + 5;
  set.step(1 / 30, you);
  ok(set.speed === 0 && !b.follow!.run, 'a jump of place (a lift, a door with no way in on foot) is no speed at all');
}

// --- 4: whom they fight ---------------------------------------------------------------------------------

{
  const { set } = aSet();
  const you = leader();
  const a = person();
  const unarmed = person({ canFight: false });
  set.add(a, 'own', you, 0);
  set.add(unarmed, 'own', you, 0);
  const bandit = { key: 50, label: 'bandit', side: 'hostile', aggression: 'aggressive', dead: false, pos: { x: 0, y: 0, z: 9 } } as unknown as Living;
  ok(set.assist(bandit) === 1 && a.provoked[0] === bandit && unarmed.provoked.length === 0, 'whatever struck the player or was struck by them is handed to every follower that can fight');
  ok(set.assist({ ...bandit, dead: true } as Living) === 0, 'nothing dead');
  ok(set.assist({ ...bandit, side: 'player' } as Living) === 0, "nothing on the player's own side: the player, another player, another follower");
  ok(set.assist({ ...bandit, essential: true } as unknown as Living) === 0, 'nothing that cannot be hurt at all');
  ok(set.assist(a as unknown as Living) === 0, 'and never one of the followers themselves');
  ok(set.assist(null) === 0 && set.tally.assists === 1, 'nobody is nothing, and the one that took is counted');
}

// --- the knob and the world going ---------------------------------------------------------------------

{
  const was = { ...FOLLOW_TUNE };
  tuneFollow({ most: 4.6, back: -2, side: Number.NaN, nosuch: 1 } as never);
  ok(FOLLOW_TUNE.most === 5 && FOLLOW_TUNE.back === 0 && FOLLOW_TUNE.side === was.side && !('nosuch' in FOLLOW_TUNE), 'the numbers move live, a count whole, nothing below nought, a value that is not a number left alone');
  Object.assign(FOLLOW_TUNE, was);
  const { set, through } = aSet();
  const you = leader();
  const a = person();
  const b = person();
  set.add(a, 'own', you, 0);
  set.add(b, 'own', you, 0);
  set.dismiss(b);
  set.clear();
  ok(set.count === 0 && !set.holds(a) && !set.holds(b) && a.follow === null && through.get(a) === false, 'the world going lets everybody go where they stand');
  ok(a.side === 'player', 'with nothing put back, since the bodies go with the world');
}

// --- the wiring, read out of the files that load three ------------------------------------------------

{
  const read = (rel: string): string => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8');
  const mobile = read('world/mobiles/mobile.ts');
  const main = read('main.ts');
  const world = read('world/world.ts');
  const people = read('world/standingPeople.ts');
  const player = read('player/player.ts');
  // A follower never holds a grudge against its own side, and a blow from its own side never lands.
  ok(/if \(this\.follow && source\.side === this\.side\) return;/.test(mobile), 'a follower holds no grudge against the player or anybody else on their side');
  ok(/source\.side === this\.side && !hostileSides\(source, this\)\) return;/.test(mobile), "and a blow from its own side is refused where it lands, the player's included");
  ok((main.match(/if \(isFollower\(source\)\) return;/g) ?? []).length === 2, "a follower's stray blow and its stray shot both land on nothing when they find the player");
  ok(/this\.world\.followers\.assist\(source\)/.test(main) && /this\.world\.followers\.assist\(hit\)/.test(main), 'whatever strikes the player and whatever the player strikes are handed to the followers');
  // Its home is its place, so the brain's own leash measures from the player, and its idle half is kept.
  ok(/this\.homeX = follow\.slotX;/.test(mobile) && /if \(follow\) keepFollow\(d, self, follow\);/.test(mobile), 'a follower thinks from its place behind the player and keeps to it');
  ok(/leader \? this\.placeOf\(ctx, leader\)/.test(mobile), 'and walks through the doors the player went through, to the room the player is in');
  ok(/this\.follow !== null \|\| this\.listening !== null;/.test(mobile), 'a follower is never frozen by its distance from the camera');
  // The world steps it before the bodies think, clears it with itself, and the standing people keep off it.
  const stepAt = world.indexOf('this.followers.step(dt, this.playerTarget);');
  ok(stepAt > 0 && stepAt < world.indexOf('this.mobiles?.update(dt, { now: this.simTime'), 'the world places the followers before the bodies think');
  ok(/this\.followers\.clear\(\);/.test(world), 'and lets them go with itself, which is a travel and the select screen');
  ok(/keeps: \(m\) => this\.followers\.holds\(m\),/.test(world), 'the standing people are told which bodies the followers hold');
  ok(/away > PEOPLE_TUNE\.drop && !\(here\.body && deps\.keeps\?\.\(here\.body\)\)/.test(people) && /deps\?\.keeps\?\.\(b\)/.test(people) && /deps\.keeps\?\.\(b\)\) continue;/.test(people), 'and put none of them down for distance, for the cap or for memory');
  ok(/!this\.physics\.isWalkThrough\(c\.handle\)/.test(player), 'the player walks through whoever follows them');
}

console.log(`\n${checks} checks passed`);
