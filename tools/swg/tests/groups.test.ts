// A group on the server (server/groups.mjs): inviting someone within the distance the client's own
// radial menu table gives, accepting, declining, an invitation nobody answers, leaving, being put
// out, the leader changing hands, the eight the owner asked for, a place held while somebody
// reloads, the leader's offer of a trip, and the group's own chat line. Everything the browser can
// send goes through its checker first. Synthetic players only; no sockets and no clock but the one
// handed in, so every rule can be stepped by hand.
import assert from 'node:assert/strict';
import { GROUP_RANGES, GROUP_TUNING, Groups, cleanChat, cleanGroup, cleanWhere } from '../../../server/groups.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Tell = { to: string[]; msg: any };
type Result = { ok: boolean; why?: string; tell: Tell[] };

/**
 * A server with its own clock and its own postbox: every message the rules decide to send is kept
 * against the member it was sent to, exactly as the relay would fan it out.
 */
function server() {
  let t = 100000;
  const groups = new Groups({ now: () => t, tuning: { ...GROUP_TUNING } });
  const inbox = new Map<string, any[]>();
  const post = (r: Result) => {
    for (const line of r.tell) for (const key of line.to) inbox.set(key, [...(inbox.get(key) ?? []), line.msg]);
    return r;
  };
  let session = 0;
  return {
    groups,
    /** What a member has been sent since the postbox was last emptied. */
    to: (key: string) => inbox.get(key) ?? [],
    /** The last message of a kind a member was sent. */
    last: (key: string, what: string) => [...(inbox.get(key) ?? [])].reverse().find((m) => m.t === 'group' && m.do === what),
    /** Every message of a kind a member was sent. */
    all: (key: string, what: string) => (inbox.get(key) ?? []).filter((m) => m.t === 'group' && m.do === what),
    clear: () => inbox.clear(),
    /** Move the clock on. */
    wait: (ms: number) => {
      t += ms;
      post(groups.tick() as Result);
    },
    now: () => t,
    /** Somebody connects. Returns their member key, the one that outlives their line. */
    arrive(name: string, planet = 'tatooine') {
      const key = `c:${name.toLowerCase()}`;
      const id = ++session;
      post(groups.present(key, { session: id, name, planet, zone: '' }) as Result);
      return { key, id, name };
    },
    /** Their line closes. */
    drop(id: number) {
      post(groups.absent(id) as Result);
    },
    /** They come back on a new line, as a reload does. */
    back(key: string, name: string, planet = 'tatooine') {
      const id = ++session;
      post(groups.present(key, { session: id, name, planet, zone: '' }) as Result);
      return id;
    },
    do: (r: Result) => post(r),
  };
}

// --- 1: what a browser may send ------------------------------------------------------------------
{
  ok(cleanGroup({ t: 'group', do: 'invite', to: 4 })?.to === 4, '1: an invitation names the connection the browser already knows them by');
  ok(cleanGroup({ t: 'group', do: 'invite', name: 'Han' })?.name === 'Han', '1: or a name, for an invitation typed as a line by somebody with no id to hand');
  ok(cleanGroup({ t: 'group', do: 'invite', to: 0 }) === undefined && cleanGroup({ t: 'group', do: 'invite', to: 2.5, name: '' }) === undefined, '1: an invitation to nobody, or to half a connection, is dropped');
  ok(cleanGroup({ t: 'group', do: 'invite', to: 2.5, name: 'Han' })?.to === undefined, '1: and a name still stands when the id beside it is nonsense');
  ok(cleanGroup({ t: 'group', do: 'accept' })?.do === 'accept', '1: accepting carries nothing else');
  ok(cleanGroup({ t: 'group', do: 'kick', who: 'm3' })?.who === 'm3', '1: putting someone out names the member id the roster gives');
  ok(cleanGroup({ t: 'group', do: 'kick', who: 'c:han' }) === undefined, '1: and not anything else that might be a key');
  ok(cleanGroup({ t: 'group', do: 'promote' }) === undefined, '1: handing the group on with nobody named is dropped');
  ok(cleanGroup({ t: 'group', do: 'explode' }) === undefined, '1: a word nobody knows is dropped');
  ok(cleanGroup(null) === undefined && cleanGroup([1] as unknown as object) === undefined && cleanGroup({ do: 7 }) === undefined, '1: nothing, a list and a number are not a group message');
  const trip = cleanGroup({ t: 'group', do: 'trip', where: { planet: 'naboo', how: 'jump', at: [1, 2, 3] } });
  ok(trip?.where.planet === 'naboo' && trip.where.how === 'jump' && trip.where.at[2] === 3, '1: a trip carries the world, how it is got to and where to come out');
  ok(cleanWhere({ planet: 'naboo', how: 'teleport' })?.how === 'travel', '1: a way of travelling nobody knows is an ordinary journey');
  ok(cleanWhere({ planet: 'naboo', at: [1, 2, Number.NaN] })?.at === undefined, '1: a place that is not three numbers is left out rather than sent as nonsense');
  ok(cleanWhere({ planet: 'x'.repeat(80) })!.planet.length <= 24, '1: an over-long world name is cut to length');
  ok(cleanWhere({}) === undefined && cleanGroup({ t: 'group', do: 'trip', where: {} }) === undefined, '1: a trip to nowhere is dropped whole');
  const huge = cleanWhere({ planet: 'naboo', at: [1e308, -1e308, 5] })!.at;
  ok(huge[0] === GROUP_TUNING['where.limit'] && huge[1] === -GROUP_TUNING['where.limit'] && huge[2] === 5, '1: a place far bigger than any world is clamped rather than passed on to everybody');
  ok(cleanWhere({ planet: 'naboo', at: [0, 0, 0] }, { ...GROUP_TUNING, 'where.limit': 10 })!.at[0] === 0, '1: and the bound it is clamped to is one of the numbers a run can move');
}

// --- 2: what a chat line may be ------------------------------------------------------------------
{
  ok(cleanChat({ t: 'chat', text: 'hello' })?.scope === 'say', '2: a line with no scope is said to the world');
  ok(cleanChat({ t: 'chat', scope: 'group', text: 'hello' })?.scope === 'group', '2: or to the group');
  ok(cleanChat({ t: 'chat', scope: 'shout', text: 'hello' })?.scope === 'say', '2: a scope nobody knows is said to the world');
  ok(cleanChat({ t: 'chat', text: 'x'.repeat(500) })?.text.length === GROUP_TUNING['chat.length'], `2: an over-long line is cut to ${GROUP_TUNING['chat.length']} characters`);
  ok(cleanChat({ t: 'chat', text: 'a\u0000b\u001bc' })?.text === 'abc', '2: control characters are taken out');
  ok(cleanChat({ t: 'chat', text: '   ' }) === undefined && cleanChat({ t: 'chat', text: 42 }) === undefined, '2: a line of nothing, and a line that is not words, are not messages');
  ok(cleanChat({ t: 'chat', text: 'x'.repeat(40) }, { ...GROUP_TUNING, 'chat.length': 10 })?.text.length === 10, '2: the length it is cut to is the one the caller is working to, not this file\'s own copy');
}

// --- 3: the distances are the client's own ---------------------------------------------------------
{
  ok(GROUP_RANGES.invite === 90 && GROUP_RANGES.trade === 8 && GROUP_RANGES.duel === 128 && GROUP_RANGES.deathBlow === 10, '3: the ranges are the ones the client\'s radial menu table holds (invite 90 m, trade 8, duel 128, a death blow 10)');
  ok(GROUP_RANGES.noLimit === 16384, '3: and that table\'s way of writing "no limit" is kept as it is');

  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  ok(s.do(s.groups.invite(han.key, leia.key, 89.9) as Result).ok === true, '3: an invitation at just under the table\'s 90 m is made');
  s.do(s.groups.decline(leia.key) as Result);
  const far = s.do(s.groups.invite(han.key, leia.key, 90.1) as Result);
  ok(far.ok === false && /too far/.test(far.why!), `3: and one at just over it is refused (${far.why})`);
  const away = s.do(s.groups.invite(han.key, leia.key, Infinity) as Result);
  ok(away.ok === false && /too far/.test(away.why!), '3: somebody on another world is out of range by definition');
  ok(s.last(han.key, 'refused')?.why !== undefined && s.all(leia.key, 'refused').length === 0, '3: a refusal goes to whoever asked and to nobody else');
}

// --- 4: inviting, accepting and declining ------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  ok(s.last(leia.key, 'invited')?.from === han.id, '4: the one asked is told who asked, by the connection they see them on');
  ok(s.last(han.key, 'sent')?.name === 'Leia', '4: and the one asking is told it went');
  ok(s.groups.groupOf(han.key) === null, '4: nothing exists yet: an invitation is not a group');

  s.do(s.groups.accept(leia.key) as Result);
  const group = s.groups.groupOf(han.key);
  ok(!!group && s.groups.groupOf(leia.key) === group, '4: accepting makes the group, with both of them in it');
  const roster = s.last(leia.key, 'roster');
  ok(roster.members.length === 2 && roster.you === roster.members[1].m, '4: each of them is sent the roster with their own row named');
  ok(roster.members[0].leader === 1 && roster.leader === roster.members[0].m, '4: and whoever asked leads it');
  ok(roster.members[0].name === 'Han' && roster.members[0].planet === 'tatooine' && roster.members[0].here === 1, '4: a roster row says who, what world and whether they are here');
  ok(s.last(han.key, 'news')?.what === 'joined', '4: the group is told somebody joined');

  const again = s.do(s.groups.accept(leia.key) as Result);
  ok(again.ok === false, '4: accepting a second time has nothing to accept');

  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  s.do(s.groups.decline(luke.key) as Result);
  ok(s.last(han.key, 'news')?.what === 'declined', '4: turning an invitation down tells whoever sent it and nobody else');
  ok(s.groups.groupOf(luke.key) === null && s.all(luke.key, 'roster').length === 0, '4: and the one who declined is in no group and is sent no roster');

  const notLeader = s.do(s.groups.invite(leia.key, luke.key, 10) as Result);
  ok(notLeader.ok === false && /leader/.test(notLeader.why!), `4: only the leader can ask someone to join (${notLeader.why})`);
  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  const twice = s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  ok(twice.ok === false && /already been asked/.test(twice.why!), '4: and nobody is asked twice at once');

  // Turning one invitation down says nothing whatever about the ones you have out yourself. Taking
  // those back left the other side's screen holding an invitation this table no longer had, which is
  // the one thing a group living on the server is meant to make impossible.
  const chewie = s.arrive('Chewie');
  s.do(s.groups.invite(luke.key, chewie.key, 10) as Result);
  s.do(s.groups.decline(luke.key) as Result);
  ok(s.groups.invited.has(chewie.key), '4: turning an invitation down leaves standing the one you had sent');
  ok(s.all(chewie.key, 'gone').length === 0, '4: and nobody is told an invitation they are still holding has gone');
  ok(s.do(s.groups.accept(chewie.key) as Result).ok === true, '4: so it can still be accepted');
  ok(s.groups.groupOf(luke.key) === s.groups.groupOf(chewie.key) && s.groups.groupOf(luke.key) !== null, '4: and the two of them are in a group of their own');
}

// --- 5: an invitation nobody answers -----------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.wait(GROUP_TUNING['invite.wait'] - 1000);
  ok(s.last(han.key, 'news') === undefined, '5: an invitation stands while it has time left');
  s.wait(2000);
  ok(s.last(han.key, 'news')?.what === 'lapsed', '5: and is taken back when it runs out, with a word to whoever sent it');
  ok(s.last(leia.key, 'gone') !== undefined, '5: the one asked is told it is no longer there to accept');
  const late = s.do(s.groups.accept(leia.key) as Result);
  ok(late.ok === false, '5: accepting afterwards finds nothing');

  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.invite(leia.key, luke.key, 10) as Result);
  s.wait(GROUP_TUNING['invite.wait'] + 1000);
  ok(s.groups.invited.size === 0, '5: every invitation with no time left on it goes, each on its own clock');
  ok(s.last(leia.key, 'news')?.what === 'lapsed' && s.last(han.key, 'news')?.what === 'lapsed', '5: and each sender is told about their own');
}

// --- 6: eight, and no more ---------------------------------------------------------------------------
{
  const s = server();
  const leader = s.arrive('Leader');
  const rest = Array.from({ length: 8 }, (_, i) => s.arrive(`Friend${i}`));
  for (const one of rest) {
    s.do(s.groups.invite(leader.key, one.key, 10) as Result);
    s.do(s.groups.accept(one.key) as Result);
  }
  const group = s.groups.groupOf(leader.key)!;
  ok(group.members.size === GROUP_TUNING.members, `6: a group fills up at ${GROUP_TUNING.members} and no further`);
  const full = s.do(s.groups.invite(leader.key, rest[7].key, 10) as Result);
  ok(full.ok === false && /holds 8/.test(full.why!), `6: and a ninth is refused with a reason to read (${full.why})`);
  ok(s.groups.groupOf(rest[7].key) === null, '6: the one left out is in no group');
}

// --- 7: leaving, being put out, and the leader changing hands -------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  const luke = s.arrive('Luke');
  for (const one of [leia, luke]) {
    s.do(s.groups.invite(han.key, one.key, 10) as Result);
    s.do(s.groups.accept(one.key) as Result);
  }
  const group = s.groups.groupOf(han.key)!;
  const midOf = (key: string) => group.members.get(key)?.mid;

  const notLeader = s.do(s.groups.kick(leia.key, midOf(luke.key)!) as Result);
  ok(notLeader.ok === false && /only the leader/.test(notLeader.why!), '7: only the leader can put somebody out');
  s.do(s.groups.kick(han.key, midOf(luke.key)!) as Result);
  ok(s.groups.groupOf(luke.key) === null && s.last(luke.key, 'none')?.why === 'kicked', '7: being put out leaves you in no group, and says so');
  ok(s.last(leia.key, 'news')?.what === 'kicked' && s.last(leia.key, 'roster').members.length === 2, '7: and the rest are told, with a roster that no longer holds them');

  s.do(s.groups.kick(han.key, midOf(han.key)!) as Result);
  ok(s.groups.groupOf(han.key) === group, '7: a leader cannot put themselves out that way');

  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  s.do(s.groups.accept(luke.key) as Result);
  s.do(s.groups.promote(han.key, midOf(luke.key)!) as Result);
  ok(group.leader === luke.key && s.last(leia.key, 'roster').leader === midOf(luke.key), '7: the leader can hand the group on');
  const back = s.do(s.groups.promote(han.key, midOf(leia.key)!) as Result);
  ok(back.ok === false, '7: and cannot hand on what is no longer theirs');

  s.do(s.groups.leave(luke.key) as Result);
  ok(group.leader === han.key, '7: a leader who leaves hands the group to whoever has been in it longest');
  ok(s.last(han.key, 'news')?.what === 'leader', '7: and the group is told who has it now');

  s.do(s.groups.leave(leia.key) as Result);
  s.do(s.groups.leave(han.key) as Result);
  ok(s.groups.byId.size === 0, '7: the last one out closes the group');
  ok(s.do(s.groups.leave(han.key) as Result).ok === false, '7: and leaving twice takes nothing from anyone');
}

// --- 8: disbanding -----------------------------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  const notLeader = s.do(s.groups.disband(leia.key) as Result);
  ok(notLeader.ok === false && /only the leader/.test(notLeader.why!), '8: only the leader can close the group');
  s.do(s.groups.disband(han.key) as Result);
  ok(s.groups.groupOf(han.key) === null && s.groups.groupOf(leia.key) === null, '8: closing it puts everybody out');
  ok(s.last(leia.key, 'none')?.why === 'disbanded' && s.last(leia.key, 'news')?.what === 'disbanded', '8: and everybody is told, in the same words leaving uses');
  ok(s.groups.byId.size === 0, '8: nothing is left behind');
}

// --- 9: a place held while somebody reloads -------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  const group = s.groups.groupOf(han.key)!;

  s.drop(leia.id);
  ok(s.groups.groupOf(leia.key) === group, '9: a line closing does not take somebody out of their group');
  ok(s.last(han.key, 'news')?.what === 'away' && s.last(han.key, 'roster').members[1].here === 0, '9: the others are told they have stepped out, and the roster says so');
  ok(s.groups.sessionOf(leia.key) === 0, '9: and there is no line to write to while they are gone');
  ok(group.members.size === 2, '9: their place still counts against the group\'s size, so a reload cannot be locked out of it');

  s.wait(GROUP_TUNING.hold - 2000);
  ok(s.groups.groupOf(leia.key) === group, '9: the place is still held a moment before the time is up');
  const again = s.back(leia.key, 'Leia');
  ok(s.groups.sessionOf(leia.key) === again && s.last(han.key, 'news')?.what === 'back', '9: coming back on a new line picks the same place up, and the group is told');
  ok(s.last(leia.key, 'roster').members.length === 2 && s.last(leia.key, 'roster').members[1].here === 1, '9: and whoever came back is sent the roster as it stands');

  s.drop(again);
  s.wait(GROUP_TUNING.hold + 1000);
  ok(s.groups.groupOf(leia.key) === null && s.last(han.key, 'news')?.what === 'gone', '9: a place nobody comes back for is given up');
  ok(s.groups.byId.size === 1 && group.members.size === 1, '9: and the group carries on without them');

  // The same character opened in a second browser. The server hands it to the newer one and closes
  // the older, and that closing must not read as the member stepping out of their group -- they are
  // standing right there, on the other line.
  const twice = s.back(han.key, 'Han');
  s.drop(han.id);
  ok(s.groups.sessionOf(han.key) === twice, '9: a character taken over by a second browser is reachable on the newer line');
  ok(s.groups.groupOf(han.key)!.members.get(han.key)!.awaySince === 0, '9: and the older line closing behind it does not start a clock on their place');

  // A leader who goes and does not come back: the group must not be left with nobody who can ask
  // anyone to join.
  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  s.do(s.groups.accept(luke.key) as Result);
  s.drop(twice);
  ok(group.leader === han.key, '9: a leader whose line closes still leads while their place is held');
  s.wait(GROUP_TUNING.hold + 1000);
  ok(group.leader === luke.key && s.last(luke.key, 'news')?.what === 'leader', '9: and hands it on only when the place is given up');
}

// --- 10: travelling together -------------------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  const where = { planet: 'naboo', zone: '', how: 'travel', at: [10, 0, 20] };

  const notLeader = s.do(s.groups.trip(leia.key, where) as Result);
  ok(notLeader.ok === false && /leader/.test(notLeader.why!), '10: only the leader offers a trip');
  s.do(s.groups.trip(han.key, where) as Result);
  const offer = s.last(leia.key, 'trip');
  ok(offer?.where.planet === 'naboo' && offer.until === s.now() + GROUP_TUNING['trip.wait'], '10: everyone else is offered it, with a time on it');
  ok(s.all(han.key, 'trip').length === 0, '10: and the leader is not offered their own trip');
  ok(s.groups.groupOf(leia.key)!.members.get(leia.key)!.planet === 'tatooine', '10: nobody is moved by an offer: it is an offer');

  const taken = s.do(s.groups.travel(leia.key) as Result) as Result & { where?: object };
  ok(taken.ok === true && s.last(han.key, 'travelling')?.who !== undefined, '10: taking it up tells the group who is coming');
  ok(JSON.stringify(taken.where) === JSON.stringify(where), '10: and gives the browser the same place the leader named');
  const twice = s.do(s.groups.travel(leia.key) as Result);
  ok(twice.ok === false, '10: each of them takes it up once: saying so again tells the group nothing it has not heard');
  s.do(s.groups.place(leia.key, { name: 'Leia', planet: 'naboo', zone: '' }) as Result);
  ok(s.last(han.key, 'roster').members[1].planet === 'naboo', '10: arriving shows in the roster, so a member on another world still reads as one');

  s.wait(GROUP_TUNING['trip.wait'] + 1000);
  ok(s.do(s.groups.travel(leia.key) as Result).ok === false, '10: an offer nobody took lapses');
}

// --- 11: the group's own chat line ---------------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  s.do(s.groups.place(leia.key, { name: 'Leia', planet: 'naboo', zone: '' }) as Result);

  const heard = s.groups.chatTo(han.key)!;
  ok(heard.length === 2 && heard.includes(leia.key), '11: a line to the group reaches a member on another planet');
  ok(heard.includes(han.key), '11: and comes back to whoever said it, so everyone reads the same words in the same order');
  ok(!heard.includes(luke.key), '11: and reaches nobody outside the group');
  ok(s.groups.chatTo(luke.key) === null, '11: somebody in no group has nobody to say it to');

  let allowed = 0;
  for (let i = 0; i < 12; i++) if (s.groups.mayChat(han.key)) allowed++;
  ok(allowed === GROUP_TUNING['chat.perSecond'], `11: one browser may send ${GROUP_TUNING['chat.perSecond']} lines a second and the rest are dropped`);
  s.wait(1000);
  ok(s.groups.mayChat(han.key) === true, '11: and may speak again the next second');
  ok(s.groups.mayChat('c:nobody') === false, '11: somebody who is not here says nothing');
}

// --- 12: what the server has to show for itself ----------------------------------------------------------
{
  const s = server();
  ok(s.groups.describe() === 'nobody grouped', '12: with nobody grouped the status page says so');
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  ok(/\*Han/.test(s.groups.describe()) && /Leia/.test(s.groups.describe()), `12: and with one it names the leader and the rest (${s.groups.describe()})`);
  s.drop(leia.id);
  ok(/Leia \(away\)/.test(s.groups.describe()), '12: somebody whose place is being held reads as away');
  ok(s.groups.keyOf(han.id) === han.key && s.groups.keyOf(9999) === null, '12: a connection can be turned back into the member holding it');
}

// --- 13: nothing is left behind -----------------------------------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.drop(leia.id);
  ok(s.groups.invited.size === 0, '13: an invitation to somebody whose line closes is taken back');
  ok(s.last(han.key, 'news')?.what === 'withdrawn', '13: and whoever sent it is told, rather than being left reading that it is still out');
  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  s.drop(han.id);
  ok(s.groups.invited.size === 0 && s.last(luke.key, 'gone') !== undefined, '13: and so is one sent by somebody whose line closes, with a word to the one asked');
  ok(s.groups.people.has(han.key) === false, '13: somebody who has gone and is in no group is not remembered at all');
  s.wait(GROUP_TUNING.hold * 2);
  ok(s.groups.byId.size === 0 && s.groups.byKey.size === 0 && s.groups.people.size === 1, '13: and after everything has lapsed only the one still connected is held');
}

// --- 14: what one browser cannot do by holding a key down --------------------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const crowd = Array.from({ length: GROUP_TUNING['invite.out'] + 2 }, (_, i) => s.arrive(`Face${i}`));
  let sent = 0;
  for (const one of crowd) if (s.do(s.groups.invite(han.key, one.key, 10) as Result).ok) sent++;
  ok(sent === GROUP_TUNING['invite.out'], `14: somebody in no group may have ${GROUP_TUNING['invite.out']} invitations out and no more`);
  ok(s.groups.invited.has(crowd[crowd.length - 1].key) === false, '14: so one browser cannot put a standing invitation on everybody connected and lock the rest out of being asked');

  let asks = 0;
  for (let i = 0; i < 20; i++) if (s.groups.mayAsk(han.key)) asks++;
  ok(asks === GROUP_TUNING['ask.perSecond'], `14: one browser may ask a group for ${GROUP_TUNING['ask.perSecond']} decisions a second and the rest are ignored`);
  s.wait(1000);
  ok(s.groups.mayAsk(han.key) === true, '14: and may ask again the next second');
  ok(s.groups.mayAsk('c:nobody') === false, '14: somebody who is not here asks for nothing');
}

// --- 15: health, and a group that closes with an invitation still out ----------------------------------
{
  const s = server();
  const han = s.arrive('Han');
  const leia = s.arrive('Leia');
  s.do(s.groups.invite(han.key, leia.key, 10) as Result);
  s.do(s.groups.accept(leia.key) as Result);
  s.clear();

  s.do(s.groups.note(han.key, { hp: 0.5 }) as Result);
  ok(s.last(leia.key, 'health')?.hp === 0.5 && s.last(leia.key, 'health')?.who === 'm1', '15: a change of health is one line naming the member and the number, not the whole roster');
  ok(s.all(leia.key, 'roster').length === 0, '15: and the roster is left for what changes the rows themselves');
  s.clear();
  s.do(s.groups.note(han.key, { hp: 0.5004 }) as Result);
  ok(s.all(leia.key, 'health').length === 0, '15: health is rounded to what a bar can show, so a number creeping under that tells nobody anything');
  s.do(s.groups.note(han.key, { hp: 0.49 }) as Result);
  ok(s.last(leia.key, 'health')?.hp === 0.49, '15: and a change it can show is told at once');
  ok(s.groups.groupOf(han.key)!.members.get(han.key)!.hp === 0.49, '15: a roster built afterwards carries the same number');
  s.do(s.groups.note(han.key, { hp: 7 }) as Result);
  ok(s.last(leia.key, 'health')?.hp === 1, '15: health outside what health can be is clamped rather than passed on');

  const luke = s.arrive('Luke');
  s.do(s.groups.invite(han.key, luke.key, 10) as Result);
  s.do(s.groups.disband(han.key) as Result);
  ok(s.groups.invited.size === 0 && s.last(luke.key, 'gone') !== undefined, '15: a group closing with an invitation still out takes it back and tells the one it was sent to');
}

console.log(`\n${checks} checks passed`);
