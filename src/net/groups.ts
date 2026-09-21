// The browser's half of a fireteam and of the words players type at each other.
//
// The server holds the truth: who is in a group, who leads it, who has been asked and who hears what
// (server/groups.mjs). This file is what that truth looks like on this side -- the roster it is handed,
// an invitation waiting on an answer, a trip a leader is offering, the last few lines anyone said --
// plus the asking: invite, accept, decline, leave, promote, put out, disband, and a line of chat on one
// of two channels. It decides nothing.
//
// Three rules shape it. Nothing here touches the document, three.js or the socket, so a node test runs
// it as it is and the two panels above it (src/ui/groupUi.ts, src/ui/chatUi.ts) are the only things
// that write to the page. Nothing here runs in a frame: the roster changes when the server says so and
// the distances are worked out a few times a second, never sixty. And with no server -- no address set,
// or the relay that came before -- the whole thing is quiet and empty: `active` is false, nothing is
// sent, no panel opens and the game is exactly what it is without it.
//
// Words that arrive from the far end are data. A name and a line of chat are cut, stripped of control
// characters and never parsed as anything; the panels write them with `textContent`, never as HTML.
//
// The wire is the server's (server/groups.mjs, and the list at the top of server/relay.mjs). This side
// sends `{ t: 'group', do: 'invite', to: <connection id> }`, `accept`, `decline`, `leave`,
// `{ do: 'kick' | 'promote', who: <member id> }`, `disband`, `{ do: 'trip', where }`, `travel`, and
// `{ t: 'chat', scope, text }`; it is sent `roster`, `news`, `invited`, `sent`, `trip`, `travelling`,
// `none`, `gone` and `refused`, and every chat line comes back from the server, the speaker's own
// included, so that everyone reads the same words in the same order.

import { combatNow } from './combatNet.ts';
import { tradeNow } from './trade.ts';
import type { Authority } from './session.ts';

/**
 * The distances, in metres, and they are the game's own: `datatables/player/radial_menu.iff` gives a
 * range against each of its captions, and these are the rows this pass uses. 16384 m is that table's
 * "no limit", which is why leaving, putting out and promoting have no distance of their own. Nothing
 * here invented any of them, and the server checks the invitation's range again on its own copy -- this
 * side only keeps a button from being pressed at a distance the server would refuse anyway.
 */
export const GROUP_RANGE = Object.freeze({
  /** GROUP_INVITE and GROUP_JOIN. */
  invite: 90,
  /** TRADE_START and TRADE_ACCEPT (not this wave; here so there is one table, not two). */
  trade: 8,
  /** COMBAT_DUEL and COMBAT_PEACE. */
  duel: 128,
  /** COMBAT_DEATH_BLOW. */
  deathBlow: 10,
  /** What the table spells for a row with no limit. */
  unlimited: 16384,
});

/**
 * Every number this side invents, in one place and live: `__debug.group({ chevron: 60 })` sets one and
 * the next roster obeys it. The ranges above are not here, because they are the game's, and how long an
 * invitation really stands is the server's (it sends the moment it lapses with every invitation).
 *
 * `max` is the owner's decision -- eight in a group -- rather than an invention of this file; it is here
 * because the panel reads it, and the server is what really enforces it.
 */
export const GROUP_TUNE = {
  /** The owner's decision: how many may be in one group. */
  max: 8,
  /** Invented: characters a line of chat is cut to, as the design says (the server cuts to the same). */
  chars: 200,
  /** Invented: lines of chat kept for the log. */
  log: 40,
  /** Invented: metres past which a group member gets a chevron over their head. */
  chevron: 40,
  /** Invented: how wide a cone counts as "the player you are looking at", in radians from the view. */
  lookAngle: 0.3,
  /**
   * Invented: metres up a figure's own place that "looking at them" aims for, so that a player a few
   * metres off is looked at in the chest rather than over the top of their head.
   */
  lookLift: 1.2,
  /**
   * How many lines one browser may say in a second. It is the server's own number
   * (server/groups.mjs's `chat.perSecond`) kept here so that a line over it is answered with a word
   * rather than vanishing: the server drops the line and says nothing, and a player who typed into
   * the void would think the chat was broken. The server is still what decides.
   */
  linesPerSecond: 4,
  /** Invented: times a second the distances to the group are worked out. Nothing here is per frame. */
  distanceHz: 4,
  /** Invented: seconds a line of chat floats over the speaker's head. */
  bubbleSeconds: 6,
  /** Invented: seconds a question stands here when the server sent one without saying when it lapses. */
  askSeconds: 30,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneGroups(o: Partial<typeof GROUP_TUNE>): typeof GROUP_TUNE {
  if (typeof o.max === 'number') GROUP_TUNE.max = Math.max(2, Math.min(64, Math.round(o.max)));
  if (typeof o.chars === 'number') GROUP_TUNE.chars = Math.max(1, Math.min(2000, Math.round(o.chars)));
  if (typeof o.log === 'number') GROUP_TUNE.log = Math.max(1, Math.min(500, Math.round(o.log)));
  if (typeof o.chevron === 'number') GROUP_TUNE.chevron = Math.max(0, o.chevron);
  if (typeof o.lookAngle === 'number') GROUP_TUNE.lookAngle = Math.max(0.01, Math.min(Math.PI, o.lookAngle));
  if (typeof o.lookLift === 'number') GROUP_TUNE.lookLift = Math.max(0, Math.min(10, o.lookLift));
  if (typeof o.linesPerSecond === 'number') GROUP_TUNE.linesPerSecond = Math.max(1, Math.min(60, Math.round(o.linesPerSecond)));
  if (typeof o.distanceHz === 'number') GROUP_TUNE.distanceHz = Math.max(0.5, Math.min(30, o.distanceHz));
  if (typeof o.bubbleSeconds === 'number') GROUP_TUNE.bubbleSeconds = Math.max(0.5, Math.min(60, o.bubbleSeconds));
  if (typeof o.askSeconds === 'number') GROUP_TUNE.askSeconds = Math.max(1, Math.min(600, o.askSeconds));
  return GROUP_TUNE;
}

/** The two channels a line can go on. The group's is the game's own `GROUP_TELL`. */
export type ChatScope = 'say' | 'group';

/** One member of the group, as the server's roster hands them over, with what this side works out. */
export interface GroupMember {
  /** The id their own group knows them by (`m1`), which is what a kick or a promotion names. */
  mid: string;
  /** The connection they are on now, and what every other message names them by; 0 while they are away. */
  id: number;
  name: string;
  planet: string;
  zone: string;
  /** Their health, 0..1, or -1 while nothing carries it (it crosses in a later wave). */
  hp: number;
  leader: boolean;
  /** This browser's own row. */
  me: boolean;
  /** Their line is open; a member whose browser is reloading keeps their place and is not here. */
  here: boolean;
  /**
   * Metres away, worked out here a few times a second from where their figure last was; -1 when they
   * are on another world, are away, or nothing has been heard of them yet.
   */
  distance: number;
}

/** The group as it stands, or null when there is none. */
export interface GroupRoster {
  id: string;
  /** The leader's member id. */
  leader: string;
  /** This browser's own member id. */
  you: string;
  members: GroupMember[];
}

/** An invitation waiting on an answer. */
export interface GroupInvite {
  /** The connection whoever asked is on. */
  from: number;
  name: string;
  /** When it lapses, on the server's clock. */
  until: number;
  /** Seconds left, worked out against the shared clock. */
  left: number;
}

/** A leader going somewhere, offering the group the trip. Carried and shown here; travelling is not this module's. */
export interface GroupTrip {
  /** The leader's member id. */
  from: string;
  name: string;
  planet: string;
  zone: string;
  /** How they are going: the server passes the word through without reading it. */
  how: string;
  /** Where to come out, in the world's own metres, or null when the leader named no point. */
  at: number[] | null;
  until: number;
  left: number;
}

/** A line somebody said. */
export interface ChatLine {
  /** The connection whoever said it is on; 0 when it came from the server itself. */
  id: number;
  name: string;
  scope: ChatScope;
  text: string;
  /** True when this browser said it. */
  mine: boolean;
  /** When it was said, on whatever clock `now()` reads. */
  at: number;
}

/** A player who might be the one being looked at: filled by the game, never allocated per call. */
export interface LookCandidate {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** Where a peer is, filled in place by whoever knows (the game reads it off the last state heard). */
export interface PointOut {
  x: number;
  y: number;
  z: number;
}

/** What the module is doing, filled in place so the console can read it between frames. */
export interface GroupStats {
  active: boolean;
  members: number;
  leader: boolean;
  invite: string;
  trip: string;
  lines: number;
  said: number;
  heard: number;
  /** Words sent, and words that went nowhere because there was nobody to send them to. */
  sent: number;
  dropped: number;
}

/** A line of chat as it is typed, once it has been read. */
export interface ParsedLine {
  kind: 'chat' | 'command' | 'empty';
  scope: ChatScope;
  text: string;
  command: string;
  arg: string;
}

/**
 * Everything that is not text in a line or a name, written as escapes rather than as the bytes
 * themselves, so that nothing in this file rests on a NUL surviving a copy of the tree (git calls a
 * blob binary the moment it finds one, and an editor that normalises on save would quietly drop it).
 * The control characters are the same set server/groups.mjs strips; the four bidirectional overrides
 * and the four isolates above them are ours, because a name carrying one reverses the rest of the
 * line it lands in, which is a trick rather than a word.
 */
const CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** Words from anywhere: control characters out, the ends trimmed, cut to length. Never parsed as anything. */
export function cleanText(x: unknown, cap = GROUP_TUNE.chars): string {
  if (typeof x !== 'string') return '';
  return x.replace(CONTROL, ' ').trim().slice(0, cap);
}

/**
 * A typed line read into what it asks for. A line beginning with a slash is a command; `/g` and
 * `/group` put the words on the group's channel and everything else is said aloud. A lone slash is
 * nothing, so a player who types one and presses Enter does not send a line reading "/".
 */
export function parseLine(raw: string, scope: ChatScope = 'say'): ParsedLine {
  const line = cleanText(raw);
  if (!line) return { kind: 'empty', scope, text: '', command: '', arg: '' };
  if (line[0] !== '/') return { kind: 'chat', scope, text: line, command: '', arg: '' };
  const rest = line.slice(1);
  const space = rest.indexOf(' ');
  const word = (space < 0 ? rest : rest.slice(0, space)).toLowerCase();
  const arg = space < 0 ? '' : rest.slice(space + 1).trim();
  if (!word) return { kind: 'empty', scope, text: '', command: '', arg: '' };
  if (word === 'g' || word === 'group' || word === 'gtell') {
    return arg ? { kind: 'chat', scope: 'group', text: arg, command: '', arg: '' } : { kind: 'command', scope: 'group', text: '', command: 'group', arg: '' };
  }
  // `/say` on its own is the way back to the aloud channel, so it is a command rather than nothing:
  // the line it is typed on is what moves the channel, and it does no other work.
  if (word === 'say' || word === 's') {
    return arg ? { kind: 'chat', scope: 'say', text: arg, command: '', arg: '' } : { kind: 'command', scope: 'say', text: '', command: 'say', arg: '' };
  }
  return { kind: 'command', scope, text: '', command: word, arg };
}

/**
 * Which player is being looked at: the one nearest the middle of the view within the cone and the
 * range. The direction is taken as given and need not be a unit vector. Nothing is allocated; the list
 * is walked once.
 *
 * It is here rather than in the panel because it is arithmetic with an answer a test can check, and
 * because "the player you are looking at" is what the game's own radial menu meant by its target.
 */
export function pickLookedAt(list: readonly LookCandidate[], n: number, eyeX: number, eyeY: number, eyeZ: number, dirX: number, dirY: number, dirZ: number, range = GROUP_RANGE.invite, angle = GROUP_TUNE.lookAngle): number {
  const dl = Math.hypot(dirX, dirY, dirZ);
  if (!(dl > 0)) return 0;
  const nx = dirX / dl;
  const ny = dirY / dl;
  const nz = dirZ / dl;
  const cosMin = Math.cos(angle);
  let best = 0;
  let bestCos = cosMin;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    // The chest rather than the feet: a figure a few metres away is looked at square in the middle.
    const dx = c.x - eyeX;
    const dy = c.y + GROUP_TUNE.lookLift - eyeY;
    const dz = c.z - eyeZ;
    const d = Math.hypot(dx, dy, dz);
    if (!(d > 0) || d > range) continue;
    const cos = (dx * nx + dy * ny + dz * nz) / d;
    if (cos > bestCos) {
      bestCos = cos;
      best = c.id;
    }
  }
  return best;
}

/** A piece of news from the group, in words. The server sends the word; what it reads as is ours. */
export function newsWords(what: string, name: string): string {
  const who = name || 'someone';
  switch (what) {
    case 'joined':
      return `${who} joined the group`;
    case 'left':
      return `${who} left the group`;
    case 'kicked':
      return `${who} was put out of the group`;
    case 'gone':
      return `${who} did not come back, and is out of the group`;
    case 'away':
      return `${who} stepped out`;
    case 'back':
      return `${who} is back`;
    case 'leader':
      return `${who} leads the group`;
    case 'declined':
      return `${who} said no`;
    case 'lapsed':
      return `${who} did not answer`;
    case 'withdrawn':
      return `${who} has gone, and the invitation you sent with them`;
    case 'disbanded':
      return `${who} broke the group up`;
    default:
      return '';
  }
}

/** Why this browser is in no group now, in words. */
export function noGroupWords(why: string): string {
  switch (why) {
    case 'left':
      return 'you left the group';
    case 'kicked':
      return 'you were put out of the group';
    case 'disbanded':
      return 'the group broke up';
    case 'gone':
      return 'your place in the group was given up';
    default:
      return 'you are in no group now';
  }
}

/**
 * The group and the chat as this browser holds them. One of these is made once and lives for the page;
 * everything it is told comes through `handle`, and everything it asks for goes out through `send`.
 */
export class Groups {
  /** Something to send: the socket puts it on the wire. Set by the wiring. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the whole module stays quiet. */
  authority: () => Authority = () => 'me';
  /** This browser's own connection number, so its own words are known for its own. */
  selfId: () => number = () => 0;
  /** Where a player's figure last was, for the distances and the markers; false when they are not here. */
  peerAt: (id: number, out: PointOut) => boolean = () => false;
  /** Where this player stands. */
  meAt: (out: PointOut) => boolean = () => false;
  /** The server's clock in milliseconds, which is what the countdowns are measured against. */
  serverNow: () => number = () => Date.now();

  /** The roster changed (or went). The panel writes only on this. */
  onRoster: (roster: GroupRoster | null) => void = () => {};
  /** An invitation arrived, was answered, or lapsed. */
  onInvite: (invite: GroupInvite | null) => void = () => {};
  /** A leader's trip offer, or its end. Nothing here travels: the offer is carried and shown. */
  onTrip: (trip: GroupTrip | null) => void = () => {};
  /** Somebody said something (this browser's own line included: it comes back from the server). */
  onChat: (line: ChatLine) => void = () => {};
  /** Something the player should read that is not a line of chat. */
  onNote: (text: string) => void = () => {};
  /**
   * A member took the leader's trip up, or the leader offered one: what travelling means is another
   * module's, so it is handed the word and this one shows it. Nothing here moves anybody.
   */
  onTravel: (where: { planet: string; zone: string; how: string; at: number[] | null }, who: string) => void = () => {};

  private group: GroupRoster | null = null;
  private inviteNow: GroupInvite | null = null;
  private tripNow: GroupTrip | null = null;
  private readonly lines: ChatLine[] = [];
  private distanceClock = 0;
  /** The second being counted for the chat's own rate, and how many lines have gone out inside it. */
  private chatWindow = 0;
  private chatCount = 0;
  private readonly scratchMe: PointOut = { x: 0, y: 0, z: 0 };
  private readonly scratchThem: PointOut = { x: 0, y: 0, z: 0 };
  private readonly stat: GroupStats = { active: false, members: 0, leader: false, invite: '', trip: '', lines: 0, said: 0, heard: 0, sent: 0, dropped: 0 };

  /**
   * The clock the log's times are read off, in seconds; a test hands in its own. It is assigned in
   * the body rather than written as a parameter property, because node runs this file as it is (it
   * strips the types and nothing else) and a parameter property is not something it can strip.
   */
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now() / 1000) {
    this.now = now;
  }

  // ---- what everything else asks -------------------------------------------------------------------

  /** Whether there is a server holding a world. With none, nothing is sent and no panel opens. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /** The group as it stands, or null. The same object between changes: nothing is allocated to read it. */
  get roster(): GroupRoster | null {
    return this.group;
  }

  get invite(): GroupInvite | null {
    return this.inviteNow;
  }

  get trip(): GroupTrip | null {
    return this.tripNow;
  }

  /** True while this browser leads the group it is in. */
  get leading(): boolean {
    return !!this.group && this.group.leader === this.group.you;
  }

  /** The last lines said, oldest first. Read, never written to. */
  get log(): readonly ChatLine[] {
    return this.lines;
  }

  /** Whether a connection is in this group. */
  has(id: number): boolean {
    const g = this.group;
    if (!g) return false;
    for (let i = 0; i < g.members.length; i++) if (g.members[i].id === id) return true;
    return false;
  }

  // ---- the asking ----------------------------------------------------------------------------------

  /**
   * Ask someone into the group, by the connection the browser already knows them by. The range is the
   * game's own 90 m and is checked here only so the player is told why nothing happened; the server
   * measures it again on its own copy of where everyone is, and is what decides.
   */
  askInvite(id: number, name = ''): string {
    if (!this.active) return 'there is no server here, so there is nobody to ask';
    if (id <= 0) return 'nobody there to ask';
    if (id === this.selfId()) return 'you are already with yourself';
    if (this.has(id)) return `${name || 'they'} is already in the group`;
    if (this.group && !this.leading) return 'only the leader can ask someone to join';
    if (this.group && this.group.members.length >= GROUP_TUNE.max) return `a group holds ${GROUP_TUNE.max}`;
    // Not being on this world and being too far off on it are two different answers. `distanceTo`
    // gives the table's "no limit" for the first, which is a mark and not a measurement: shown to a
    // player as metres it would read as nonsense.
    if (!this.meAt(this.scratchMe) || !this.peerAt(id, this.scratchThem)) return `${name || 'they'} is not on this world`;
    const away = Math.hypot(this.scratchThem.x - this.scratchMe.x, this.scratchThem.y - this.scratchMe.y, this.scratchThem.z - this.scratchMe.z);
    if (away > GROUP_RANGE.invite) return `too far to ask: ${Math.round(away)} m, and an invitation reaches ${GROUP_RANGE.invite} m`;
    this.post({ t: 'group', do: 'invite', to: id });
    return '';
  }

  accept(): void {
    if (!this.inviteNow || !this.active) return;
    this.post({ t: 'group', do: 'accept' });
    this.setInvite(null);
  }

  decline(): void {
    if (!this.inviteNow || !this.active) return;
    this.post({ t: 'group', do: 'decline' });
    this.setInvite(null);
  }

  leave(): void {
    if (!this.active || !this.group) return;
    this.post({ t: 'group', do: 'leave' });
  }

  /** Put someone out, by the member id the roster gives. The leader's alone; the server checks again. */
  kick(mid: string): void {
    if (!this.active || !this.leading || !mid || mid === this.group?.you) return;
    this.post({ t: 'group', do: 'kick', who: mid });
  }

  /** Hand the group on. */
  promote(mid: string): void {
    if (!this.active || !this.leading || !mid || mid === this.group?.you) return;
    this.post({ t: 'group', do: 'promote', who: mid });
  }

  disband(): void {
    if (!this.active || !this.leading) return;
    this.post({ t: 'group', do: 'disband' });
  }

  /** Offer the group the trip you are about to take. Whoever knows where this player is going calls it. */
  offerTrip(where: { planet: string; zone?: string; how?: string; at?: number[] }): void {
    if (!this.active || !this.leading) return;
    this.post({ t: 'group', do: 'trip', where: { planet: where.planet, zone: where.zone ?? '', how: where.how ?? 'travel', ...(where.at ? { at: where.at } : {}) } });
  }

  /** Take a leader's offer up. The server tells the group; what travelling means is not this module's. */
  acceptTrip(): void {
    const trip = this.tripNow;
    if (!this.active || !trip) return;
    this.post({ t: 'group', do: 'travel' });
    this.setTrip(null);
  }

  declineTrip(): void {
    this.setTrip(null);
  }

  /**
   * Say something. The line is cut and cleaned here as well as at the server. With a server it is the
   * server's copy that comes back and is shown, so that everyone reads the same words in the same
   * order; with none it is shown here and goes nowhere, so that typing into the line does not look
   * broken when there is nobody listening.
   */
  say(text: string, scope: ChatScope = 'say'): string {
    const words = cleanText(text);
    if (!words) return '';
    if (!this.active) {
      this.keep({ id: this.selfId(), name: 'you', scope, text: words, mine: true, at: this.now() });
      this.stat.dropped++;
      return 'there is no server here, so nobody heard that';
    }
    if (scope === 'group' && !this.group) return 'you are not in a group';
    // The server drops a line over its own rate and answers nothing at all, so a fifth line inside a
    // second would simply never appear and the player would be told why by nobody. The same count is
    // kept here, ahead of it, purely so there is a word; the server is still what decides.
    const at = this.now();
    if (at - this.chatWindow >= 1) {
      this.chatWindow = at;
      this.chatCount = 0;
    }
    this.chatCount++;
    if (this.chatCount > GROUP_TUNE.linesPerSecond) return 'slow down a moment';
    this.post({ t: 'chat', scope, text: words });
    this.stat.said++;
    return '';
  }

  /**
   * A whole typed line: a command, or words on a channel. The answer is what to tell the player, or an
   * empty string when the line did its work quietly.
   */
  type(raw: string, scope: ChatScope = 'say'): string {
    const line = parseLine(raw, scope);
    if (line.kind === 'empty') return '';
    if (line.kind === 'chat') return this.say(line.text, line.scope);
    switch (line.command) {
      // `/g` and `/say` on their own move the channel the line is typed on, which is the caller's to
      // do (it holds the line); the work here is only to say when there is no group to talk to.
      case 'group':
        if (!this.group) return 'you are not in a group';
        return '';
      case 'say':
        return '';
      case 'invite': {
        if (!this.active) return 'there is no server here, so there is nobody to ask';
        if (!line.arg) return 'who? Look at them and press the invite button, or /invite <name>';
        const id = this.idByName(line.arg);
        if (!id) return `nobody here is called ${line.arg}`;
        return this.askInvite(id, line.arg);
      }
      case 'leave':
        if (!this.group) return 'you are not in a group';
        this.leave();
        return '';
      case 'disband':
        if (!this.leading) return 'only the leader can break the group up';
        this.disband();
        return '';
      case 'kick':
      case 'remove': {
        const who = this.byName(line.arg);
        if (!who) return line.arg ? `nobody in the group is called ${line.arg}` : 'who? (/kick <name>)';
        this.kick(who.mid);
        return '';
      }
      case 'promote':
      case 'leader': {
        const who = this.byName(line.arg);
        if (!who) return line.arg ? `nobody in the group is called ${line.arg}` : 'who? (/promote <name>)';
        this.promote(who.mid);
        return '';
      }
      case 'who': {
        if (!this.active) return 'there is no server here: you are on your own';
        const g = this.group;
        if (!g) return 'you are not in a group';
        return `group of ${g.members.length}: ${g.members.map((m) => (m.leader ? `${m.name} (leader)` : m.name)).join(', ')}`;
      }
      case 'accept':
        if (!this.inviteNow) return 'nobody has asked you';
        this.accept();
        return '';
      case 'decline':
        if (!this.inviteNow) return 'nobody has asked you';
        this.decline();
        return '';
      // The game's own word for it, at the game's own 8 m. Who owns what is the server's and this
      // only asks; with nothing made yet (a page that has not wired the ledger) it says so rather
      // than looking like a command that does nothing.
      case 'trade': {
        const ledger = tradeNow();
        if (!ledger) return 'there is nobody to trade with';
        if (ledger.asked) {
          ledger.accept();
          return '';
        }
        if (!line.arg) return 'who? (/trade <name>)';
        const id = this.idByName(line.arg);
        if (!id) return `nobody here is called ${line.arg}`;
        return ledger.askTrade(id, line.arg);
      }
      // The game's own words for agreeing to fight and for calling it off, at the game's own
      // distances. Who may hurt whom is the server's, and this only asks.
      case 'duel': {
        const fight = combatNow();
        if (!fight) return 'there is nobody to fight';
        if (fight.asked) {
          fight.acceptDuel();
          return '';
        }
        if (!line.arg) return 'who? (/duel <name>)';
        const id = this.idByName(line.arg);
        if (!id) return `nobody here is called ${line.arg}`;
        return fight.askDuel(id);
      }
      case 'peace':
        combatNow()?.peace();
        return '';
      case 'help':
        return 'chat: type to say it aloud, /g <words> to the group. /invite <name>, /accept, /decline, /leave, /promote <name>, /kick <name>, /who, /trade <name>, /duel <name>, /peace, /mood <name>.';
      default:
        return `there is no /${line.command}`;
    }
  }

  /** Whoever the game says is standing here, by name: how `/invite <name>` finds a connection to ask. */
  peerByName: (name: string) => number = () => 0;

  private idByName(name: string): number {
    const want = cleanText(name, 40);
    if (!want) return 0;
    return this.peerByName(want) || 0;
  }

  /** A member of the group by name, however it was typed. */
  private byName(name: string): GroupMember | null {
    const want = cleanText(name, 40).toLowerCase();
    if (!want || !this.group) return null;
    for (const m of this.group.members) if (m.name.toLowerCase() === want) return m;
    for (const m of this.group.members) if (m.name.toLowerCase().startsWith(want)) return m;
    return null;
  }

  private post(msg: Record<string, unknown>): void {
    this.stat.sent++;
    this.send(msg);
  }

  // ---- what the server says ------------------------------------------------------------------------

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go on
   * ignoring everything it does not know. Everything in it is treated as words from a stranger.
   */
  handle(msg: Record<string, unknown>): boolean {
    const t = msg?.t;
    if (t === 'chat') {
      this.heard(msg);
      return true;
    }
    if (t !== 'group') return false;
    switch (String(msg.do ?? '')) {
      case 'roster': {
        // A roster that cannot be read is a message that was lost or came from a newer build, not
        // the group ending: ending it is `none`'s job and only `none`'s. The server sends a roster
        // only when something changes, so taking a bad one as "no group" would leave the group
        // invisible until somebody joined or left.
        const read = this.readRoster(msg);
        if (read) this.setRoster(read);
        break;
      }
      case 'none':
        this.setRoster(null);
        this.onNote(noGroupWords(cleanText(msg.why, 24)));
        break;
      case 'invited':
        this.setInvite(this.readInvite(msg));
        break;
      case 'gone':
        if (this.inviteNow) {
          this.setInvite(null);
          this.onNote('the invitation is no longer open');
        }
        break;
      case 'sent': {
        const name = cleanText(msg.name, 40) || 'them';
        this.onNote(`asked ${name} into the group`);
        break;
      }
      case 'refused':
        this.onNote(cleanText(msg.why, 160) || 'the server would not do that');
        break;
      case 'health': {
        // One member's health moved and nothing else did: the row is already drawn, so this is a
        // number going into it rather than a roster arriving. Health is -1 while nothing carries it,
        // because `Number(null)` is zero and a bar read that way is a dead player.
        const whose = cleanText(msg.who, 8);
        const hp = Number(msg.hp);
        const row = this.group?.members.find((m) => m.mid === whose);
        if (row && this.group) {
          row.hp = Number.isFinite(hp) && hp >= 0 ? Math.min(1, hp) : -1;
          this.onRoster(this.group);
        }
        break;
      }
      case 'news': {
        const words = newsWords(cleanText(msg.what, 24), cleanText(msg.name, 40));
        if (words) this.onNote(words);
        break;
      }
      case 'trip':
        this.setTrip(this.readTrip(msg));
        break;
      case 'travelling': {
        const who = cleanText(msg.who, 8);
        const name = cleanText(msg.name, 40) || 'someone';
        const where = msg.where && typeof msg.where === 'object' && !Array.isArray(msg.where) ? (msg.where as Record<string, unknown>) : null;
        // This browser's own row: the server has taken the offer up, and whoever owns travelling is
        // handed where to go. Nothing here moves anybody -- it carries the word.
        if (where && who && this.group && who === this.group.you) {
          const at = Array.isArray(where.at) && where.at.length === 3 ? where.at.map(Number) : null;
          this.onTravel({ planet: cleanText(where.planet, 24), zone: cleanText(where.zone, 24), how: cleanText(where.how, 16) || 'travel', at: at && at.every((v) => Number.isFinite(v)) ? at : null }, who);
        } else this.onNote(`${name} is going with the group`);
        break;
      }
      default:
        // A word this browser does not know: the server is on a newer build, and saying nothing is
        // what keeps an older browser working against it.
        break;
    }
    return true;
  }

  private heard(msg: Record<string, unknown>): void {
    const text = cleanText(msg.text);
    if (!text) return;
    const id = Number(msg.id) || 0;
    const scope: ChatScope = msg.scope === 'group' ? 'group' : 'say';
    const mine = id !== 0 && id === this.selfId();
    this.stat.heard++;
    this.keep({ id, name: cleanText(msg.from, 40) || cleanText(msg.name, 40) || 'someone', scope, text, mine, at: this.now() });
  }

  private keep(line: ChatLine): void {
    this.lines.push(line);
    while (this.lines.length > GROUP_TUNE.log) this.lines.shift();
    this.stat.lines = this.lines.length;
    this.onChat(line);
  }

  private readRoster(msg: Record<string, unknown>): GroupRoster | null {
    const raw = Array.isArray(msg.members) ? msg.members : [];
    if (!raw.length) return null;
    const leader = cleanText(msg.leader, 8);
    const you = cleanText(msg.you, 8);
    const members: GroupMember[] = [];
    for (const r of raw.slice(0, GROUP_TUNE.max)) {
      if (!r || typeof r !== 'object') continue;
      const m = r as Record<string, unknown>;
      const mid = cleanText(m.m, 8);
      if (!mid) continue;
      // Health is `null` on every row until it crosses the wire in a later wave, and `Number(null)`
      // is zero: read that way, every member's bar would read as dead.
      const hp = typeof m.hp === 'number' ? m.hp : -1;
      members.push({
        mid,
        id: Number(m.s) || 0,
        name: cleanText(m.name, 40) || 'someone',
        planet: cleanText(m.planet, 24),
        zone: cleanText(m.zone, 24),
        hp: Number.isFinite(hp) && hp >= 0 ? Math.min(1, hp) : -1,
        leader: m.leader === 1 || mid === leader,
        me: mid === you,
        here: m.here === 1,
        distance: -1,
      });
    }
    if (!members.length) return null;
    return { id: cleanText(msg.id, 40) || 'group', leader, you, members };
  }

  private readInvite(msg: Record<string, unknown>): GroupInvite | null {
    const from = Number(msg.from) || 0;
    if (!from) return null;
    const until = Number(msg.until);
    const end = Number.isFinite(until) && until > 0 ? until : this.serverNow() + GROUP_TUNE.askSeconds * 1000;
    return { from, name: cleanText(msg.name, 40) || 'someone', until: end, left: Math.max(0, (end - this.serverNow()) / 1000) };
  }

  private readTrip(msg: Record<string, unknown>): GroupTrip | null {
    const where = msg.where && typeof msg.where === 'object' && !Array.isArray(msg.where) ? (msg.where as Record<string, unknown>) : null;
    if (!where) return null;
    const until = Number(msg.until);
    const end = Number.isFinite(until) && until > 0 ? until : this.serverNow() + GROUP_TUNE.askSeconds * 1000;
    return {
      from: cleanText(msg.from, 8),
      name: cleanText(msg.name, 40) || 'someone',
      planet: cleanText(where.planet, 24),
      zone: cleanText(where.zone, 24),
      how: cleanText(where.how, 16) || 'travel',
      // The server clamps these three and passes them on; dropped here, a group told to meet
      // somewhere would only ever be told the planet.
      at: Array.isArray(where.at) && where.at.length === 3 && where.at.every((v) => Number.isFinite(Number(v))) ? where.at.map(Number) : null,
      until: end,
      left: Math.max(0, (end - this.serverNow()) / 1000),
    };
  }

  private setRoster(g: GroupRoster | null): void {
    this.group = g;
    this.stat.members = g ? g.members.length : 0;
    this.stat.leader = this.leading;
    // A roster is only ever handed over as a whole, so the distances start again with it; they are put
    // back by the next pass of `step`, a quarter of a second later at the standing rate.
    this.onRoster(g);
  }

  private setInvite(i: GroupInvite | null): void {
    this.inviteNow = i;
    this.stat.invite = i ? i.name : '';
    this.onInvite(i);
  }

  private setTrip(t: GroupTrip | null): void {
    this.tripNow = t;
    this.stat.trip = t ? t.name : '';
    this.onTrip(t);
  }

  /** The line dropped, or the player went to the select screen: everything the server held is let go of. */
  clear(): void {
    if (this.group) this.setRoster(null);
    if (this.inviteNow) this.setInvite(null);
    if (this.tripNow) this.setTrip(null);
  }

  // ---- the slow tick -------------------------------------------------------------------------------

  /**
   * Time passing, at whatever rate the panel asks (a few times a second, never per frame): the
   * countdowns are read off the shared clock and the distances are worked out again. True when
   * something a panel shows has moved, so the panel writes to the page only when it has.
   */
  step(dt: number): boolean {
    let changed = false;
    const now = this.serverNow();
    const inv = this.inviteNow;
    if (inv) {
      const left = Math.max(0, (inv.until - now) / 1000);
      if (Math.ceil(left) !== Math.ceil(inv.left)) changed = true;
      inv.left = left;
      // The server takes its own invitation back when it lapses; this is only so the question here
      // does not sit on the screen for ever if that word is lost.
      if (left <= 0) {
        this.setInvite(null);
        this.onNote('the invitation ran out');
        changed = true;
      }
    }
    const trip = this.tripNow;
    if (trip) {
      const left = Math.max(0, (trip.until - now) / 1000);
      if (Math.ceil(left) !== Math.ceil(trip.left)) changed = true;
      trip.left = left;
      if (left <= 0) {
        this.setTrip(null);
        changed = true;
      }
    }
    const g = this.group;
    if (!g) return changed;
    this.distanceClock -= dt;
    if (this.distanceClock > 0) return changed;
    this.distanceClock = 1 / Math.max(0.5, GROUP_TUNE.distanceHz);
    const me = this.scratchMe;
    const there = this.meAt(me);
    for (const m of g.members) {
      let away = -1;
      if (m.me) away = 0;
      else if (there && m.here && m.id > 0 && this.peerAt(m.id, this.scratchThem)) {
        away = Math.round(Math.hypot(this.scratchThem.x - me.x, this.scratchThem.y - me.y, this.scratchThem.z - me.z));
      }
      if (away !== m.distance) {
        m.distance = away;
        changed = true;
      }
    }
    return changed;
  }

  /** How far away a player is, in metres, or a very large number when they are not here to measure. */
  distanceTo(id: number): number {
    if (!this.meAt(this.scratchMe) || !this.peerAt(id, this.scratchThem)) return GROUP_RANGE.unlimited;
    return Math.hypot(this.scratchThem.x - this.scratchMe.x, this.scratchThem.y - this.scratchMe.y, this.scratchThem.z - this.scratchMe.z);
  }

  /** What the group is doing, in the object it always answers with. */
  debug(): GroupStats {
    this.stat.active = this.active;
    this.stat.leader = this.leading;
    return this.stat;
  }
}
