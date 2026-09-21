// Travelling together, driven with no page, no socket and no world: what a trip the leader offered
// asks of each member, where they come out so that a group that left together is together when it
// arrives, and the one word that carries it.
//
// What is pinned here is what would be expensive to find by playing with two browsers. With no
// server nothing may go out at all, because a browser with no address set has to be the game
// exactly as it was. A member standing in somebody else's hull must not travel by themselves, or
// they would step out of a ship still parked where it was. A jump has to stay a jump -- the only
// crossing that keeps the hull, its rooms and whoever walks them -- while anything else is the
// ordinary travel. Two members must never be sent to the same metre. And everything that arrives is
// a stranger's: a place that is not three real numbers is not a place, and a world is a name that
// is looked up and not trusted.
//
// The wire between the two halves is checked against the shapes the server really sends: the
// server's own `Groups` is driven here so that the offer, the acceptance and the crossing go the
// whole way round, which is what catches a field renamed on one side only.
//
// `src/net/travelTogether.ts` imports nothing but a type, so it runs here as it is.
import assert from 'node:assert/strict';
import { TOGETHER_TUNE, TravelTogether, planCrossing, slotOf, spreadOffset, tuneTogether, type TogetherMove } from '../../../src/net/travelTogether.ts';
import { Groups as BrowserGroups } from '../../../src/net/groups.ts';
import { CROSS_WIRE, cleanCross, mayCross } from '../../../server/crossWire.mjs';
import { Groups as ServerGroups } from '../../../server/groups.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = (o: Partial<ReturnType<typeof standing>> = {}) => ({ ...standing(), ...o });
function standing() {
  return { planet: 'tatooine', zone: '', inSpace: false, flying: false, aboardOther: false, busy: false };
}
const trip = (o: Partial<{ planet: string; zone: string; how: string; at: number[] | null }> = {}) => ({ planet: 'space_tatooine', zone: '', how: 'space', at: null, ...o });

// ---- the word the server checks --------------------------------------------------------------------

ok(cleanCross({ phase: 'here', planet: 'tatooine', zone: '', how: 'ground', at: [1, 2, 3] })?.at?.[2] === 3, 'a good cross keeps its place');
ok(cleanCross({ phase: 'going', planet: 'space_tatooine', how: 'jump' })?.at === undefined, 'a crossing that has not arrived carries no place, and that is not a refusal');
ok(cleanCross({ planet: 'tatooine' }) === undefined, 'no phase, no message');
ok(cleanCross({ phase: 'somewhere', planet: 'tatooine' }) === undefined, 'a phase nothing knows is dropped');
ok(cleanCross({ phase: 'here' }) === undefined, 'a crossing to nowhere is dropped');
ok(cleanCross({ phase: 'here', planet: 'tatooine', how: 'sideways' })?.how === 'travel', 'a way of crossing nothing knows reads as an ordinary travel');
ok(cleanCross({ phase: 'here', planet: 'tatooine', at: [1, 2] })?.at === undefined, 'a place that is not three numbers is not a place');
ok(cleanCross({ phase: 'here', planet: 'tatooine', at: [1, Number.NaN, 3] })?.at === undefined, 'a place with a number that is not one is not a place');
ok(cleanCross({ phase: 'here', planet: 'tatooine', at: [1e300, 0, 0] })?.at?.[0] === 10000000, 'a place a browser could not stand at is clamped, not passed on');
ok(cleanCross({ phase: 'here', planet: 'tat\u0000ooine' })?.planet === 'tatooine', 'control characters are taken out of a world name');
ok(cleanCross([1, 2, 3]) === undefined && cleanCross(null) === undefined, 'a list and nothing at all are not messages');
ok(cleanCross({ phase: 'here', zone: 'main', at: [1, 2, 3] }) === undefined, 'a zone of no world is no crossing: the far end would drop it, so the server does');

{
  // The word has an allowance of its own, and not the group's for decisions: a crossing that fell
  // in the same second as an invitation would otherwise be dropped with nothing to say why.
  const window = { at: 0, lines: 0 };
  let sent = 0;
  for (let i = 0; i < CROSS_WIRE.perSecond + 3; i++) if (mayCross(window, 10_000)) sent++;
  ok(sent === CROSS_WIRE.perSecond, 'a browser may say so many crossing words a second and no more');
  ok(mayCross(window, 11_000) === true, 'and the next second starts again');
  ok(CROSS_WIRE.perSecond >= 2, 'and a whole crossing, which is two words, always fits in one second');
}

// ---- what a trip asks of each member ---------------------------------------------------------------

ok(planCrossing(trip(), here(), true).do === 'travel', 'a leader gone up to space is followed by an ordinary crossing');
ok(planCrossing(trip(), here({ flying: true }), true).withShip === true, 'and the ship being flown goes with them');
ok(planCrossing(trip(), here({ flying: false }), true).withShip === false, 'on foot, nothing is carried');
ok(planCrossing(trip({ planet: 'tatooine', how: 'ground' }), here(), false).do === 'stay', 'a trip to the world you are on moves nobody');
ok(planCrossing(trip({ planet: 'tatooine', how: 'ground' }), here(), false).why.includes('already'), 'and says why');
ok(planCrossing(trip(), here({ busy: true }), true).do === 'stay', 'a browser already crossing is left alone');
ok(planCrossing(trip(), here({ aboardOther: true }), true).do === 'stay', "a passenger in somebody else's hull does not travel by themselves");
ok(planCrossing(trip(), here({ aboardOther: true }), true).why.includes('step out'), 'and is told to step out rather than told they will be carried, because nothing carries them');
ok(planCrossing(trip({ planet: '' }), here(), true).do === 'stay', 'a trip naming nowhere moves nobody');

const jumpAway = planCrossing(trip({ planet: 'space_naboo', how: 'jump', at: [10, 0, 20] }), here({ planet: 'space_tatooine', inSpace: true, flying: true }), true);
ok(jumpAway.do === 'jump', 'a jump is followed by a jump');
ok(planCrossing(trip({ planet: 'space_tatooine', how: 'jump', at: [1, 2, 3] }), here({ planet: 'space_tatooine', inSpace: true, flying: true }), true).do === 'jump', 'including one that stays inside this system');
ok(planCrossing(trip({ planet: 'space_naboo', how: 'jump', at: [1, 2, 3] }), here({ planet: 'tatooine', inSpace: false, flying: true }), true).do === 'travel', 'from the ground there is no jumping after them: the ordinary crossing it is');
ok(planCrossing(trip({ planet: 'space_naboo', how: 'jump', at: [1, 2, 3] }), here({ planet: 'space_tatooine', inSpace: true, flying: false }), true).do === 'travel', 'and a passenger with no ship in their hands crosses the ordinary way');
ok(planCrossing(trip({ planet: 'space_tatooine', how: 'jump', at: [1, 2, 3] }), here({ planet: 'space_tatooine', inSpace: true, flying: false }), true).do === 'stay', 'in the system already, with no ship, a jump is nothing to follow');

// ---- where each member stands ----------------------------------------------------------------------

ok(slotOf('m1') === 1 && slotOf('m8') === 8, 'a member id is their place in the ring');
ok(slotOf('') !== 0 && spreadOffset(slotOf(''), 150)[0] !== 0, 'with no id at all there is still a place of one\'s own: the middle is where whoever is being followed stands');
ok(slotOf('zz') === slotOf('zz') && slotOf('zz') !== slotOf('zy'), 'an id of another shape still has a place of its own, and the same one every time');

const middle = spreadOffset(0, 150);
ok(middle[0] === 0 && middle[1] === 0 && middle[2] === 0, 'the leader stands where they came out');
const places = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => spreadOffset(s, 150).join(','));
ok(new Set(places).size === 8, 'eight members, eight places');
ok(spreadOffset(1, 150).every((v) => Number.isFinite(v)) && Math.round(Math.hypot(spreadOffset(1, 150)[0], spreadOffset(1, 150)[2])) === 150, 'a place is the spread out from the middle');
ok(spreadOffset(1, 150)[1] === 0, 'and never above or below it: in space that would be under a belly, on a planet under the ground');
ok(Math.hypot(...([spreadOffset(9, 150)[0], spreadOffset(9, 150)[2]] as [number, number])) > 150, 'a ninth member stands in a wider ring rather than on top of the first');
ok(spreadOffset(3, 0).join(',') === '0,0,0', 'no spread, no offset');

// ---- the module, driven ------------------------------------------------------------------------------

/** One browser's half, with everything it was told kept for the test to read. */
function make(authority: 'me' | 'server' = 'server', mid = 'm2') {
  const sent: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const went: TogetherMove[] = [];
  const offers: Record<string, unknown>[] = [];
  let clock = 1_000_000;
  const t = new TravelTogether();
  let where = standing();
  t.authority = () => authority;
  t.now = () => clock;
  t.send = (msg) => void sent.push(msg);
  t.note = (text) => void notes.push(text);
  t.onGo = (move) => void went.push(move);
  t.offerTrip = (w) => void offers.push(w as Record<string, unknown>);
  t.myMid = () => mid;
  t.leaderId = () => 5;
  t.leading = () => false;
  t.others = () => 2;
  t.isSpace = (id) => id.startsWith('space_');
  t.here = () => where;
  return {
    t,
    sent,
    notes,
    went,
    offers,
    pass(ms: number) {
      clock += ms;
    },
    stand(o: Partial<ReturnType<typeof standing>>) {
      where = { ...where, ...o };
    },
  };
}

{
  const m = make('me');
  m.t.leading = () => true;
  m.t.leaving('space_tatooine', '', 'space');
  m.t.arrived('space_tatooine', '', [1, 2, 3]);
  m.t.take(trip());
  ok(m.sent.length === 0, 'with no server not one word goes out');
  ok(m.offers.length === 0, 'and no trip is offered to anybody');
  ok(m.t.active === false, 'the module says so itself');
}

{
  const m = make();
  m.t.leading = () => true;
  m.t.leaving('space_tatooine', '', 'space', [7, 8, 9]);
  ok(m.offers.length === 1 && m.offers[0].planet === 'space_tatooine', 'a leader crossing offers the group the same trip');
  ok((m.offers[0].at as number[])[0] === 7, 'and names where they mean to come out when they know it');
  ok(m.sent[0].t === 'cross' && m.sent[0].phase === 'going', 'and tells the group they are on their way');
  m.t.leading = () => false;
  m.t.leaving('space_naboo', '', 'space');
  ok(m.offers.length === 1, 'a member who is not the leader offers nothing');
  ok(m.sent.length === 2 && m.sent[1].phase === 'going', 'but still says where they are going');
  m.t.leading = () => true;
  m.t.others = () => 0;
  m.t.leaving('tatooine', '', 'ground');
  ok(m.offers.length === 1, 'and a leader with nobody with them offers nothing');
  ok(m.sent.length === 2, 'and sends nothing either: a player on their own crosses worlds all evening and none of it is anybody else\'s business');
  m.t.arrived('tatooine', '', [1, 1, 1]);
  ok(m.sent.length === 2, 'arriving alone says nothing to anybody');
}

{
  const m = make();
  m.t.arrived('space_tatooine', '', [4, 5, 6]);
  ok(m.sent[0].phase === 'here' && (m.sent[0].at as number[])[1] === 5, 'arriving says where, to the group and to nobody else');
  ok(m.t.handle({ t: 'chat', id: 5, text: 'hello' }) === false, 'a word that is not ours is not ours');
  ok(m.t.handle({ t: 'cross', id: 5, from: 'them', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [100, 0, 0] }) === true, 'a cross from the group is read');
}

// A member takes a trip up and crosses the ordinary way: the point is asked for under the loading
// screen, and the leader's own place is what it stands beside.
{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  const move = m.t.take(trip());
  ok(move.do === 'travel' && m.went.length === 1, 'taking the trip up makes the crossing');
  const at = await m.t.followPoint('space_tatooine', '', true);
  ok(!!at && at[1] === 0, 'and it comes out at the place the leader reported');
  const off = spreadOffset(slotOf('m2'), TOGETHER_TUNE.spreadSpace);
  ok(!!at && Math.round(at[0] - 1000) === Math.round(off[0]) && Math.round(at[2]) === Math.round(off[2]), 'a step to one side of them, this member\'s own');
  ok((await m.t.followPoint('space_naboo', '', true)) === null, 'and nothing at all for a world this is not the trip to');
}

// The leader has not said where they came out yet: the wait is bounded and falls back on the point
// the offer named, which for a jump is exactly where it ends.
{
  tuneTogether({ waitMs: 30 });
  const m = make();
  m.t.take(trip({ at: [500, 0, 0] }));
  const started = Date.now();
  const at = await m.t.followPoint('space_tatooine', '', true);
  ok(Date.now() - started >= 25, 'with nothing heard it waits');
  ok(!!at && Math.round(at[0] - 500) === Math.round(spreadOffset(slotOf('m2'), TOGETHER_TUNE.spreadSpace)[0]), 'and then stands beside the place the offer named');
  ok(m.t.debug().waited >= 0 && m.t.debug().hadPlace === false, 'and says it never heard one');
}

// The word arrives while the crossing waits: the wait ends there and then.
{
  tuneTogether({ waitMs: 2000 });
  const m = make();
  m.t.take(trip({ at: [500, 0, 0] }));
  const waiting = m.t.followPoint('space_tatooine', '', true);
  setTimeout(() => m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [900, 0, 0] }), 10);
  const started = Date.now();
  const at = await waiting;
  ok(Date.now() - started < 1500, 'the wait ends the moment the leader says where they are');
  ok(!!at && Math.round(at[0] - 900) === Math.round(spreadOffset(slotOf('m2'), TOGETHER_TUNE.spreadSpace)[0]), 'and that is the place it stands beside');
  tuneTogether({ waitMs: 8000 });
}

// A place from before the crossing is not a place to stand at.
{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  m.pass(TOGETHER_TUNE.keepMs + 1000);
  tuneTogether({ waitMs: 0 });
  m.t.take(trip());
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'a place nobody has confirmed for two minutes is not followed');
  tuneTogether({ waitMs: 8000 });
}

// Where they said they were going is where they were standing before they left, and is no place to
// aim at on the world they are going to.
{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'going', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  tuneTogether({ waitMs: 0 });
  m.t.take(trip());
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'nobody stands beside where somebody set off from');
  tuneTogether({ waitMs: 8000 });
}

// A jump is aimed as it is taken up, not later: the whole of a jump is decided before it starts.
{
  const m = make();
  m.stand({ planet: 'space_tatooine', inSpace: true, flying: true });
  const move = m.t.take(trip({ planet: 'space_naboo', how: 'jump', at: [0, 0, 2000] }));
  ok(move.do === 'jump' && !!move.at, 'a jump after the group knows where it is going at once');
  ok(Math.round(move.at![2] - 2000) === Math.round(spreadOffset(slotOf('m2'), TOGETHER_TUNE.spreadSpace)[2]), 'beside them there too');
  ok((await m.t.followPoint('space_naboo', '', true)) === null, 'and it is not waiting on anything');
}

{
  const m = make();
  m.stand({ aboardOther: true });
  const move = m.t.take(trip());
  ok(move.do === 'stay' && m.went.length === 0, "a passenger in somebody else's hull is not carried off by the group");
  ok(m.notes.length === 1 && m.notes[0].includes('step out'), 'and is told to step out, which is something they can do about it');
}

// Whether a trip could be kept is answerable before saying yes, which is the whole point of it: the
// server counts an acceptance once and for all, so a yes that came to nothing would be a yes spent.
{
  const m = make();
  m.stand({ aboardOther: true });
  ok(m.t.canTake(trip()).do === 'stay', 'a trip this browser could not keep says so before it is accepted');
  ok(m.t.debug().taken === 0 && m.went.length === 0 && m.notes.length === 0, 'and asking changes nothing at all');
  m.stand({ aboardOther: false });
  ok(m.t.canTake(trip()).do === 'travel', 'and once they have stepped out the same trip is theirs to take');
}

// Where somebody set off from is not where they are: the word that begins a crossing throws their
// old place away, or a group going back to a world it has been to is sent to the point it came out
// at the time before.
{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  ok(m.t.debug().places === 1, 'the leader has been somewhere');
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'going', planet: 'space_naboo', zone: '', how: 'jump' });
  ok(m.t.debug().places === 0, 'and once they say they are on their way, that place is nobody\'s to stand beside');
  tuneTogether({ waitMs: 0 });
  m.t.take(trip());
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'so the world they left is followed to nothing');
  tuneTogether({ waitMs: 8000 });
}

// The offer's own point belongs to this trip; a place remembered belongs to the last one.
{
  const m = make();
  m.stand({ planet: 'space_tatooine', inSpace: true, flying: true });
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_naboo', zone: '', how: 'jump', at: [0, 0, 0] });
  const move = m.t.take(trip({ planet: 'space_naboo', how: 'jump', at: [0, 0, 5000] }));
  ok(move.do === 'jump' && Math.abs(move.at![2] - 5000) < TOGETHER_TUNE.spreadSpace + 1, 'a jump goes where this trip says, not where the last one ended');
}

// A place is only worth standing beside while whoever reported it is still somebody to travel with.
{
  const m = make();
  let mine = true;
  m.t.inGroup = () => mine;
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  tuneTogether({ waitMs: 0 });
  m.t.take(trip());
  ok((await m.t.followPoint('space_tatooine', '', true)) !== null, 'a member still in the group is followed');
  mine = false;
  m.t.take(trip());
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'somebody who has left the group is not');
  tuneTogether({ waitMs: 8000 });
}

// A crossing that finished ends the trip, whatever world it came out on, or the trip would be
// waiting for the next crossing to that world to take it for its own.
{
  const m = make();
  m.t.take(trip());
  ok(m.t.followingNow !== null, 'a trip taken up is being followed');
  m.t.arrived('tatooine', '', [0, 0, 0]);
  ok(m.t.followingNow === null, 'and arriving anywhere at all ends it');
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'so a later crossing to that world is its own');
}

// A trip whose crossing never arrived anywhere is dropped rather than left lying.
{
  const m = make();
  m.t.take(trip());
  m.pass(TOGETHER_TUNE.keepMs + 1000);
  ok((await m.t.followPoint('space_tatooine', '', true)) === null, 'a trip nobody ever arrived from is let go of');
  ok(m.t.followingNow === null, 'and is not held on to afterwards');
}

// Words from the far end are stripped the way the rest of the net side strips them: the control
// characters, and the overrides that reverse the rest of the line they land in.
{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_‮tatooine', zone: '', how: 'space', at: [1, 2, 3] });
  ok(m.t.debug().places === 1, 'a world name carrying a trick character is still read');
  tuneTogether({ waitMs: 0 });
  m.t.take(trip());
  const at = await m.t.followPoint('space_tatooine', '', true);
  ok(at !== null, 'and what is kept is the name with the character taken out of it');
  tuneTogether({ waitMs: 8000 });
}

{
  const m = make();
  m.t.handle({ t: 'cross', id: 5, from: 'lead', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [1000, 0, 0] });
  ok(m.t.debug().places === 1, 'a place heard is a place kept');
  m.t.clear();
  ok(m.t.debug().places === 0 && m.t.followingNow === null, 'a line that dropped leaves nothing behind');
}

{
  const m = make();
  for (let i = 0; i < TOGETHER_TUNE.places + 6; i++) {
    m.pass(10);
    m.t.handle({ t: 'cross', id: 100 + i, from: 'x', phase: 'here', planet: 'space_tatooine', zone: '', how: 'space', at: [i, 0, 0] });
  }
  ok(m.t.debug().places === TOGETHER_TUNE.places, 'the places kept never grow without bound');
}

// ---- the whole way round, against the server's own rules --------------------------------------------

{
  // The server, the leader's browser and a member's browser, with the offer going out of one and the
  // crossing coming out of the other. Nothing here is a shape this test invented: the server's
  // `Groups` writes the messages and the browser's `Groups` reads them.
  let clock = 5_000_000;
  const server = new ServerGroups({ now: () => clock });
  server.present('lead', { session: 1, name: 'Lead', planet: 'tatooine', zone: '' });
  server.present('mate', { session: 2, name: 'Mate', planet: 'tatooine', zone: '' });

  const mate = new BrowserGroups(() => clock / 1000);
  mate.authority = () => 'server';
  mate.selfId = () => 2;
  mate.serverNow = () => clock;
  const asked: Record<string, unknown>[] = [];
  mate.send = (msg) => void asked.push(msg);
  const m = make('server', '');
  m.t.myMid = () => mate.roster?.you ?? '';
  mate.onTravel = (where) => void m.t.take({ planet: where.planet, zone: where.zone, how: where.how, at: where.at });
  // Every line the server writes to this member goes into their browser, as the relay's fan-out does.
  const feed = (result: { tell?: { to: string[]; msg: Record<string, unknown> }[] }) => {
    for (const line of result.tell ?? []) if (line.to.includes('mate')) mate.handle(line.msg);
  };
  feed(server.invite('lead', 'mate', 10));
  feed(server.accept('mate'));
  ok(!!mate.roster, 'the member has a roster');

  feed(server.trip('lead', { planet: 'space_tatooine', zone: '', how: 'space', at: [1, 2, 3] }));
  ok(!!mate.trip && mate.trip.planet === 'space_tatooine', "the leader's offer reaches the member as an offer");
  ok(mate.trip!.at?.[2] === 3, 'with the place on it');

  mate.acceptTrip();
  ok(asked.some((a) => a.t === 'group' && a.do === 'travel'), 'saying yes asks the server, and nothing else');
  feed(server.travel('mate'));
  ok(m.went.length === 1 && m.went[0].planet === 'space_tatooine', 'and the crossing is made on the word coming back');

  // The group changes under a trip: whoever left is not offered it and cannot take it.
  feed(server.leave('mate'));
  const after = server.travel('mate');
  ok(after.ok === false, 'somebody who has left the group cannot take its trip');
  ok(m.went.length === 1, 'and nothing crosses for them');

  // A trip nobody took lapses on its own, and is then nobody's to take.
  server.present('mate', { session: 2, name: 'Mate', planet: 'tatooine', zone: '' });
  server.invite('lead', 'mate', 10);
  server.accept('mate');
  server.trip('lead', { planet: 'space_naboo', zone: '', how: 'jump', at: [0, 0, 0] });
  clock += 120000;
  server.tick();
  ok(server.travel('mate').ok === false, 'a trip nobody took lapses and moves nobody');
}

console.log(`crossing: ${checks} checks passed`);
