// The browser's half of a fireteam and of the chat line, driven with no page and no socket.
//
// What is pinned here is what would be expensive to find by playing. With no server the whole thing
// has to be quiet: not one word may go out, because a browser with no address set must be the game
// exactly as it was. The roster has to be read from the shape the server really sends
// (server/groups.mjs's `rosterRow`: a member id, the connection it is on, and a leader flag), because
// a kick names the member id and a distance names the connection, and reading one as the other is a
// bug nobody would see until two people were standing in a field. A line of chat comes back from the
// server, the speaker's own included, so the speaker's copy must be known for their own rather than
// shown twice. And the words a stranger typed are never anything but words.
//
// `src/net/groups.ts` imports nothing but a type, so it runs here as it is.
import assert from 'node:assert/strict';
import { GROUP_RANGE, GROUP_TUNE, Groups, cleanText, newsWords, parseLine, pickLookedAt, tuneGroups } from '../../../src/net/groups.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A group with a server on the other end, and everything it was told kept for the test to read. */
function make(authority: 'me' | 'server' = 'server', me = 7) {
  const sent: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const heard: { name: string; text: string; mine: boolean; scope: string }[] = [];
  let clock = 1_000_000;
  const g = new Groups(() => clock / 1000);
  g.authority = () => authority;
  g.selfId = () => me;
  g.serverNow = () => clock;
  g.send = (msg) => void sent.push(msg);
  g.onNote = (text) => void notes.push(text);
  g.onChat = (line) => void heard.push({ name: line.name, text: line.text, mine: line.mine, scope: line.scope });
  const places = new Map<number, [number, number, number]>();
  g.meAt = (out) => {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return true;
  };
  g.peerAt = (id, out) => {
    const p = places.get(id);
    if (!p) return false;
    out.x = p[0];
    out.y = p[1];
    out.z = p[2];
    return true;
  };
  return {
    g,
    sent,
    notes,
    heard,
    places,
    at(ms: number) {
      clock = ms;
    },
    pass(ms: number) {
      clock += ms;
    },
    /** The roster the server really sends: `{ do: 'roster', id, leader, you, members: [{ m, s, ... }] }`. */
    roster(rows: { m: string; s: number; name: string; planet?: string; zone?: string; hp?: number | null; here?: number }[], leader: string, you: string) {
      g.handle({ t: 'group', do: 'roster', id: 'g1', leader, you, members: rows.map((r) => ({ hp: null, planet: 'tatooine', zone: '', here: 1, ...r, leader: r.m === leader ? 1 : 0 })) });
    },
  };
}

// ---- with no server, nothing at all ---------------------------------------------------------------

{
  const t = make('me');
  ok(t.g.active === false, 'with no server the group is not active');
  const why = t.g.say('hello');
  ok(t.sent.length === 0, 'a line typed with no server sends nothing');
  ok(!!why && t.heard.length === 1 && t.heard[0].mine, 'it is still shown to whoever typed it, with a word saying nobody heard');
  ok(t.g.askInvite(9, 'han') !== '' && t.sent.length === 0, 'an invitation with no server sends nothing and says why');
  t.g.leave();
  t.g.kick('m2');
  t.g.promote('m2');
  t.g.disband();
  t.g.accept();
  t.g.decline();
  ok(t.sent.length === 0, 'nothing a group can be asked for goes out with no server');
  ok(t.g.type('/who') === 'there is no server here: you are on your own', '/who says so rather than looking like a broken group');
  ok(t.g.roster === null && t.g.invite === null && t.g.trip === null, 'there is no roster, no invitation and no trip');
}

// ---- reading a typed line --------------------------------------------------------------------------

{
  ok(parseLine('hello there').kind === 'chat' && parseLine('hello there').scope === 'say', 'plain words are said aloud');
  const grouped = parseLine('/g on my way');
  ok(grouped.kind === 'chat' && grouped.scope === 'group' && grouped.text === 'on my way', '/g puts the words on the group channel');
  ok(parseLine('/group').kind === 'command' && parseLine('/group').command === 'group', '/g with nothing after it is a command, not an empty line');
  ok(parseLine('/say').kind === 'command' && parseLine('/say').command === 'say', 'and so is /say with nothing after it: it is the way back to the aloud channel');
  const inv = parseLine('/invite Han Solo');
  ok(inv.kind === 'command' && inv.command === 'invite' && inv.arg === 'Han Solo', 'a command keeps the whole of what follows it');
  ok(parseLine('/').kind === 'empty', 'a lone slash sends nothing');
  ok(parseLine('   ').kind === 'empty', 'whitespace sends nothing');
  ok(parseLine('/INVITE bob').command === 'invite', 'a command is read whatever case it was typed in');
  // A line that was set to the group channel stays on it when nothing in the line says otherwise.
  ok(parseLine('carry on', 'group').scope === 'group', 'the channel the line is open on is the one plain words go on');
  ok(parseLine('/say back here', 'group').scope === 'say', '/say puts one line back on the aloud channel');
  const long = cleanText('x'.repeat(GROUP_TUNE.chars + 50));
  ok(long.length === GROUP_TUNE.chars, 'a line is cut to the length the server also cuts to');
  ok(cleanText('a\u0000b\u001fc\nd') === 'a b c d', 'control characters never survive, so nothing can be smuggled through a name');
  // Written as escapes, never as the bytes themselves: a NUL in a source file makes git call the whole
  // blob binary, and an editor that normalises on save would quietly take it out and leave a test that
  // proves nothing. The same is true of src/net/groups.ts's own character class.
  ok(cleanText('a\u202eb') === 'a b', 'so does a mark that would turn the rest of a line round: a name is words, not a trick');
  ok(cleanText(12 as unknown) === '' && cleanText(null) === '', 'anything that is not a string is nothing');
}

// ---- the player you are looking at -------------------------------------------------------------------

{
  const list = [
    { id: 1, name: 'ahead', x: 0, y: 0, z: -10 },
    { id: 2, name: 'beside', x: 10, y: 0, z: -10 },
    { id: 3, name: 'far', x: 0, y: 0, z: -200 },
    { id: 4, name: 'behind', x: 0, y: 0, z: 10 },
  ];
  const looked = pickLookedAt(list, list.length, 0, 1.6, 0, 0, 0, -1);
  ok(looked === 1, 'the one in the middle of the view is the one being looked at');
  ok(pickLookedAt(list, list.length, 0, 1.6, 0, 0, 0, 1) === 4, 'turning round picks the one behind');
  ok(pickLookedAt([list[2]], 1, 0, 1.6, 0, 0, 0, -1) === 0, `nothing past ${GROUP_RANGE.invite} m is looked at, which is the game's own reach`);
  ok(pickLookedAt([list[1]], 1, 0, 1.6, 0, 0, 0, -1) === 0, 'somebody well off to the side is not being looked at');
  ok(pickLookedAt(list, list.length, 0, 1.6, 0, 0, 0, 0) === 0, 'a direction of nothing picks nobody rather than throwing');
  // Two in the cone: the one nearer the middle wins, not the nearer one.
  const two = [
    { id: 5, name: 'off-centre', x: 1, y: 0, z: -6 },
    { id: 6, name: 'dead ahead', x: 0, y: 0, z: -20 },
  ];
  ok(pickLookedAt(two, 2, 0, 1.2, 0, 0, 0, -1) === 6, 'the one nearest the middle of the view wins, not the nearest one');
}

// ---- the roster, in the shape the server really sends -------------------------------------------------

{
  const t = make();
  t.roster(
    [
      { m: 'm1', s: 7, name: 'You' },
      { m: 'm2', s: 8, name: 'Han' },
      { m: 'm3', s: 0, name: 'Chewie', here: 0 },
    ],
    'm1',
    'm1',
  );
  const g = t.g.roster!;
  ok(!!g && g.members.length === 3, 'the roster is read');
  ok(g.members[0].me && g.members[0].leader, 'the row the server marked as yours is yours, and the leader is the leader');
  ok(t.g.leading, 'leading is read off the member ids, not off a connection number');
  ok(g.members[1].id === 8, "a member's connection is kept, which is what every other message names them by");
  ok(g.members[2].here === false, 'a member whose line has closed keeps their place and is not here');
  ok(g.members[0].hp === -1, 'health that nothing carries yet reads as unknown rather than as zero');
  // The leader's own asking.
  t.g.kick('m2');
  t.g.promote('m3');
  ok(t.sent.some((m) => m.do === 'kick' && m.who === 'm2'), 'a kick names the member id the roster gave');
  ok(t.sent.some((m) => m.do === 'promote' && m.who === 'm3'), 'so does a promotion');
  t.sent.length = 0;
  t.g.kick('m1');
  ok(t.sent.length === 0, 'the leader cannot put themselves out');
  // Not the leader: the buttons are not even sent.
  t.roster(
    [
      { m: 'm1', s: 8, name: 'Han' },
      { m: 'm2', s: 7, name: 'You' },
    ],
    'm1',
    'm2',
  );
  ok(!t.g.leading, 'someone else leading is read the same way');
  t.sent.length = 0;
  t.g.kick('m1');
  t.g.disband();
  ok(t.sent.length === 0, 'a member who does not lead asks for neither');
  // The group ending.
  t.g.handle({ t: 'group', do: 'none', why: 'disbanded' });
  ok(t.g.roster === null && t.notes[t.notes.length - 1] === 'the group broke up', 'one word from the server ends the group, in words a player can read');
}

// ---- the distances, at a rate, and only for people who are here ----------------------------------------

{
  const t = make();
  t.roster(
    [
      { m: 'm1', s: 7, name: 'You' },
      { m: 'm2', s: 8, name: 'Han' },
      { m: 'm3', s: 0, name: 'Chewie', here: 0 },
    ],
    'm1',
    'm1',
  );
  t.places.set(8, [30, 0, 40]);
  const moved = t.g.step(1);
  const g = t.g.roster!;
  ok(moved, 'the first step says something a panel shows has changed');
  ok(g.members[1].distance === 50, 'a member on this world is measured from where their figure last was');
  ok(g.members[0].distance === 0 && g.members[2].distance === -1, 'your own row is here, and a member who is away has no distance');
  ok(t.g.step(0.01) === false, 'nothing moving means nothing to write: a panel writes only when it has to');
  t.places.set(8, [3, 0, 4]);
  ok(t.g.step(1) === true && g.members[1].distance === 5, 'a member who has moved is measured again at the next pass');
  ok(t.g.roster === g, 'reading the roster allocates nothing: it is the same object between changes');
  // Out of range for an invitation, which is the game's 90 m.
  t.places.set(9, [0, 0, 200]);
  const far = t.g.askInvite(9, 'Lando');
  ok(far.includes(`${GROUP_RANGE.invite} m`) && !t.sent.some((m) => m.do === 'invite'), "somebody too far off is not asked, and the reach quoted is the game's");
  t.places.set(9, [0, 0, 20]);
  ok(t.g.askInvite(9, 'Lando') === '' && t.sent.some((m) => m.do === 'invite' && m.to === 9), 'somebody within reach is asked, by the connection the browser knows them by');
}

// ---- an invitation, its countdown and its end ------------------------------------------------------------

{
  const t = make();
  t.at(500_000);
  t.g.handle({ t: 'group', do: 'invited', from: 8, name: 'Han', until: 500_000 + 30_000 });
  ok(t.g.invite?.from === 8 && Math.round(t.g.invite.left) === 30, "the wait is read off the server's own clock, not counted here");
  t.pass(10_000);
  t.g.step(0.25);
  ok(Math.round(t.g.invite!.left) === 20, 'the countdown follows the shared clock');
  t.g.accept();
  ok(t.sent.some((m) => m.t === 'group' && m.do === 'accept') && t.g.invite === null, 'accepting says so and takes the question down');
  // One that nobody answers.
  t.g.handle({ t: 'group', do: 'invited', from: 8, name: 'Han', until: t.g.serverNow() + 5000 });
  t.pass(6000);
  t.g.step(0.25);
  ok(t.g.invite === null && t.notes.includes('the invitation ran out'), 'an invitation nobody answered goes, with a word about it');
  // One taken back by the server.
  t.g.handle({ t: 'group', do: 'invited', from: 8, name: 'Han', until: t.g.serverNow() + 30_000 });
  t.g.handle({ t: 'group', do: 'gone' });
  ok(t.g.invite === null, "the server's own word takes an invitation back");
  ok(t.g.handle({ t: 'group', do: 'invited', from: 0, name: 'nobody' }) && t.g.invite === null, 'an invitation from nobody is not one');
}

// ---- chat -------------------------------------------------------------------------------------------------

{
  const t = make();
  t.g.say('hello there');
  ok(t.sent.some((m) => m.t === 'chat' && m.scope === 'say' && m.text === 'hello there'), 'a line goes out on the channel it was said on');
  ok(t.heard.length === 0, 'and is not shown until the server sends it back, so everyone reads the same order');
  t.g.handle({ t: 'chat', id: 7, from: 'You', scope: 'say', text: 'hello there' });
  ok(t.heard.length === 1 && t.heard[0].mine, 'the speaker knows their own line when it comes back');
  t.g.handle({ t: 'chat', id: 8, from: 'Han', scope: 'group', text: 'on my way' });
  ok(t.heard[1].mine === false && t.heard[1].scope === 'group' && t.heard[1].name === 'Han', "somebody else's line is theirs, on the channel they said it on");
  t.g.handle({ t: 'chat', id: 8, from: 'Han', scope: 'say', text: '   ' });
  ok(t.heard.length === 2, 'a line of nothing is not a line');
  t.g.handle({ t: 'chat', id: 8, from: '<script>x</script>', scope: 'say', text: '<b>hi</b>' });
  ok(t.heard[2].name === '<script>x</script>' && t.heard[2].text === '<b>hi</b>', 'words are kept as words: nothing here reads them, and whatever shows them writes text');
  // The log does not grow without end.
  for (let i = 0; i < GROUP_TUNE.log + 10; i++) t.g.handle({ t: 'chat', id: 8, from: 'Han', scope: 'say', text: `line ${i}` });
  ok(t.g.log.length === GROUP_TUNE.log, 'the log keeps the last few lines and no more');
  ok(t.g.log[t.g.log.length - 1].text === `line ${GROUP_TUNE.log + 9}`, 'and the last of them is the last thing said');
  // A line to a group you are not in.
  const before = t.sent.length;
  ok(t.g.say('anyone?', 'group') === 'you are not in a group' && t.sent.length === before, 'a group line with no group says so rather than going nowhere quietly');
}

// ---- the commands ---------------------------------------------------------------------------------------

{
  const t = make();
  t.roster(
    [
      { m: 'm1', s: 7, name: 'You' },
      { m: 'm2', s: 8, name: 'Han Solo' },
    ],
    'm1',
    'm1',
  );
  t.sent.length = 0;
  t.g.type('/kick han');
  ok(t.sent.some((m) => m.do === 'kick' && m.who === 'm2'), 'a name in a command is matched to the member id, however it was typed');
  ok(t.g.type('/kick nobody') === 'nobody in the group is called nobody', 'a name nobody has says so');
  ok(t.g.type('/who').startsWith('group of 2:'), '/who reads the group out');
  ok(t.g.type('/nonsense') === 'there is no /nonsense', 'a command nothing knows says so rather than being said aloud');
  ok(t.g.type('/trade').includes('comes later'), 'a command from a later wave says it is not here yet');
  t.g.peerByName = (name) => (name.toLowerCase() === 'lando' ? 9 : 0);
  t.places.set(9, [0, 0, 10]);
  t.sent.length = 0;
  t.g.type('/invite Lando');
  ok(t.sent.some((m) => m.do === 'invite' && m.to === 9), '/invite finds whoever is standing here by name');
  ok(t.g.type('/invite Boba') === 'nobody here is called Boba', 'and says so when nobody of that name is here');
  t.sent.length = 0;
  t.g.type('/g on my way');
  ok(t.sent.some((m) => m.t === 'chat' && m.scope === 'group' && m.text === 'on my way'), '/g in the typed line reaches the group channel');
  // Switching channel is a line that does its work quietly, not a command nothing knows: the line the
  // player types it on is what moves, and saying "there is no /group" at them was plainly wrong.
  ok(t.g.type('/g') === '' && t.g.type('/say') === '', 'moving between channels is a line that says nothing back');
  const alone = make();
  ok(alone.g.type('/g') === 'you are not in a group', 'and with no group to talk to it says so');
}

// ---- the chat's own rate, so that a line the server drops is not simply invisible -------------------------

{
  const t = make();
  t.g.say('one');
  t.g.say('two');
  t.g.say('three');
  t.g.say('four');
  const sentWas = t.sent.length;
  const fifth = t.g.say('five');
  ok(sentWas === 4 && t.sent.length === 4, "the server's own rate is kept to here as well, so nothing goes out to be dropped");
  ok(fifth !== '', `and the player is told why rather than typing into nothing ("${fifth}")`);
  t.pass(1200);
  ok(t.g.say('later') === '' && t.sent.length === 5, 'a moment later the next line goes as it should');
}

// ---- a roster that cannot be read is not the group ending ---------------------------------------------------

{
  const t = make();
  t.roster(
    [
      { m: 'm1', s: 7, name: 'You' },
      { m: 'm2', s: 8, name: 'Han' },
    ],
    'm1',
    'm1',
  );
  const had = t.g.roster;
  const notesWas = t.notes.length;
  t.g.handle({ t: 'group', do: 'roster', id: 'g1', leader: 'm1', you: 'm1', members: 'nonsense' });
  ok(t.g.roster === had, 'a roster that cannot be read leaves the group standing: ending it is the ending message\'s job');
  ok(t.notes.length === notesWas, 'and says nothing, because nothing has happened');
  t.g.handle({ t: 'group', do: 'none', why: 'left' });
  ok(t.g.roster === null, 'the message that does end it still ends it');
}

// ---- somebody who is not on this world at all ------------------------------------------------------------------

{
  const t = make();
  const why = t.g.askInvite(9, 'Lando');
  ok(why.includes('not on this world') && !why.includes(String(GROUP_RANGE.unlimited)), `somebody on another world is said to be, not measured at the table's "no limit" (${why})`);
  ok(t.sent.length === 0, 'and nothing is sent');
}

// ---- the news, and a trip ---------------------------------------------------------------------------------

{
  ok(newsWords('joined', 'Han') === 'Han joined the group', 'the server sends the word and this side puts it in words');
  ok(newsWords('leader', 'Han') === 'Han leads the group', 'so for the lead changing hands');
  ok(newsWords('nonsense', 'Han') === '', 'a word this browser does not know says nothing at all, rather than something odd');

  const t = make();
  t.roster(
    [
      { m: 'm1', s: 8, name: 'Han' },
      { m: 'm2', s: 7, name: 'You' },
    ],
    'm1',
    'm2',
  );
  t.at(900_000);
  t.g.handle({ t: 'group', do: 'trip', from: 'm1', name: 'Han', where: { planet: 'naboo', zone: '', how: 'travel' }, until: 930_000 });
  ok(t.g.trip?.planet === 'naboo' && Math.round(t.g.trip.left) === 30, 'a leader going somewhere is an offer with a life on it');
  t.g.acceptTrip();
  ok(t.sent.some((m) => m.do === 'travel') && t.g.trip === null, 'taking it up is one word, and the question comes down');
  let went = '';
  t.g.onTravel = (where) => {
    went = where.planet;
  };
  t.g.handle({ t: 'group', do: 'travelling', who: 'm2', name: 'You', where: { planet: 'naboo', zone: '', how: 'travel' } });
  ok(went === 'naboo', 'the server saying this browser is going hands the word to whoever owns travelling');
  went = '';
  t.g.handle({ t: 'group', do: 'travelling', who: 'm1', name: 'Han', where: { planet: 'naboo' } });
  ok(went === '' && t.notes[t.notes.length - 1].includes('Han'), 'somebody else going is a line to read, and moves nobody');
}

// ---- the numbers are live -----------------------------------------------------------------------------------

{
  const was = GROUP_TUNE.chevron;
  ok(tuneGroups({ chevron: 60 }).chevron === 60, 'the invented numbers can be set from the console');
  ok(tuneGroups({ chevron: -5 }).chevron === 0, 'and are held to what makes sense');
  tuneGroups({ chevron: was });
  ok(Object.isFrozen(GROUP_RANGE), "the game's own distances cannot be set at all: they are the table's");
}

console.log(`\n${checks} checks passed`);
