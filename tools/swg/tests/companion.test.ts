// The story's one companion: what the book holds of them (`recruit`, `waitHere`, `dismiss`, `kill` and the
// `companion` event, in `src/story/quests.ts`), what the view hands the browser, and the keeper that stands them
// (`src/world/companion.ts`) with the follower set's slot 0 (`src/world/followers.ts`).
//
// What is pinned:
//
//   - recruited only from a cast member marked a companion, one at a time; told to wait, or let go, they keep
//     where they were left, and speaking to them there brings them back before a word is said;
//   - down and up again only as the browser that stands them says, and dead only by the story's `kill`, which the
//     player knows at once since the companion falls beside them;
//   - the view stands them beside the player while they are with them, where they were left otherwise, and
//     never twice;
//   - the keeper: stood behind the player, aboard and not drawn in a vehicle, stood again at every arrival and when
//     left far behind out of sight, the host told once of each going down and getting up, got up by itself only
//     with nothing hostile near and only after its time, got up by the use key held for long enough within reach,
//     brought back up at an arrival when it was down as the world went, and falling only when the story kills it;
//   - one body, handed across: the story's cast's body taken on where it stands and handed back where it stands,
//     never one taken down and another stood under the player's eyes, and never a down told of one body answered
//     with an up for the next;
//   - stood at the first spot round the player the game finds a floor at with nothing between, else on their own;
//   - what keeps them down: anything hostile to the player's side, or still fighting it whatever its temper;
//   - the companion walks first behind the player and takes nobody's place, and is given up to the cast whole;
//   - the cast is never stood inside the player, and hands a body over and takes one back;
//   - a body that is downable goes down where any other dies, in both places that happens, lies out of the fight
//     and off the living list;
//   - the server believes the browser's word of its companion, speaks to them wherever they walk with the player
//     and measures from where they wait once told to wait, and a browser tells only a server that keeps one.
//
// Synthetic, and the committed test set: nothing is read from the game's own files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORY_TUNING, Stories, applyStory } from '../../../server/stories.mjs';
import { Purses } from '../../../server/purse.mjs';
import { emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { cleanStoryWord } from '../../../src/story/storyWire.ts';
import { STAND_TUNE, StoryStands, type CastBody } from '../../../src/world/storyStands.ts';
import { parseCondition } from '../../../src/story/expr.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { noteWords } from '../../../src/story/notes.ts';
import { evalCond, type StoryNote } from '../../../src/story/quests.ts';
import { PEOPLE_STORY, RemoteHost } from '../../../src/story/remoteHost.ts';
import { loadSet } from '../../../src/story/set.ts';
import { cleanStoryEvent } from '../../../src/story/storyWire.ts';
import { cleanView, viewOf, type CompanionView } from '../../../src/story/view.ts';
import { COMPANION_TUNE, CompanionKeeper, isThreat, standSpot, tuneCompanion, type CompanionDeps, type CompanionScene } from '../../../src/world/companion.ts';
import { FOLLOW_TUNE, FollowerSet, type FollowerBody } from '../../../src/world/followers.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const lib = loadSet(readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/')), { test: true }).set;
const COMP = 'test:cast/test-companion';
let now = 1_900_000_000_000;
const ctx = (o: Record<string, unknown> = {}) => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han', credits: 100, ...o });
const holds = (book: StoryBook, src: string) => {
  const r = parseCondition(src);
  if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
  return evalCond(r.cond, book, { ...ctx(), char: book.char, payer: 'browser' }, {}, undefined, lib);
};
const words = (notes: StoryNote[]) => notes.map((n) => noteWords(n, lib, { text: (t) => (typeof t === 'string' ? t : t.en) }) ?? '').filter(Boolean);
const view = (h: HostCore) => viewOf(h.book, lib, { ...ctx(), char: h.book.char, payer: 'browser' });
const tick = () => {
  now += 1000;
};

// ---- the book ------------------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-comp'), lib, payer: 'browser' });
  ok(h.run(['recruit(cast/test-doomed)'], ctx()).why?.includes('not one of the story\'s companions') === true && !h.book.companion, 'only a cast member marked a companion is recruited');
  tick();
  const r = h.grant('test:companion', ctx());
  ok(h.book.companion?.who === COMP && h.book.companion.state === 'active' && h.book.companion.recruitedAt === now && h.book.companion.downs === 0, 'test:companion recruits TEST COMPANION');
  ok(words(r.notes).includes('TEST COMPANION is with you') && holds(h.book, 'companionUp()') && holds(h.book, 'companion(test:cast/test-companion) == "active"'), 'said by name, and read by companionUp() and companion(w)');
  const v = view(h);
  ok(v.companion?.id === COMP && v.companion.body === 'dressed_armorsmith_trainer_01' && v.companion.state === 'active' && !v.cast.some((c) => c.id === COMP), 'the view hands the browser the companion to stand beside the player, and never stands them as cast too');
  ok(JSON.stringify(cleanView(JSON.parse(JSON.stringify(v)))?.companion) === JSON.stringify(v.companion), 'and the companion crosses the wire exactly');
  // Down and up, as the browser says.
  tick();
  h.event({ k: 'companion', up: false }, ctx());
  ok(h.book.companion?.state === 'downed' && h.book.companion.downs === 1 && h.book.companion.downedAt === now && !holds(h.book, 'companionUp()'), 'down: the book holds it, counted, and companionUp() is false');
  h.event({ k: 'companion', up: false }, ctx());
  ok(h.book.companion?.downs === 1, 'down twice is down once');
  tick();
  h.event({ k: 'companion', up: true }, ctx());
  ok(h.book.companion?.state === 'active' && holds(h.book, 'companionUp()'), 'and up again');
  // Told to wait where the player stands; then spoken to there, back before a word is said.
  tick();
  const turn = h.talkOpen(COMP, ctx());
  ok(turn.turn.view?.node === 'with', 'spoken to while with the player, the companion has their own answers');
  const wait = h.talkPick(turn.turn.state!, 'wait', ctx({ here: [3500, -4700] }));
  ok(h.book.companion?.state === 'waiting' && JSON.stringify(h.book.companion.waitAt) === '{"world":"tatooine","raw":[3500,-4700]}' && words(wait.r.notes).includes('TEST COMPANION waits here for you'), 'told to wait, they keep where they were told');
  const waiting = view(h).cast.find((c) => c.id === COMP);
  ok(waiting?.at[0] === 3500 && waiting.at[1] === -4700 && view(h).companion?.state === 'waiting', 'and the view stands them there as the story\'s cast');
  tick();
  const back = h.talkOpen(COMP, ctx({ here: [3500, -4700] }));
  ok(h.book.companion?.state === 'active' && back.turn.view?.node === 'with' && words(back.r.notes).includes('TEST COMPANION is with you again'), 'spoken to where they wait, they come back before a word is said');
  // Let go: the slot is free, and they stand where they were left.
  tick();
  const go = h.talkOpen(COMP, ctx());
  h.talkPick(go.turn.state!, 'go', ctx({ here: [3490, -4695] }));
  ok(h.book.companion?.state === 'released' && h.book.companion.waitAt?.raw[0] === 3490 && holds(h.book, 'companion(test:cast/test-companion) == "released"'), 'let go, they go their own way from where they were left');
  tick();
  h.talkOpen(COMP, ctx());
  ok(h.book.companion?.state === 'active', 'and come back when spoken to there');
  // One at a time; death only by the story.
  ok(h.run(['recruit(cast/test-companion)'], ctx()).why === null && h.book.companion?.state === 'active', 'recruiting the companion already with you changes nothing');
  tick();
  h.run(['kill(cast/test-companion)'], ctx());
  ok(h.book.companion?.state === 'dead' && h.book.npcs?.[COMP]?.alive === false && h.book.npcs[COMP].known?.alive === false, 'killed by the story: dead, and known at once, since they fall beside the player');
  ok(!view(h).cast.some((c) => c.id === COMP) && view(h).companion?.state === 'dead' && h.run(['recruit(cast/test-companion)'], ctx()).why !== null, 'never stood again, and never recruited again');
  ok(cleanStoryEvent({ k: 'companion', up: 'yes' }) === null && JSON.stringify(cleanStoryEvent({ k: 'companion', up: true })) === '{"k":"companion","up":true}', 'the companion\'s word off the wire is a yes or a no, nothing else');
}

// ---- the keeper ----------------------------------------------------------------------------------------------------
interface FakeBody {
  removed: boolean;
  dead: boolean;
  downed: boolean;
  pos: { x: number; z: number };
  hp: number;
}
{
  const calls: string[] = [];
  let hostile = false;
  let visible = false;
  const stood: FakeBody[] = [];
  const deps: CompanionDeps<FakeBody> = {
    stand: (_v, x, z) => {
      const b: FakeBody = { removed: false, dead: false, downed: false, pos: { x, z }, hp: 100 };
      stood.push(b);
      calls.push(`stand ${x.toFixed(1)},${z.toFixed(1)}`);
      return b;
    },
    unstand: (b) => {
      b.removed = true;
      calls.push('unstand');
    },
    getUp: (b, share) => {
      if (!b.downed) return false;
      b.downed = false;
      b.hp = 100 * share;
      calls.push(`up ${share}`);
      return true;
    },
    fall: (b) => {
      b.dead = true;
      calls.push('fall');
    },
    hostileNear: () => hostile,
    inView: () => visible,
    tell: (up) => calls.push(`tell ${up}`),
  };
  const v = (state: CompanionView['state']): CompanionView => ({ id: COMP, name: 'TEST COMPANION', body: 'dressed_armorsmith_trainer_01', state, downs: 0 });
  const scene = (o: Partial<CompanionScene> = {}): CompanionScene => ({ onFoot: true, gen: 1, x: 0, z: 0, heading: 0, now: 0, ...o });
  const k = new CompanionKeeper<FakeBody>();
  ok(k.step(null, scene(), deps) === 'none' && !calls.length, 'with no companion there is nothing to stand');
  ok(k.step(v('active'), scene(), deps) === 'stood' && calls.at(-1) === `stand 0.0,${(-COMPANION_TUNE.standBack).toFixed(1)}` && k.isBody(stood[0]), `stood ${COMPANION_TUNE.standBack} m behind the player, facing their way`);
  ok(k.step(v('active'), scene(), deps) === 'none' && stood.length === 1, 'and stood once');
  ok(k.step(v('active'), scene({ onFoot: false }), deps) === 'aboard' && stood[0].removed, 'in a vehicle or a ship they are aboard, not drawn');
  ok(k.step(v('active'), scene({ onFoot: false }), deps) === 'aboard' && stood.length === 1, 'and stay so while the player does');
  ok(k.step(v('active'), scene({ x: 50, z: 50 }), deps) === 'stood' && stood.length === 2, 'and get off where the player next stands on foot');
  // A change of world: the body goes with the world, and they are stood again at the arrival.
  k.clear();
  ok(k.step(v('active'), scene({ gen: 2 }), deps) === 'stood' && stood.length === 3, 'stood again beside the player at every arrival');
  // Left far behind, out of sight: stood again. In sight: left where they are.
  const body = stood[2];
  body.pos.x = FOLLOW_TUNE.letGo + 50;
  visible = true;
  ok(k.step(v('active'), scene({ gen: 2 }), deps) === 'none' && !body.removed, 'left far behind but in view, never stood again under the player\'s eyes');
  visible = false;
  ok(k.step(v('active'), scene({ gen: 2 }), deps) === 'restood' && body.removed && stood.length === 4, 'out of view, stood again beside the player');
  // Down: told once; up by itself only after its time and only with nothing hostile near.
  const b = stood[3];
  b.downed = true;
  calls.length = 0;
  ok(k.step(v('active'), scene({ gen: 2, now: 10 }), deps) === 'down' && calls.join() === 'tell false', 'gone down: the host told once');
  ok(k.step(v('downed'), scene({ gen: 2, now: 11 }), deps) === 'none' && calls.length === 1, 'and not again');
  hostile = true;
  ok(k.step(v('downed'), scene({ gen: 2, now: 10 + COMPANION_TUNE.selfAfter + 1 }), deps) === 'none' && b.downed, 'with something hostile near, they stay down past their time');
  hostile = false;
  ok(k.step(v('downed'), scene({ gen: 2, now: 10 + COMPANION_TUNE.selfAfter - 1 }), deps) === 'none' && b.downed, 'and with nothing near, not before their time');
  ok(k.step(v('downed'), scene({ gen: 2, now: 10 + COMPANION_TUNE.selfAfter }), deps) === 'up' && !b.downed && b.hp === 100 * COMPANION_TUNE.reviveShare && calls.at(-1) === 'tell true', `then up by themselves, with ${COMPANION_TUNE.reviveShare} of their health, and the host told`);
  // Got up by the use key held long enough, within reach.
  b.downed = true;
  k.step(v('active'), scene({ gen: 2, now: 100 }), deps);
  const at = b.pos;
  ok(k.revivable(at.x + 1, at.z) && !k.revivable(at.x + COMPANION_TUNE.reviveReach + 0.5, at.z), `the use key reaches them within ${COMPANION_TUNE.reviveReach} m`);
  ok(k.hold(1, true, at.x + 1, at.z, deps) > 0 && k.hold(0.5, false, at.x + 1, at.z, deps) === 0 && k.holding === 0, 'let go of, the hold starts again');
  ok(k.hold(1, true, at.x + 5, at.z, deps) === -1 && k.holding === 0, 'out of reach, it does not count');
  let done = 0;
  for (let i = 0; i < Math.round(COMPANION_TUNE.reviveHold / 0.5) - 1; i++) done = k.hold(0.5, true, at.x + 1, at.z, deps);
  ok(b.downed && done < 1, 'held, but not yet for long enough');
  done = k.hold(0.5, true, at.x + 1, at.z, deps);
  ok(done === 1 && !b.downed && calls.at(-1) === 'tell true', `held for ${COMPANION_TUNE.reviveHold} s, they are up, and the host told`);
  // Down as the world goes: up again at the arrival.
  b.downed = true;
  k.step(v('active'), scene({ gen: 2, now: 200 }), deps);
  k.clear();
  calls.length = 0;
  ok(k.step(v('downed'), scene({ gen: 3, now: 300 }), deps) === 'stood' && calls.join() === 'stand 0.0,-2.5,tell true', 'down as the world went, stood again at the arrival up, and the host told');
  // Told to wait: taken down here (the story stands them where they wait). Dead: they fall.
  ok(k.step(v('waiting'), scene({ gen: 3 }), deps) === 'unstood' && k.body === null, 'told to wait, this keeper takes them down: the story stands them where they wait');
  k.step(v('active'), scene({ gen: 3 }), deps);
  const last = stood.at(-1)!;
  ok(k.step(v('dead'), scene({ gen: 3 }), deps) === 'fell' && last.dead && k.body === null, 'killed by the story, they fall where they stand, and are never stood again');
  ok(k.step(v('dead'), scene({ gen: 3 }), deps) === 'none', 'nor stood again after');
  const before = { ...COMPANION_TUNE };
  tuneCompanion({ reviveHold: 1, reviveShare: 5, max: 2.6, selfAfter: Number.NaN });
  ok(COMPANION_TUNE.reviveHold === 1 && COMPANION_TUNE.reviveShare === 1 && COMPANION_TUNE.max === 3 && COMPANION_TUNE.selfAfter === before.selfAfter, 'the numbers move live, held to what makes sense');
  tuneCompanion(before);
}

// ---- one body, handed across, and never an up for a down another body was told ------------------------------
{
  const calls: string[] = [];
  const stood: FakeBody[] = [];
  const cast: FakeBody = { removed: false, dead: false, downed: false, pos: { x: 1, z: 1 }, hp: 100 };
  let castHas: FakeBody | null = cast;
  const given: FakeBody[] = [];
  const deps: CompanionDeps<FakeBody> = {
    stand: (_v, x, z) => {
      const b: FakeBody = { removed: false, dead: false, downed: false, pos: { x, z }, hp: 100 };
      stood.push(b);
      calls.push('stand');
      return b;
    },
    adopt: () => {
      const b = castHas;
      castHas = null;
      if (b) calls.push('adopt');
      return b;
    },
    handBack: (b) => {
      given.push(b);
      castHas = b;
      calls.push('handBack');
      return true;
    },
    unstand: (b) => {
      b.removed = true;
      calls.push('unstand');
    },
    getUp: (b) => {
      b.downed = false;
      return true;
    },
    fall: (b) => void (b.dead = true),
    hostileNear: () => false,
    inView: () => false,
    tell: (up) => calls.push(`tell ${up}`),
  };
  const v = (state: CompanionView['state']): CompanionView => ({ id: COMP, name: 'TEST COMPANION', body: 'dressed_armorsmith_trainer_01', state, downs: 0 });
  const scene = (o: Partial<CompanionScene> = {}): CompanionScene => ({ onFoot: true, gen: 1, x: 0, z: 0, heading: 0, now: 0, ...o });
  const k = new CompanionKeeper<FakeBody>();
  ok(k.step(v('active'), scene(), deps) === 'adopted' && k.isBody(cast) && calls.join() === 'adopt' && !cast.removed, 'taken on, the body the cast stands is handed over where it stands: none taken down, none stood');
  ok(k.step(v('waiting'), scene(), deps) === 'handed' && k.body === null && given[0] === cast && !cast.removed && calls.at(-1) === 'handBack', 'told to wait, the same body is handed back to the cast where it stands, and not taken down');
  ok(k.step(v('active'), scene(), deps) === 'adopted' && k.isBody(cast) && stood.length === 0, 'and spoken to there, the same body comes back');
  // Down as the world goes, then a new body: the up the first was owed is never told of the second.
  cast.downed = true;
  k.step(v('active'), scene({ now: 5 }), deps);
  ok(calls.at(-1) === 'tell false', 'the body goes down, and the host is told');
  k.clear();
  calls.length = 0;
  ok(k.step(v('active'), scene({ gen: 2, now: 6 }), deps) === 'stood' && k.step(v('active'), scene({ gen: 2, now: 7 }), deps) === 'none' && !calls.includes('tell true'), `a body stood after one that went down with its world is not told up (${calls.join()})`);
  const k2 = new CompanionKeeper<FakeBody>();
  const b2 = { removed: false, dead: false, downed: false, pos: { x: 0, z: 0 }, hp: 100 };
  castHas = b2;
  k2.step(v('active'), scene({ gen: 3 }), deps);
  b2.downed = true;
  k2.step(v('active'), scene({ gen: 3, now: 10 }), deps);
  calls.length = 0;
  ok(k2.step(v('waiting'), scene({ gen: 3, now: 11 }), deps) === 'handed' && !b2.downed && given.at(-1) === b2, 'a body down when the story tells them to wait gets up and is handed back up, or nobody could ever speak to them there');
  ok(k2.step(v('active'), scene({ gen: 3, now: 12 }), deps) === 'adopted' && k2.step(v('active'), scene({ gen: 3, now: 13 }), deps) === 'none', 'and comes back up');
  ok(!calls.includes('tell false') && !calls.includes('tell true'), `with nothing told the host, whose book holds them waiting and then with the player, never down (${calls.join()})`);
}

// ---- where a companion is stood ---------------------------------------------------------------------------------
{
  const out = { x: 0, z: 0 };
  ok(standSpot(0, 10, 20, 0, out) && Math.abs(out.x - 10) < 1e-9 && Math.abs(out.z - (20 - COMPANION_TUNE.standBack)) < 1e-9, `the first spot is ${COMPANION_TUNE.standBack} m straight behind the player`);
  let n = 0;
  while (standSpot(n, 0, 0, 0, out)) n++;
  ok(n === 7 && Math.abs(Math.hypot(out.x, out.z) - COMPANION_TUNE.standBack / 2) < 1e-9, 'seven in all round the player, the last half as far behind');
  const tried: string[] = [];
  let floorAt: (x: number, z: number) => number | null = () => null;
  const at: { x: number; z: number; y: number | null }[] = [];
  const deps: CompanionDeps<FakeBody> = {
    stand: (_v, x, z, _h, y) => {
      at.push({ x, z, y });
      return { removed: false, dead: false, downed: false, pos: { x, z }, hp: 100 };
    },
    floor: (x, z) => {
      tried.push(`${x.toFixed(2)},${z.toFixed(2)}`);
      return floorAt(x, z);
    },
    unstand: (b) => void (b.removed = true),
    getUp: () => true,
    fall: () => {},
    hostileNear: () => false,
    inView: () => false,
    tell: () => {},
  };
  const v: CompanionView = { id: COMP, name: 'TEST COMPANION', body: 'x', state: 'active', downs: 0 };
  // A wall straight behind: the first spot the game finds a floor at, with nothing between, is the one stood at.
  floorAt = (x, z) => (Math.abs(x) < 0.1 && z < 0 ? null : 0.5);
  const k = new CompanionKeeper<FakeBody>();
  k.step(v, { onFoot: true, gen: 1, x: 0, z: 0, heading: 0, now: 0 }, deps);
  standSpot(1, 0, 0, 0, out);
  ok(tried.length === 2 && Math.abs(at[0].x - out.x) < 1e-9 && Math.abs(at[0].z - out.z) < 1e-9 && at[0].y === 0.5, `behind blocked, the next spot round is tried and stood at, on the floor found there (${tried.join(' ')})`);
  // Nowhere round them at all: on the player's own spot, which the player walks through.
  floorAt = (x, z) => (Math.hypot(x, z) < 1e-6 ? 1.25 : null);
  tried.length = 0;
  const k2 = new CompanionKeeper<FakeBody>();
  k2.step(v, { onFoot: true, gen: 1, x: 0, z: 0, heading: 0, now: 0 }, deps);
  ok(tried.length === 8 && at[1].x === 0 && at[1].z === 0 && at[1].y === 1.25 && k2.tally.onPlayer === 1, 'and with nowhere clear round them, on the player\'s own spot');
}

// ---- what keeps them down ----------------------------------------------------------------------------------------
{
  const player = { side: 'player' as const, aggression: 'defensive' as const };
  const ours = (key: number) => key === 1 || key === 9;
  const wild = { dead: false, side: 'wild' as const, aggression: 'aggressive' as const };
  const provoked = (target: number | null) => ({ dead: false, side: 'neutral' as const, aggression: 'defensive' as const, fights: (o: (k: number) => boolean) => target !== null && o(target) });
  ok(isThreat(wild, player, ours) && !isThreat({ ...wild, dead: true }, player, ours), 'an aggressive creature near is still in the fight, and a dead one is not');
  ok(isThreat(provoked(9), player, ours) && isThreat(provoked(1), player, ours), 'a creature only defending itself is in it still while it fights the companion or the player, whatever its temper');
  ok(!isThreat(provoked(5), player, ours) && !isThreat(provoked(null), player, ours) && !isThreat({ dead: false, side: 'neutral', aggression: 'defensive' }, player, ours), 'one fighting somebody else, or nobody, is not, nor a bystander');
}

// ---- slot 0 ----------------------------------------------------------------------------------------------------------
{
  const leader = { key: 1, pos: { x: 0, y: 0, z: 0 }, side: 'player', dead: false } as unknown as Parameters<FollowerSet['add']>[2];
  const make = (key: number): FollowerBody => ({ key, label: `TEST ${key}`, pos: { x: key, y: 0, z: 0 }, heading: 0, dead: false, removed: false, canFight: true, side: 'neutral', aggression: 'passive', essential: true, post: null, patrol: null, homeX: 0, homeZ: 0, follow: null, provoke: () => {} }) as unknown as FollowerBody;
  const set = new FollowerSet();
  const comp = make(9);
  ok(set.add(comp, 'companion', leader, 0) === null && set.bodies()[0] === comp && comp.follow?.index === 0 && !set.full, 'the companion walks first behind the player, in slot 0, and the set is not full');
  const others = [make(2), make(3), make(4)];
  for (let i = 0; i < others.length; i++) {
    ok(set.add(others[i], 'own', leader, 0) === null && set.full === (i === others.length - 1), `ordinary follower ${i + 1} of ${FOLLOW_TUNE.most} is taken on beside the companion, and the set is full only at the last`);
  }
  ok(set.bodies()[0] === comp && set.count === 4 && set.add(make(5), 'own', leader, 0) !== null, 'the companion takes nobody\'s place: the set is full at three others, still first behind the player');
  ok(set.hasKey(9) && set.hasKey(3) && !set.hasKey(7), 'whose keys are the player\'s side is asked of the set');
  // Given up to the story's cast: off the set, back as it was, and not held to be handed back.
  ok(set.giveUp(comp) && !set.following(comp) && !set.holds(comp) && comp.follow === null && comp.side === 'neutral' && comp.essential === true && set.count === 3 && !set.giveUp(comp), 'given up to the story\'s cast, the companion is off the set as it was and held by nobody here');
}

// ---- the cast: never inside the player, and a body handed over and taken back ------------------------------------
{
  const stands = new StoryStands();
  const placed: { x: number; z: number }[] = [];
  const downs: CastBody[] = [];
  const deps = {
    stand: (_c: unknown, x: number, z: number) => {
      placed.push({ x, z });
      return { removed: false, label: 'TEST', rename() {} } as CastBody;
    },
    unstand: (b: CastBody) => void downs.push(b),
    roomFloor: () => null,
    text: (t: unknown) => (typeof t === 'string' ? t : (t as { en: string }).en),
  };
  const one = { id: COMP, name: 'TEST COMPANION', named: true, body: 'x', world: 'space_test', f: 'game' as const, at: [10, 10] as [number, number], heading: 0, talk: true, essential: true };
  stands.stepCast([one], 'space_test', 1, null, 10.2, 10, 0, deps);
  ok(placed.length === 1 && Math.abs(Math.hypot(placed[0].x - 10.2, placed[0].z - 10) - STAND_TUNE.clear) < 1e-9 && placed[0].x < 10.2, `a person whose place is the player's own is stood ${STAND_TUNE.clear} m off them, away from them`);
  const body = stands.bodyOf(COMP)!;
  ok(stands.release(COMP, 2) === null && stands.release(COMP, 1) === body && stands.castOf(body) === null, 'handed over where it stands only in its own world, and off the cast\'s books once it is');
  stands.stepCast([one], 'space_test', 1, null, 10, 30, 10, deps);
  ok(placed.length === 2 && downs.length === 0, 'so the cast stands nobody twice: the one handed over is not taken down, and a fresh one is stood only as the cast would anyway');
  stands.adopt(COMP, body, 1, deps);
  ok(stands.castOf(body) === COMP && downs.length === 1, 'a body taken back is the cast\'s again, and the one stood meanwhile is taken down so nobody is stood twice');
  stands.stepCast([], 'space_test', 1, null, 10, 30, 20, deps);
  ok(downs.length === 2 && downs[1] === body, 'and is taken down as any cast member is once the story stops standing them');
}

// ---- a body that goes down instead of dying ----------------------------------------------------------------------
{
  // The mobile's own file reaches the audio and the physics, which node cannot load, so its shape is read.
  const mobile = readFileSync(fileURLToPath(new URL('../../../src/world/mobiles/mobile.ts', import.meta.url)), 'utf8');
  const world = readFileSync(fileURLToPath(new URL('../../../src/world/world.ts', import.meta.url)), 'utf8');
  ok((mobile.match(/if \(this\.downable\) this\.goDown\(\);\s*else this\.die\(\);/g) ?? []).length === 2, 'a body that is downable goes down where any other dies: from a blow and from a burn alike');
  ok(/damage\(amount: number[^]*?if \(this\.dead \|\| this\.disposed \|\| this\.downPhase === 'out'\) return;/.test(mobile), 'and once down takes no more blows');
  ok(/private goDown\(\): void \{[^]*?this\.downPhase = 'out';[^]*?this\.applyCull\(\);[^]*?\n  \}/.test(mobile) && /p\.down = this\.downPhase !== null;/.test(mobile), 'lying down, it is culled whole, since the standing sphere misses its head along the ground');
  ok(/for \(const m of this\.mobiles\.live\) if \(m\.ready && !m\.downed\) this\.livingList\.push\(m\);/.test(world), 'and is off the living list, so nothing goes on hitting it');
}

// ---- the server: the companion is spoken to wherever they walk, and where they wait -----------------------------
{
  const centre = { x: -1376, z: -3576 };
  const worlds = { worldOf: (p: string) => p, kindOf: () => 'planet', centreOf: () => centre, hourOf: () => null, describe: () => ({}) };
  const files = readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/'));
  const server = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000 }, write: (rec: object) => void applyStory(server.data, rec), now: () => now, purses: new Purses(), worlds, read: () => ({ test: files, own: null }), admin: () => true, tests: true });
  server.readSets();
  // Raw Tatooine into the game's frame: X mirrored about the centre.
  const at = (x: number, z: number) => ({ p: [-(x - centre.x), 0, z - centre.z] });
  const c = { id: 1, character: 'c-reach', keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '' }, state: at(3600, -4690) };
  server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  server.hear(c, { t: 'story', do: 'admin', op: 'grant', quest: 'test:companion' });
  const book = () => server.bookOf('c-reach') as StoryBook;
  ok(book().companion?.state === 'active', 'the server takes TEST COMPANION on');
  const say = (op: string, reply: string | null = null) => {
    const r = server.hear(c, { t: 'story', do: 'talk', op, speaker: COMP, ...(reply ? { reply } : {}), at: {} }) as { tell: { msg: Record<string, unknown> }[] };
    const w = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((x) => x?.do === 'node');
    return w?.do === 'node' ? w : null;
  };
  const far = say('open');
  ok(far?.view?.node === 'with', `walking with the player, the companion is spoken to wherever they are, ${Math.round(Math.hypot(3600 - 3484, -4690 + 4701))} m from where the cast file puts them (${far?.why ?? far?.view?.node})`);
  say('pick', 'wait');
  server.hear(c, { t: 'story', do: 'talk', op: 'close', speaker: COMP, at: {} });
  ok(book().companion?.state === 'waiting' && book().companion?.waitAt?.raw[0] === 3600, `told to wait, they wait where the player stood (${JSON.stringify(book().companion?.waitAt)})`);
  c.state = at(3484, -4701);
  const atCast = say('open');
  ok(atCast?.view === null && /too far/.test(atCast.why ?? ''), `then the cast file's own spot is too far from them (${atCast?.why})`);
  c.state = at(3601, -4690);
  const back = say('open');
  ok(back?.view?.node === 'with' && book().companion?.state === 'active', 'while from beside where they wait they are spoken to, and come back');
}

// ---- the wire ---------------------------------------------------------------------------------------------------------
{
  const sent: Record<string, unknown>[] = [];
  const line = { host: 'server' as 'local' | 'server' | 'held', story: 4 };
  const remote = new RemoteHost({ send: (m) => sent.push(m), line: () => line, char: () => 'c-r', at: () => ({}), now: () => now, wall: () => 0, note: () => {} });
  ok(!remote.event({ k: 'companion', up: false }).ok && sent.length === 0, 'a server from before the companion is never told of one');
  line.story = PEOPLE_STORY;
  remote.event({ k: 'companion', up: false });
  ok(sent.length === 1 && (sent[0].ev as { k: string }).k === 'companion', 'one that keeps one is');
}

console.log(`\ncompanion: ${checks} checks passed`);
