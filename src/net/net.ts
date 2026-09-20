// The client of the relay (server/relay.mjs): a WebSocket that carries where this player is a
// few times a second and brings back everyone else's, with a reconnect when the line drops.

import type { Look } from '../player/look';
import type { ShipFit } from '../vehicles/shipFit';
import { sharedClock } from '../world/sharedClock.ts';
import { SESSION, Session, WIRE_VERSION, type CharacterSummary, type Settlement } from './session.ts';
import { rideFields, type PeerAboard } from './aboardMath.ts';

export interface Hello {
  name: string;
  species: string;
  class: 'jedi' | 'bounty_hunter';
  planet: string;
  zone?: string;
  /** How the character looks: shape, height, colours and outfit, so the others draw it as it is. */
  look?: Look;
  /** The weapons in hand, by weapon id: right and left. */
  held?: { r?: string; l?: string };
  /** The ship this player flies (or last flew), with its components, droid and paint (server/shipWire.mjs checks it). */
  ship?: { id: string; fit: ShipFit };
  /** The colour their lightsaber's blade is lit in, as hex; left out by a browser built before this. */
  saber?: number;
}

/** The vehicle a peer is on: which (a garage id), where it is and how it is turned, and how the peer is in it. */
export interface PeerVehicle {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
  /** Riding it from its seat, flying it from its rooms, or aboard as a passenger. */
  role: 'ride' | 'pilot' | 'aboard';
  /** The riding pose's name, for the rider's clip. */
  pose?: string;
  /** A ship with wings that open: 1 while the pilot's are open or opening, 0 while closed or closing. */
  w?: 0 | 1;
  /** 1 while the ship is set down on the ground: the picture of it stands still rather than gliding to each message. */
  landed?: 0 | 1;
  /**
   * This ship clamped onto another player's: whose (`to`, their relay id) and where it rests in that
   * ship's own frame. The picture of it is drawn from the carrier's pose times this, so it stays put on
   * the hull between messages instead of gliding about on it.
   */
  dock?: { to: number; p: [number, number, number]; q: [number, number, number, number] };
}

/**
 * A player who is in a hull somebody else flies, and the rule that it takes the place of the
 * vehicle they ride. Both live in `./aboardMath.ts`, which nothing of three.js or the page reaches
 * into, so the node test can run the rule and the maths that go with it; the shape is passed on
 * from here because a peer's state is what carries it.
 */
export type { PeerAboard } from './aboardMath.ts';

/** The words two browsers pass about one ship clamped onto another (server/vehicleWire.mjs). */
export type AskWord = 'dock' | 'allow' | 'refuse' | 'undock';

export interface PeerState {
  p: [number, number, number];
  h: number;
  /** The rig state name (idle, run, ...). */
  s: string;
  /** Speed, m/s, for the clip's pace. */
  v: number;
  /** Mounted on a vehicle. */
  m: boolean;
  /** The saber is lit. */
  sab: boolean;
  /**
   * Their blade out of their hand: where it is in the world and how far it has spun, sent only
   * while it is in the air. A blade is a thing in flight with a place of its own, and nothing else
   * on the wire says where it is; on the other side it is drawn from a copy of their own hilt.
   */
  tb?: [number, number, number, number];
  /** The figure's whole turn (aboard a banked hull, adrift in space), when a heading is not enough. */
  q?: [number, number, number, number];
  /** The vehicle the peer is on, when they are on one. Never sent with `in`: one or the other. */
  veh?: PeerVehicle;
  /** The hull of another player's ship the peer is in, when they are in one: it replaces `veh`. */
  in?: PeerAboard;
  /** In a hyperspace jump, from its start until its tunnel opens at the far end: the peer and their ship are not shown. */
  j?: 1;
}

export interface Peer {
  id: number;
  hello: Hello;
  state: PeerState | null;
}

type Status = 'off' | 'connecting' | 'online' | 'reconnecting';

/**
 * What a server that holds the world may say, read off the same parsed message. It is its own shape
 * because two of its fields spell words the older messages already use: `s` is a rig state on a state
 * and a clock on a pong, and `word` is a docking word on an ask and a flag on a hail. Nothing is ever
 * read as both, because each case reads one shape or the other and never mixes them.
 */
interface ServerWord {
  v?: number;
  now?: number;
  epoch?: number;
  dayMs?: number;
  nonce?: string;
  word?: number;
  ff?: number;
  you?: { player?: string; character?: string; name?: string };
  keep?: string;
  character?: string;
  browser?: CharacterSummary;
  server?: CharacterSummary;
  take?: string;
  record?: CharacterSummary | null;
  why?: string;
  by?: string;
  c?: number;
  s?: number;
}

/**
 * How often the socket asks the clock whether it wants a round trip, in milliseconds. It is not the
 * rate of the round trips themselves -- that is the shared clock's own `CLOCK_TUNE.pingSeconds`, and
 * `duePing()` is what decides -- because that number is live through `__sharedDay({ pingSeconds })` and
 * a timer set from it once at module load could only ever be made slower, never faster, which is the
 * direction anyone tuning a clock uses. A comparison a second costs nothing and allocates nothing.
 *
 * Invented: one second, small enough that the finest rate worth asking for is met.
 */
const PING_TICK = 1000;

const STORAGE = 'swg.server';

export class Net {
  private socket: WebSocket | null = null;
  private url = '';
  private hello: Hello | null = null;
  private retryTimer = 0;
  private retryDelay = 1000;
  private wanted = false;
  /**
   * Who this browser is, and what the server on the other end holds. It is here rather than beside the
   * game because it is the socket that hears the words it answers; everything else in the game asks the
   * session, never the socket, what is true.
   */
  readonly session = new Session();
  /** The wait for the server to speak first, and the clock's round trips. */
  private hailTimer = 0;
  private pingTimer = 0;
  /** Whether the hello has gone on this line yet: it waits for the handshake to be settled one way or the other. */
  private greeted = false;
  /**
   * The hello went on the wait running out rather than on the handshake, so the far end may have
   * thrown it away: a server started with a join word listens to nothing until a browser has claimed.
   * If the hail then turns up late, the hello has to be said again, or this browser sits on the server
   * with no record at all -- every state it sends dropped, invisible to everyone including itself, and
   * nothing in the game to say why.
   */
  private greetedEarly = false;
  status: Status = 'off';
  id = 0;
  readonly peers = new Map<number, Peer>();
  onJoin: (peer: Peer) => void = () => {};
  onLeave: (id: number) => void = () => {};
  onHello: (peer: Peer) => void = () => {};
  onState: (id: number, state: PeerState) => void = () => {};
  onEmote: (id: number, clip: string) => void = () => {};
  /** A word meant for this player alone: one ship asking another's pilot for room on their hull, and the answer. */
  onAsk: (from: number, word: AskWord) => void = () => {};
  onStatus: (status: Status, detail: string) => void = () => {};
  /** Something the player has to read: joining, being taken over, a refusal. The message line takes it. */
  onNotice: (text: string) => void = () => {};
  /**
   * A word from a server that holds the world which this socket does not read itself: a group's
   * roster and its news, and a line of chat. It is handed over as it arrived, whole, because what it
   * means belongs to the module that asked for it (src/net/groups.ts) and not here. An old relay
   * never sends any of these, so with one this is never called.
   */
  onWord: (msg: Record<string, unknown>) => void = () => {};

  /** The server kept in this browser, or the one in ?server=, or none. */
  static savedUrl(): string {
    const param = new URLSearchParams(location.search).get('server');
    if (param) return param;
    try {
      return localStorage.getItem(STORAGE) ?? '';
    } catch {
      return '';
    }
  }

  static saveUrl(url: string): void {
    try {
      if (url) localStorage.setItem(STORAGE, url);
      else localStorage.removeItem(STORAGE);
    } catch {
      /* no storage */
    }
  }

  constructor() {
    // The session answers the server through this socket, and what it needs the player to read goes
    // where every other notice goes. Both are read at call time, so the game may replace `onNotice`.
    this.session.send = (msg) => this.send(msg);
    this.session.onNote = (text) => this.onNotice(text);
  }

  get online(): boolean {
    return this.status === 'online';
  }

  /** Connect (or reconnect) to a relay and announce who this is; the hello is repeated on every reconnect. */
  connect(url: string, hello: Hello): void {
    this.url = url.trim();
    this.hello = hello;
    // `wanted` is what the reconnect hangs on, and being taken over or turned away clears it; asking to
    // connect is the one thing that sets it again, because this time the player asked for it.
    this.wanted = !!this.url;
    this.open();
  }

  /** Who and where this player is now (a new world after travel); sent at once when online. */
  setHello(hello: Hello): void {
    this.hello = hello;
    // Before the handshake has settled the hello has not gone yet, and the one the handshake sends will
    // be this one: a server started with a join word listens to nothing until it knows who is there, so
    // a hello sent ahead of the claim would simply be dropped and never sent again.
    if (this.online && this.greeted) this.send({ t: 'hello', v: WIRE_VERSION, ...hello });
  }

  /** The hello, once per line, after the handshake has settled one way or the other. */
  private greet(): void {
    if (this.greeted || this.socket?.readyState !== WebSocket.OPEN) return;
    this.greeted = true;
    if (this.hello) this.send({ t: 'hello', v: WIRE_VERSION, ...this.hello });
  }

  disconnect(): void {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    this.stopTimers();
    this.socket?.close();
    this.socket = null;
    this.clearPeers();
    this.session.closed();
    // Put down on purpose: the day goes back to this browser's own clock rather than carrying the
    // server's offset about with it.
    sharedClock.none();
    this.setStatus('off', '');
  }

  /** One round trip for the clock, when it wants one: the answer comes back to the case above. */
  private ping(): void {
    if (sharedClock.duePing()) this.send({ t: 'ping', c: sharedClock.beginPing() });
  }

  /** The wait for a hail and the clock's round trips, both stopped whenever the socket goes. */
  private stopTimers(): void {
    window.clearTimeout(this.hailTimer);
    window.clearInterval(this.pingTimer);
    this.hailTimer = 0;
    this.pingTimer = 0;
  }

  private open(): void {
    if (!this.wanted || !this.url) return;
    window.clearTimeout(this.retryTimer);
    this.stopTimers();
    this.socket?.close();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.setStatus('off', `bad address: ${err instanceof Error ? err.message : String(err)}`);
      this.wanted = false;
      return;
    }
    this.socket = ws;
    this.setStatus(this.retryDelay > 1000 ? 'reconnecting' : 'connecting', this.url);
    ws.onopen = () => {
      this.retryDelay = 1000;
      this.greeted = false;
      this.greetedEarly = false;
      this.setStatus('online', this.url);
      this.session.opening();
      // With no join word the hello goes at once, exactly as it always did, and the claim follows the
      // server's challenge whenever that arrives. With a word it waits for the challenge, because a
      // server started with one listens to nothing until it has been told who is there: a hello sent
      // ahead of the claim would be dropped and never sent again. The wait below is the backstop for a
      // line that says nothing at all, which is the relay that came before.
      if (!this.session.word) this.greet();
      this.hailTimer = window.setTimeout(() => {
        this.hailTimer = 0;
        this.session.hailTimedOut();
        sharedClock.none();
        // With a word set nothing has been said yet, so this hello is the one going ahead of a claim.
        // With none, the hello went at the moment the line opened and was kept by whatever is there.
        this.greetedEarly = !!this.session.word;
        this.greet();
      }, SESSION.hailWait);
    };
    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.stopTimers();
      this.clearPeers();
      this.session.closed();
      // The line dropped rather than being put down: what the clock had estimated is kept and the day
      // carries on at its own rate, so nothing jumps while the line comes back.
      sharedClock.lost();
      if (!this.wanted) return;
      this.setStatus('reconnecting', `in ${Math.round(this.retryDelay / 1000)} s`);
      this.retryTimer = window.setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(15000, this.retryDelay * 2);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private clearPeers(): void {
    for (const id of [...this.peers.keys()]) {
      this.peers.delete(id);
      this.onLeave(id);
    }
  }

  private setStatus(status: Status, detail: string): void {
    this.status = status;
    this.onStatus(status, detail);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Where this player is now; a few times a second is plenty. */
  sendState(state: PeerState): void {
    if (this.online) this.send({ t: 'state', ...state });
  }

  sendEmote(clip: string): void {
    if (this.online) this.send({ t: 'emote', clip });
  }

  /** A word to one other player: the relay passes it to them and to nobody else. */
  sendAsk(to: number, word: AskWord): void {
    if (this.online && to > 0) this.send({ t: 'ask', to, word });
  }

  /**
   * A word for a server that holds the world, made up by whoever owns that kind of word (a group
   * being asked for, a line of chat). It goes out as it is given, once the handshake has settled: a
   * server started with a join word listens to nothing before that, and an old relay drops anything
   * it does not know, so nothing has to ask which kind of far end it is talking to.
   */
  sendWord(msg: Record<string, unknown>): void {
    if (this.online && this.greeted) this.send(msg);
  }

  private receive(text: string): void {
    let msg: { t: string; id?: number; hello?: Hello; peers?: Peer[]; clip?: string; word?: string } & Partial<PeerState>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    // The server's own words are read off the same object through this shape: `s` and `word` mean one
    // thing to a state or an ask and another to a pong or a hail, so they are never read as both.
    const server = msg as unknown as ServerWord;
    switch (msg.t) {
      case 'hail':
        // The server speaks first. An old relay never sends this and a browser that never hears it goes
        // on as it always has; nothing here can run twice, because a hail comes once per line.
        window.clearTimeout(this.hailTimer);
        this.hailTimer = 0;
        // The world's clock, from the greeting: the day and the weather follow it from here on, and the
        // round trips below sharpen it. The hello follows the claim, never the other way about.
        sharedClock.hail(Number(server.now), Number(server.dayMs) || undefined);
        this.session.hail({ v: Number(server.v) || 0, now: Number(server.now) || 0, epoch: Number(server.epoch) || 0, dayMs: Number(server.dayMs) || 0, nonce: String(server.nonce ?? ''), word: server.word === 1 ? 1 : 0, ff: server.ff === 1 ? 1 : 0 });
        // A hail that came in after the wait had already run out: this browser said hello ahead of its
        // claim, and a server that asks for a join word threw that hello away without a word about it.
        // Now that it has claimed, the hello is said again. A server that asks for no word kept the
        // first one, and a second would cost this browser the welcome it is owed.
        if (this.greetedEarly && server.word === 1) this.greeted = false;
        this.greetedEarly = false;
        this.greet();
        // The round trips are only worth taking while the clock really is the server's: a greeting
        // whose clock could not be true leaves the day on this machine's own, and a timer asking
        // nothing every few seconds for the life of the page is worse than no timer at all.
        if (sharedClock.shared) {
          this.ping();
          window.clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => this.ping(), PING_TICK);
        }
        break;
      case 'pong':
        sharedClock.pong(Number(server.c), Number(server.s));
        break;
      case 'claimed':
        // The server has us: this is what makes it a server session, not the welcome, because a server
        // with a join word answers the claim before it will listen to a hello at all.
        this.session.claimed(server.you, typeof server.keep === 'string' ? (server.keep as Settlement) : '');
        break;
      case 'settle':
        // Two copies of one character with the same change counter and a different story (decision 4).
        if (server.character && server.browser && server.server) this.session.settleAsk(String(server.character), server.browser, server.server);
        break;
      case 'settled':
        if (server.character) this.session.settled(String(server.character), String(server.take ?? ''), server.record ?? null);
        break;
      case 'refused':
        // Not the line: only the character. The server holds that id for another player and leaves the
        // line open on purpose, so the browser is still itself and can offer a different character.
        // Nothing read this word before, and such a browser sat on an open line it would never be
        // welcomed onto, with nothing anywhere to say why.
        this.session.refusedCharacter(typeof server.why === 'string' ? server.why : '');
        break;
      case 'denied':
        // The server will not have us and saying it again cannot change that, so the reconnect stops:
        // `wanted` false is what keeps a browser from asking for ever.
        this.wanted = false;
        this.session.denied(typeof server.why === 'string' ? server.why : '');
        // Turned away is not a line that dropped: this is a world this browser is not in, so the day
        // goes back to its own clock rather than keeping a stranger's offset for the life of the page.
        // It must come before the close, because the close's own handler keeps whatever is still shared.
        sharedClock.none();
        this.socket?.close();
        this.setStatus('off', 'turned away');
        break;
      case 'taken':
        // The same character was opened in a newer browser (decision 8). This one stops wanting to
        // reconnect; without that the two would take the character off one another for ever.
        this.wanted = false;
        this.session.taken(typeof server.by === 'string' ? server.by : undefined);
        // The same as being turned away: this browser is out of that world, so it takes its own clock
        // back rather than keeping the server's offset with nothing to correct it.
        sharedClock.none();
        this.socket?.close();
        this.clearPeers();
        this.setStatus('off', 'taken over');
        break;
      case 'welcome':
        this.id = msg.id ?? 0;
        if (this.hailTimer) {
          // A welcome with nothing said before it is the old relay answering the hello. (It cannot be
          // this browser's own hello: that waits for the hail or the wait, and both clear this timer.)
          window.clearTimeout(this.hailTimer);
          this.hailTimer = 0;
          this.session.welcomedWithoutHail();
          sharedClock.none();
        }
        this.session.welcome({ id: msg.id, v: Number(server.v) || 0, ff: server.ff === 1 ? 1 : 0 });
        for (const p of msg.peers ?? []) {
          this.peers.set(p.id, p);
          this.onJoin(p);
          if (p.state) this.onState(p.id, p.state);
        }
        break;
      case 'join':
        if (msg.id !== undefined && msg.hello) {
          const peer = { id: msg.id, hello: msg.hello, state: null };
          this.peers.set(msg.id, peer);
          this.onJoin(peer);
        }
        break;
      case 'hello':
        if (msg.id !== undefined && msg.hello) {
          const peer = this.peers.get(msg.id);
          if (peer) {
            peer.hello = msg.hello;
            this.onHello(peer);
          }
        }
        break;
      case 'leave':
        if (msg.id !== undefined) {
          this.peers.delete(msg.id);
          this.onLeave(msg.id);
        }
        break;
      case 'state':
        if (msg.id !== undefined && msg.p) {
          const peer = this.peers.get(msg.id);
          // `veh` and `in` never both: the server keeps one or the other (server/vehicleWire.mjs's
          // `cleanRide`), and `rideFields` is that rule on this side, over a field that is checked
          // rather than trusted -- a far end on another build can send a hull with no place in it,
          // and a throw here would cost every message after it. A state also arrives this way from
          // the roster a server sends on joining, which no live message has been through.
          const state: PeerState = { p: msg.p, h: msg.h ?? 0, s: msg.s ?? 'idle', v: msg.v ?? 0, m: !!msg.m, sab: !!msg.sab, q: msg.q, ...rideFields(msg.in, msg.veh), ...(msg.j === 1 ? { j: 1 as const } : {}) };
          if (peer) peer.state = state;
          this.onState(msg.id, state);
        }
        break;
      case 'emote':
        // An empty clip is the end of a dance or a sit: the figure goes back to what it was doing.
        if (msg.id !== undefined && typeof msg.clip === 'string') this.onEmote(msg.id, msg.clip);
        break;
      case 'ask':
        // Checked here as well as at the relay: a word is acted on, and an unknown one must do nothing.
        if (msg.id !== undefined && (msg.word === 'dock' || msg.word === 'allow' || msg.word === 'refuse' || msg.word === 'undock')) this.onAsk(msg.id, msg.word);
        break;
      case 'group':
      case 'chat':
      // The fight between players: the bolts that cross, where each one landed, a blade turning one
      // away, health, death and the duel. Handed over whole, as the group's words are, because what
      // they mean belongs to src/net/combatNet.ts and not here.
      case 'shot':
      case 'end':
      case 'hurt':
      case 'blocked':
      case 'health':
      case 'died':
      case 'duel':
        // The group and the words players type: handed over whole to whoever owns them. Nothing is
        // read here, so this switch does not have to grow a case for every word a group can say.
        this.onWord(msg as unknown as Record<string, unknown>);
        break;
    }
  }
}
