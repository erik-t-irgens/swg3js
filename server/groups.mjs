// A group, the way a fireteam works: you invite someone standing near you, they accept, and from
// then on the server holds who is in it. Nobody's browser decides, so two browsers can never
// disagree about who is together -- which is the whole reason this lives here and not there.
//
// It also holds the group's own chat line, because a line typed to "the group" has to be sent to
// people who may be on another planet, and the only thing that knows where they all are is this.
//
// What is the game's and what is ours
// -----------------------------------
// The words and the distances are the client's own. `datatables/player/radial_menu.iff` has a row
// per menu entry with a caption, a range in metres and a command, and the ones this file uses read
// (caption, range, command):
//
//   GROUP_INVITE 90 invite      GROUP_JOIN 90 join            GROUP_LEAVE 16384 leaveGroup
//   GROUP_KICK 16384 dismissGroupMember                       GROUP_DISBAND 16384 disband
//   GROUP_DECLINE 16384 decline GROUP_MAKE_LEADER 16384 makeLeader
//   GROUP_TELL 16384 (the client's own)                       GROUP_USE_PICKUP_POINT 16384
//
// 16384 m is that table's way of saying "no limit". So an invite reaching 90 m is the game's rule,
// not a number anyone here chose, and leaving, kicking, promoting and the group's chat reach as far
// as the group does. Everything else -- how many people fit, how long an invite waits, how long a
// group holds a place for someone who is reloading -- is invented here, and every one of those is in
// `GROUP_TUNING` with a line saying what it is for. The server prints them on its status page and
// `--set group.<name>=<n>` moves one for a run.
//
// How it is used
// --------------
// Nothing in here touches a socket or a clock of its own. Every browser that connects is `present`,
// every world change is `place`, a closed line is `absent`, and each thing a player asks for returns
// `{ ok, why, tell }` -- a list of `{ to: [<member keys>], msg }` for the relay to fan out, which is
// what keeps the rules testable without a server running. `tick` is called a few times a second and
// is what expires an invite, a trip offer and a held place.
//
// Dependency-free, and shared with tools/swg/tests/groups.test.ts.

import { WIRE, cleanName, cleanWord } from './wire.mjs';

/**
 * The distances the client's own radial menu table gives, in metres. These are the game's, read out
 * of `datatables/player/radial_menu.iff`; they are not ours to pick. 16384 is that table's "no
 * limit", and it is kept under that name rather than as `Infinity` so what is enforced is plainly
 * the same number the table holds.
 */
export const GROUP_RANGES = {
  /** GROUP_INVITE, and GROUP_JOIN with it: how far an invitation reaches. */
  invite: 90,
  /** TRADE_START and TRADE_ACCEPT: not used here, kept so there is one place the table's rows live. */
  trade: 8,
  /** COMBAT_DUEL and COMBAT_PEACE. */
  duel: 128,
  /** COMBAT_DEATH_BLOW. */
  deathBlow: 10,
  /** What the table writes where a menu entry has no distance at all. */
  noLimit: 16384,
};

/**
 * Every number this file invents, in one place. None of them is from the game: the game's own are in
 * `GROUP_RANGES` above. Eight in a group is the owner's decision; the rest are patiences and caps
 * chosen here because something had to be chosen, and any of them can be moved for a run with
 * `--set group.<name>=<n>`.
 */
export const GROUP_TUNING = {
  /** How many people fit in one group, counting anyone whose place is being held. */
  members: 8,
  /** How long an invitation stands before it is taken back, in ms. */
  'invite.wait': 30000,
  /** How many invitations one group may have out at once, so a group cannot spam a world. */
  'invite.out': 8,
  /**
   * How long a member's place is held when their line closes, in ms. A reload takes a second or
   * two; this is long enough that a browser being restarted, or a tunnel hiccuping, does not cost
   * someone their group, and short enough that a group is not haunted by people who have gone.
   */
  hold: 90000,
  /** How long a trip the leader offers stands before it lapses, in ms. */
  'trip.wait': 60000,
  /** How many groups one server keeps at once, so nothing grows without bound. */
  groups: 64,
  /**
   * How often the server looks for an invitation nobody answered, a trip nobody took and a held
   * place nobody came back to, in ms. Nothing else needs a clock, so this is the only one.
   */
  tick: 1000,
  /** The longest chat line, in characters. */
  'chat.length': 200,
  /** How many chat lines one browser may send in a second before the rest are dropped. */
  'chat.perSecond': 4,
  /**
   * How many things one browser may ask of a group in a second. A decision is rare and is never
   * dropped for being behind, but each one writes to everybody in the group, so a finger held down
   * on a key would have the server fanning a roster out over and over; past this the rest are
   * ignored. Well above anything a hand can do on purpose.
   */
  'ask.perSecond': 8,
  /**
   * How far from a world's middle a trip may name a point to come out at, in metres. Every number a
   * browser sends is checked finite and clamped, and this is the clamp: no world is anywhere near
   * this wide, so it only ever catches nonsense on its way to everybody else's browser.
   */
  'where.limit': 10000000,
};

/** What a player can ask of a group. `disband`, `kick` and `promote` are the leader's alone. */
const DOES = ['invite', 'accept', 'decline', 'leave', 'kick', 'promote', 'disband', 'trip', 'travel'];
/** The kinds of journey a leader can offer. The browser decides what each means; this only passes it on. */
const TRIPS = ['ground', 'space', 'jump', 'travel'];
/** A member's id within its group, as this file mints them. */
const MEMBER_ID = /^m[0-9]{1,4}$/;
/**
 * Everything that is not text in a chat line: the same set wire.mjs strips out of a name, written
 * as escapes rather than as the bytes themselves, so nothing in this file rests on a NUL surviving
 * a copy of the tree. The line-breaking and direction-changing characters above U+2000 are left
 * alone, so whatever shows a line must go on putting it in as text and never as markup.
 */
const CONTROL = /[\u0000-\u001f\u007f]/g;

// ------------------------------------------------------------------------------------------------
// Checking what a browser sends, the same way everything else the server is told is checked

/**
 * A cleaned copy of a `group`, or undefined when it is not one. Anything that fails is dropped and
 * never answered, so a browser on another build can neither grow the message nor put a word through
 * that nothing here knows.
 */
export function cleanGroup(x, tuning = GROUP_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.do !== 'string' || !DOES.includes(x.do)) return undefined;
  const out = { do: x.do };
  if (x.do === 'invite') {
    // Who to invite is the connection id the browser already knows them by, from the join and state
    // messages it is being sent. A typed line can carry a name instead, since somebody typing one
    // has no id to hand; two people can share a name, so a name is resolved to the nearest person
    // on this world who answers to it and never to somebody on another.
    const to = Number(x.to);
    if (Number.isInteger(to) && to > 0) out.to = to;
    if (typeof x.name === 'string' && x.name.trim()) out.name = cleanName(x.name, '');
    if (!out.to && !out.name) return undefined;
  }
  if (x.do === 'kick' || x.do === 'promote') {
    if (typeof x.who !== 'string' || !MEMBER_ID.test(x.who)) return undefined;
    out.who = x.who;
  }
  if (x.do === 'trip') {
    const where = cleanWhere(x.where, tuning);
    if (!where) return undefined;
    out.where = where;
  }
  return out;
}

/**
 * Where a trip goes: a world, how it is got to, and where to come out. The three numbers are
 * checked finite and then clamped, as every number a browser sends is: this one is passed on to
 * everybody else in the group, and a browser handed 1e308 as a place to stand has no good answer.
 */
export function cleanWhere(x, tuning = GROUP_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const planet = cleanWord(x.planet, '', WIRE.place);
  const zone = x.zone ? cleanWord(x.zone, '', WIRE.place) : '';
  if (!planet && !zone) return undefined;
  const where = { planet, zone, how: TRIPS.includes(x.how) ? x.how : 'travel' };
  const limit = tuning['where.limit'];
  const at = Array.isArray(x.at) && x.at.length === 3 ? x.at.map(Number) : null;
  if (at && at.every((v) => Number.isFinite(v))) where.at = at.map((v) => Math.max(-limit, Math.min(limit, v)));
  return where;
}

/**
 * A cleaned copy of a `chat`, or undefined. Control characters are taken out here; the text is
 * still text a stranger typed, and whatever shows it escapes it. An empty line is not a message.
 */
export function cleanChat(x, tuning = GROUP_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.text !== 'string') return undefined;
  const text = x.text.replace(CONTROL, '').trim().slice(0, tuning['chat.length']);
  if (!text) return undefined;
  return { scope: x.scope === 'group' ? 'group' : 'say', text };
}

// ------------------------------------------------------------------------------------------------
// The groups themselves

/** One member's line in a roster, as every member's browser is sent it. */
function rosterRow(m, leaderKey) {
  return {
    m: m.mid,
    s: m.session ?? 0,
    name: m.name,
    planet: m.planet,
    zone: m.zone,
    hp: m.hp,
    leader: m.key === leaderKey ? 1 : 0,
    here: m.session ? 1 : 0,
  };
}

export class Groups {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number> }} options the clock to read, so a
   * test can hand in its own and step it, and the numbers to work to.
   */
  constructor({ now = () => Date.now(), tuning = GROUP_TUNING } = {}) {
    this.now = now;
    this.tuning = tuning;
    /** @type {Map<string, object>} member key to what is known about that browser right now */
    this.people = new Map();
    /** @type {Map<number, string>} connection id to the member key holding it */
    this.bySession = new Map();
    /** @type {Map<string, object>} group id to the group */
    this.byId = new Map();
    /** @type {Map<string, string>} member key to the group it is in */
    this.byKey = new Map();
    /** @type {Map<string, object>} member key to the invitation standing for it */
    this.invited = new Map();
    this.nextGroup = 1;
  }

  // -- who is connected ---------------------------------------------------------------------------

  /**
   * A browser is here under this member key. A key that is already in a group is that member coming
   * back -- a reload, or a line that dropped -- and it simply picks its place up again, which is
   * what lets someone restart their browser without losing their group.
   */
  present(key, { session = 0, name = '', planet = '', zone = '' } = {}) {
    const tell = [];
    const had = this.people.get(key);
    // One browser, one key: a connection that was holding another key lets it go first, or a player
    // who switched character would be two people as far as this is concerned.
    const holding = this.bySession.get(session);
    if (holding && holding !== key) this.absent(session, tell);
    const person = had ?? { key, session: 0, name: '', planet: '', zone: '', hp: null, chat: { at: 0, lines: 0 }, ask: { at: 0, lines: 0 } };
    // The same character opened in a second browser: the newer line has it from here, and the older
    // one stops being the way to reach this member before it has even been told it was taken over.
    if (person.session && person.session !== session) this.bySession.delete(person.session);
    person.session = session;
    if (name) person.name = cleanName(name, person.name || 'someone');
    if (planet || zone) {
      person.planet = planet;
      person.zone = zone;
    }
    this.people.set(key, person);
    if (session) this.bySession.set(session, key);
    const group = this.groupOf(key);
    if (group) {
      const m = group.members.get(key);
      const wasAway = !m.session;
      m.session = session;
      m.name = person.name;
      m.planet = person.planet;
      m.zone = person.zone;
      m.awaySince = 0;
      if (wasAway) this.news(group, tell, 'back', m);
      this.roster(group, tell);
    }
    return { ok: true, tell };
  }

  /**
   * Where a browser is now. Its group is told, because the roster says what world everyone is on --
   * but only when something in it actually changed: a browser sends a hello again whenever its
   * clothes or its ship change, and none of that is anybody else's roster's business.
   */
  place(key, { name = '', planet = '', zone = '' } = {}) {
    const tell = [];
    const person = this.people.get(key);
    if (!person) return { ok: false, why: 'nobody here', tell };
    const called = name ? cleanName(name, person.name || 'someone') : person.name;
    const changed = person.name !== called || person.planet !== planet || person.zone !== zone;
    person.name = called;
    person.planet = planet;
    person.zone = zone;
    if (!changed) return { ok: true, tell };
    const group = this.groupOf(key);
    if (group) {
      const m = group.members.get(key);
      m.name = person.name;
      m.planet = planet;
      m.zone = zone;
      this.roster(group, tell);
    }
    return { ok: true, tell };
  }

  /**
   * What is known about a member beyond where they are. Health is the one thing a roster wants that
   * nothing crosses yet, so every row carries `hp: null` until it does; when health does cross, this
   * is the one call that has to be made and the roster needs no other change. Nothing here reads it.
   */
  note(key, { hp = null } = {}) {
    const tell = [];
    const person = this.people.get(key);
    if (!person) return { ok: false, why: 'nobody here', tell };
    // Health will arrive as often as a state does, so it is rounded to the whole percent a bar can
    // show and only told when that moves: a fight would otherwise have the server writing the whole
    // roster to all eight ten times a second for a bar creeping down a pixel.
    const now = typeof hp === 'number' && Number.isFinite(hp) ? Math.round(Math.max(0, Math.min(1, hp)) * 100) / 100 : null;
    if (person.hp === now) return { ok: true, tell };
    person.hp = now;
    const group = this.groupOf(key);
    if (group) {
      const m = group.members.get(key);
      m.hp = now;
      // A line of its own rather than the roster: the roster is what a browser builds its rows from
      // and it carries health with it, so a change of health alone only has to move one number.
      tell.push({ to: [...group.members.keys()], msg: { t: 'group', do: 'health', who: m.mid, hp: now } });
    }
    return { ok: true, tell };
  }

  /**
   * A line closed. The person is forgotten, but their place in a group is held for a while and the
   * others are told they have stepped out rather than that they have gone: a reload should not cost
   * anybody their group, and the leader should not change hands over one.
   */
  absent(session, into = null) {
    const tell = into ?? [];
    const key = this.bySession.get(session);
    if (!key) return { ok: true, tell };
    this.bySession.delete(session);
    const person = this.people.get(key);
    // A line closing after another has already taken this member over -- the same character opened
    // in a second browser, whose first act is to close the older one -- is a stale line with nothing
    // to give up. Without this, being taken over would tell the whole group you had stepped out and
    // start a clock on the place you are standing in right now.
    if (person && person.session !== session) return { ok: true, tell };
    if (person) person.session = 0;
    // An invitation standing for someone who has gone is taken back, and so is every one they sent.
    this.dropInvite(key, tell, 'gone');
    this.dropSent(key, tell);
    const group = this.groupOf(key);
    if (group) {
      const m = group.members.get(key);
      m.session = 0;
      m.awaySince = this.now();
      this.news(group, tell, 'away', m);
      this.roster(group, tell);
    } else if (person) {
      this.people.delete(key);
    }
    return { ok: true, tell };
  }

  /** The connection a member key is on right now, or 0 when nobody is holding it. */
  sessionOf(key) {
    return this.people.get(key)?.session ?? 0;
  }

  /** The member key a connection is holding, or null. */
  keyOf(session) {
    return this.bySession.get(session) ?? null;
  }

  /** The group a member key is in, or null. */
  groupOf(key) {
    const id = this.byKey.get(key);
    return id ? this.byId.get(id) ?? null : null;
  }

  // -- joining and leaving ------------------------------------------------------------------------

  /**
   * Invite someone. The distance is measured by the caller, which is the only thing that knows where
   * two players are standing, and the rule it is held to is the client's own 90 m. Somebody on
   * another world is out of range by definition, and the caller says so by handing in a distance of
   * Infinity.
   */
  invite(fromKey, toKey, distance) {
    const tell = [];
    const from = this.people.get(fromKey);
    const to = this.people.get(toKey);
    if (!from || !to || fromKey === toKey) return this.refuse(fromKey, tell, 'there is nobody there to ask');
    if (!from.session) return { ok: false, why: 'you are not here', tell };
    if (!to.session) return this.refuse(fromKey, tell, `${to.name} is not here`);
    if (this.groupOf(toKey)) return this.refuse(fromKey, tell, `${to.name} is already in a group`);
    if (this.invited.has(toKey)) return this.refuse(fromKey, tell, `${to.name} has already been asked`);
    if (!(Number(distance) <= GROUP_RANGES.invite)) return this.refuse(fromKey, tell, `${to.name} is too far away to ask`);
    let group = this.groupOf(fromKey);
    if (group) {
      if (group.leader !== fromKey) return this.refuse(fromKey, tell, 'only the leader can ask someone to join');
      if (this.full(group)) return this.refuse(fromKey, tell, `a group holds ${this.tuning.members}`);
      if (group.invites.size >= this.tuning['invite.out']) return this.refuse(fromKey, tell, 'there are already that many invitations out');
    } else {
      if (this.byId.size >= this.tuning.groups) return this.refuse(fromKey, tell, 'this server is holding as many groups as it can');
      // The same cap on somebody who is in no group yet. Without it one browser could put a standing
      // invitation on everybody else connected -- an invitation is keyed by whoever it is for, so
      // everyone would then be "already asked" and nobody on the server could be invited by anyone.
      let out = 0;
      for (const other of this.invited.values()) if (other.from === fromKey) out++;
      if (out >= this.tuning['invite.out']) return this.refuse(fromKey, tell, 'there are already that many invitations out');
    }
    const until = this.now() + this.tuning['invite.wait'];
    const invite = { to: toKey, from: fromKey, group: group ? group.id : null, until };
    this.invited.set(toKey, invite);
    if (group) group.invites.set(toKey, invite);
    tell.push({ to: [toKey], msg: { t: 'group', do: 'invited', from: from.session, name: from.name, until } });
    tell.push({ to: [fromKey], msg: { t: 'group', do: 'sent', to: to.session, name: to.name, until } });
    return { ok: true, tell };
  }

  /** Accept the invitation standing for you. The group is made here when there was not one yet. */
  accept(key) {
    const tell = [];
    const invite = this.invited.get(key);
    if (!invite) return this.refuse(key, tell, 'there is nothing to accept');
    const from = this.people.get(invite.from);
    this.invited.delete(key);
    let group = invite.group ? this.byId.get(invite.group) ?? null : this.groupOf(invite.from);
    if (group) group.invites.delete(key);
    if (!from || !from.session) return this.refuse(key, tell, 'whoever asked you has gone');
    if (this.groupOf(key)) return this.refuse(key, tell, 'you are already in a group');
    if (!group) {
      group = this.make(invite.from);
      if (!group) return this.refuse(key, tell, 'this server is holding as many groups as it can');
    }
    if (this.full(group)) return this.refuse(key, tell, `a group holds ${this.tuning.members}`);
    const m = this.join(group, key);
    this.news(group, tell, 'joined', m);
    this.roster(group, tell);
    return { ok: true, tell };
  }

  /** Turn an invitation down. Whoever sent it is told; nobody else hears anything. */
  decline(key) {
    const tell = [];
    const invite = this.invited.get(key);
    if (!invite) return { ok: false, why: 'there is nothing to decline', tell };
    this.dropInvite(key, tell, 'declined');
    return { ok: true, tell };
  }

  /** Leave. The last one out closes the group; a leader going hands it on (see `remove`). */
  leave(key) {
    const tell = [];
    const group = this.groupOf(key);
    if (!group) return { ok: false, why: 'you are not in a group', tell };
    this.remove(group, key, tell, 'left');
    return { ok: true, tell };
  }

  /** Put someone out. The leader's alone, and the leader cannot put themselves out this way. */
  kick(byKey, mid) {
    const tell = [];
    const group = this.groupOf(byKey);
    if (!group) return this.refuse(byKey, tell, 'you are not in a group');
    if (group.leader !== byKey) return this.refuse(byKey, tell, 'only the leader can do that');
    const m = this.member(group, mid);
    if (!m || m.key === byKey) return this.refuse(byKey, tell, 'there is nobody in the group by that name');
    this.remove(group, m.key, tell, 'kicked');
    return { ok: true, tell };
  }

  /** Hand the group on to somebody else. */
  promote(byKey, mid) {
    const tell = [];
    const group = this.groupOf(byKey);
    if (!group) return this.refuse(byKey, tell, 'you are not in a group');
    if (group.leader !== byKey) return this.refuse(byKey, tell, 'only the leader can do that');
    const m = this.member(group, mid);
    if (!m || m.key === byKey) return this.refuse(byKey, tell, 'there is nobody in the group by that name');
    group.leader = m.key;
    this.news(group, tell, 'leader', m);
    this.roster(group, tell);
    return { ok: true, tell };
  }

  /** Close the group. Everyone is told, and everyone is out. */
  disband(byKey) {
    const tell = [];
    const group = this.groupOf(byKey);
    if (!group) return this.refuse(byKey, tell, 'you are not in a group');
    if (group.leader !== byKey) return this.refuse(byKey, tell, 'only the leader can do that');
    const keys = [...group.members.keys()];
    const by = group.members.get(byKey);
    tell.push({ to: keys, msg: { t: 'group', do: 'news', what: 'disbanded', who: by.mid, name: by.name } });
    for (const k of keys) this.forget(group, k, tell);
    // Everyone is told they are in no group now, in the same words as leaving: a browser clears its
    // roster on that one message and never has to work out what a piece of news means.
    tell.push({ to: keys, msg: { t: 'group', do: 'none', why: 'disbanded' } });
    this.close(group, tell);
    return { ok: true, tell };
  }

  // -- travelling together -------------------------------------------------------------------------

  /**
   * The leader is going somewhere and the others are offered the trip. Nobody is moved by this: it
   * is an offer with a life on it, and each browser answers for itself. This is a small version of
   * the client's own GROUP_USE_PICKUP_POINT.
   */
  trip(byKey, where) {
    const tell = [];
    const group = this.groupOf(byKey);
    if (!group) return this.refuse(byKey, tell, 'you are not in a group');
    if (group.leader !== byKey) return this.refuse(byKey, tell, 'only the leader can offer a trip');
    const by = group.members.get(byKey);
    const until = this.now() + this.tuning['trip.wait'];
    group.trip = { from: byKey, where, until, took: new Set([byKey]) };
    const others = [...group.members.keys()].filter((k) => k !== byKey);
    if (others.length) tell.push({ to: others, msg: { t: 'group', do: 'trip', from: by.mid, name: by.name, where, until } });
    return { ok: true, tell };
  }

  /** Take the trip up. The group is told who is coming, and the offer stands for the rest. */
  travel(key) {
    const tell = [];
    const group = this.groupOf(key);
    if (!group?.trip) return { ok: false, why: 'there is no trip to take', tell };
    if (group.trip.until <= this.now()) return { ok: false, why: 'that trip has lapsed', tell };
    // Once each. The offer stands for whoever has not taken it, but telling the group a second time
    // that the same person is coming says nothing, and a browser holding the key down would have the
    // server writing to everyone as fast as it could read.
    if (group.trip.took?.has(key)) return { ok: false, why: 'you have already taken that trip up', tell };
    group.trip.took?.add(key);
    const m = group.members.get(key);
    tell.push({ to: [...group.members.keys()], msg: { t: 'group', do: 'travelling', who: m.mid, name: m.name, where: group.trip.where } });
    return { ok: true, tell, where: group.trip.where };
  }

  // -- chat -----------------------------------------------------------------------------------------

  /**
   * Whether a browser may send another chat line this second. Chat is never dropped for being
   * behind, and a group line goes to people on other worlds, so it is the one message that needs a
   * limit of its own rather than the relay's.
   */
  mayChat(key) {
    const person = this.people.get(key);
    if (!person) return false;
    const now = this.now();
    if (now - person.chat.at >= 1000) person.chat = { at: now, lines: 0 };
    person.chat.lines++;
    return person.chat.lines <= this.tuning['chat.perSecond'];
  }

  /**
   * Whether a browser may ask the group for another decision this second. A decision is never
   * dropped for being behind -- one lost would leave two sides disagreeing about who is in -- so the
   * one thing that stops a key held down is this: each one writes a piece of news and a roster to
   * everybody in the group, which is the most one message here ever costs.
   */
  mayAsk(key) {
    const person = this.people.get(key);
    if (!person) return false;
    const now = this.now();
    if (!person.ask || now - person.ask.at >= 1000) person.ask = { at: now, lines: 0 };
    person.ask.lines++;
    return person.ask.lines <= this.tuning['ask.perSecond'];
  }

  /** Everyone who should hear a line said to the group, the speaker included. */
  chatTo(key) {
    const group = this.groupOf(key);
    if (!group) return null;
    return [...group.members.keys()];
  }

  // -- the clock -------------------------------------------------------------------------------------

  /**
   * Expire what has a life on it: invitations nobody answered, trips nobody took, and the places
   * held for people whose lines closed and who have not come back.
   */
  tick(into = null) {
    const tell = into ?? [];
    const now = this.now();
    for (const [key, invite] of [...this.invited]) if (invite.until <= now) this.dropInvite(key, tell, 'lapsed');
    for (const group of [...this.byId.values()]) {
      if (group.trip && group.trip.until <= now) group.trip = null;
      for (const m of [...group.members.values()]) {
        if (m.session || !m.awaySince) continue;
        if (now - m.awaySince < this.tuning.hold) continue;
        this.remove(group, m.key, tell, 'gone');
      }
    }
    return { ok: true, tell };
  }

  // -- the pieces the above is made of ---------------------------------------------------------------

  /** A refusal goes back to whoever asked, and to nobody else. */
  refuse(key, tell, why) {
    tell.push({ to: [key], msg: { t: 'group', do: 'refused', why } });
    return { ok: false, why, tell };
  }

  /** Whether a group is full. Someone whose place is being held counts: a reload must not cost it. */
  full(group) {
    return group.members.size >= this.tuning.members;
  }

  /** A member by the id their own group knows them by. */
  member(group, mid) {
    for (const m of group.members.values()) if (m.mid === mid) return m;
    return null;
  }

  /** A new group with one person in it, who leads it. */
  make(leaderKey) {
    if (this.byId.size >= this.tuning.groups) return null;
    const group = { id: `g${this.nextGroup++}`, members: new Map(), leader: leaderKey, invites: new Map(), trip: null, nextMember: 1 };
    this.byId.set(group.id, group);
    this.join(group, leaderKey);
    return group;
  }

  /** Put a member in a group. The order they are put in is the order the leader is handed on in. */
  join(group, key) {
    const person = this.people.get(key);
    const m = {
      key,
      mid: `m${group.nextMember++}`,
      name: person?.name ?? 'someone',
      session: person?.session ?? 0,
      planet: person?.planet ?? '',
      zone: person?.zone ?? '',
      hp: person?.hp ?? null,
      joined: this.now(),
      awaySince: 0,
    };
    group.members.set(key, m);
    this.byKey.set(key, group.id);
    return m;
  }

  /**
   * Take a member out and tell the others why. A leader going hands the group on to whoever has been
   * in it longest, so a group never ends up with nobody able to ask anyone to join; the last one out
   * closes it.
   */
  remove(group, key, tell, why) {
    const m = group.members.get(key);
    if (!m) return;
    this.forget(group, key, tell);
    this.news(group, tell, why, m);
    tell.push({ to: [key], msg: { t: 'group', do: 'none', why } });
    if (!group.members.size) {
      this.close(group, tell);
      return;
    }
    if (group.leader === key) {
      const next = [...group.members.values()].sort((a, b) => a.joined - b.joined)[0];
      group.leader = next.key;
      this.news(group, tell, 'leader', next);
    }
    this.roster(group, tell);
  }

  /** Take a member out of the tables without a word to anyone. */
  forget(group, key, tell) {
    group.members.delete(key);
    if (this.byKey.get(key) === group.id) this.byKey.delete(key);
    // Both halves, because somebody being taken out of the tables is somebody who has gone: the
    // invitation standing for them, and every invitation they had sent.
    this.dropInvite(key, tell, 'gone');
    this.dropSent(key, tell);
    // Somebody who has gone and is in no group is not remembered at all.
    const person = this.people.get(key);
    if (person && !person.session) this.people.delete(key);
  }

  /** Close an empty group. Anyone it had asked in is told there is nothing left to accept. */
  close(group, tell) {
    for (const to of [...group.invites.keys()]) this.dropInvite(to, tell, 'cancelled');
    this.byId.delete(group.id);
  }

  /**
   * Take back the invitation standing for one person, and tell whoever is left to tell. `why` says
   * which that is: `declined` and `lapsed` are a word to whoever sent it, `gone` means the one asked
   * has gone and is a word to the sender too, and `cancelled` means the invitation itself is void --
   * the group that sent it has closed -- so the one asked is told and the sender is not.
   *
   * It takes back that one invitation and no other. An invitation somebody turns down, or lets run
   * out, says nothing whatever about the ones they have out themselves; taking those back as well
   * left the other side's screen holding an invitation this table no longer had, which is the one
   * thing the group living on the server is meant to make impossible.
   */
  dropInvite(key, tell, why) {
    const invite = this.invited.get(key);
    if (!invite) return;
    this.invited.delete(key);
    const group = invite.group ? this.byId.get(invite.group) : null;
    if (group) group.invites.delete(key);
    const to = this.people.get(key);
    const name = to?.name ?? 'someone';
    if (why === 'declined' || why === 'lapsed') {
      tell.push({ to: [invite.from], msg: { t: 'group', do: 'news', what: why, who: '', name } });
    }
    // Taken back because the one asked has gone: whoever sent it is told, or their screen goes on
    // reading that it was sent until its own countdown runs out.
    if (why === 'gone') tell.push({ to: [invite.from], msg: { t: 'group', do: 'news', what: 'withdrawn', who: '', name } });
    if ((why === 'lapsed' || why === 'cancelled') && to?.session) tell.push({ to: [key], msg: { t: 'group', do: 'gone' } });
  }

  /**
   * Take back every invitation one person sent, which is what somebody going means for the people
   * they had asked. Each of them is told, so nobody is left holding an invitation nothing can
   * answer. Nothing else takes these back: an invitation is only ever void when whoever sent it has
   * gone or the group behind it has closed.
   */
  dropSent(key, tell) {
    for (const [other, out] of [...this.invited]) {
      if (out.from !== key) continue;
      this.invited.delete(other);
      const group = out.group ? this.byId.get(out.group) : null;
      if (group) group.invites.delete(other);
      if (this.people.get(other)?.session) tell.push({ to: [other], msg: { t: 'group', do: 'gone' } });
    }
  }

  /** A line about what just happened, for everyone in the group to read. */
  news(group, tell, what, m) {
    const to = [...group.members.keys()];
    if (!to.length) return;
    tell.push({ to, msg: { t: 'group', do: 'news', what, who: m.mid, name: m.name } });
  }

  /**
   * The roster, which is what a browser draws: one message per member, because each is told which
   * row is their own. It is sent on a change and never on a timer -- where everyone is standing is
   * already crossing ten times a second for anyone on the same world, and a member on another world
   * has no distance worth knowing.
   */
  roster(group, tell) {
    const rows = [...group.members.values()].map((m) => rosterRow(m, group.leader));
    const leader = group.members.get(group.leader);
    for (const m of group.members.values()) {
      tell.push({ to: [m.key], msg: { t: 'group', do: 'roster', id: group.id, leader: leader ? leader.mid : '', you: m.mid, members: rows } });
    }
  }

  /** What to print on the status page: each group, who leads it and who is in it. */
  describe() {
    if (!this.byId.size) return 'nobody grouped';
    const parts = [];
    for (const group of this.byId.values()) {
      const names = [...group.members.values()].map((m) => `${m.key === group.leader ? '*' : ''}${m.name}${m.session ? '' : ' (away)'}`);
      parts.push(`${group.id}: ${names.join(', ')}`);
    }
    return parts.join(' | ');
  }
}
