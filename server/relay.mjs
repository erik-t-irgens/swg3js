#!/usr/bin/env node
// The server for playing together: every browser says where it is and what it is doing a few times
// a second and is told everyone else's news, and the server holds the few things nobody can be
// trusted to hold alone -- the world's clock, who each player is, and which of their characters
// they are playing. No dependencies: a WebSocket server on Node's own http module, text frames
// only, with the checking and the truth in sibling modules beside this one.
//
//   node server/relay.mjs [port] [--word=<something>] [--data=<folder>] [--friendly-fire]
//   npm run relay -- --word=mos-eisley
//
// It still speaks to a browser built before any of this: such a browser never sends a claim, never
// hears the hail, and plays exactly as it always has. A browser built for this server that hears no
// hail within a second knows it is talking to the old relay and turns everything new off.
//
// Messages, JSON, browser to server:
//   { t: 'claim', player, key?, proof, word?, character, name, counter?, about? }
//                                                          who this is and which character (identity.mjs):
//                                                          the public id, the verifier on a first meeting,
//                                                          the answer to the hail's nonce, the same for the
//                                                          join word, and the character with its change counter
//   { t: 'settle', character, take: browser|server }        the answer when two copies of a character tie
//   { t: 'ping', c }                                        the browser's clock, to work the offset out
//   { t: 'hello', name, species, class, planet, zone, look, held, ship }   who, where and how they look (shape,
//                                                          height, colours, outfit), the weapons in hand
//                                                          { r, l } by id, and the ship they fly
//                                                          { id, fit: { components, paint, droid } } (shipWire.mjs);
//                                                          sent on joining, on travel and on a change
//   { t: 'state', p: [x, y, z], h, s, v, m, sab, q?, veh? }   position, heading, rig state, speed, mounted, saber lit,
//                                                          the whole turn as a quaternion (aboard, adrift), the vehicle
//                                                          ridden { id, p, q, role: ride|pilot|aboard, pose, w, landed, dock }
//                                                          (vehicleWire.mjs); j: 1 while in a hyperspace jump
//   { t: 'emote', clip }
//   { t: 'ask', to, word: dock|allow|refuse|undock }         the one message meant for a single other player: asking
//                                                          their pilot for room on their hull, and the answer
// Server to browser:
//   { t: 'hail', v, now, epoch, dayMs, nonce, word, ff }     sent the instant the socket opens, before anything is said
//   { t: 'claimed', you, keep }   { t: 'denied', why }   { t: 'refused', why }   { t: 'taken', by }
//                                 (denied closes the line; refused is about the character only and
//                                  leaves the browser connected to offer another)
//   { t: 'settle', character, browser, server }   { t: 'settled', character, take, record }
//   { t: 'pong', c, s }
//   { t: 'welcome', id, v, now, epoch, dayMs, you, ff, peers: [{ id, hello, state }] }
//   { t: 'join', id, hello }   { t: 'leave', id }   { t: 'state', id, ... }   { t: 'emote', id, clip }
//   { t: 'hello', id, hello }  (a peer already on this world changed something)
//   { t: 'ask', id, word }     (from the player who sent it, to the one it was addressed to, and to nobody else)
//
// Everything but the claim, the ping and the ask goes to the world the player is on and no further
// (rooms.mjs). Before this, a browser was told about people on other planets and dressed them,
// fetched their rig and built their ship for nothing. A browser is told a peer has gone only when
// that peer's line closes: someone who merely walks off this world is handed over as a hello saying
// where they are now, and the browser keeps what it already built and stops drawing them.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cleanAsk } from './vehicleWire.mjs';
import { WIRE, cleanClaim, cleanEmote, cleanHello, cleanPing, cleanSettle, cleanState } from './wire.mjs';
import { Rooms, roomKey, roomLabel } from './rooms.mjs';
import { WorldClock, DAY_MS } from './clock.mjs';
import { STORE_TUNING, openStore } from './store.mjs';
import { Sessions, checkClaim, makeNonce, summaryOf } from './identity.mjs';

/** What this server speaks. A browser that hears no hail is talking to the relay that came before. */
const WIRE_VERSION = 2;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Every number the server invents, in one place, so there is one thing to read and one thing to
 * change. None of them is from the game: they are rates, caps and patiences chosen here, and any of
 * them can be moved for a run with `--set <name>=<number>` (the status page prints them all back).
 */
const TUNING = {
  /** Messages a browser may send in a second before the rest of that second is dropped. */
  'rate.messages': 40,
  /** Bytes a browser may send in a second before the rest of that second is dropped. */
  'rate.bytes': 65536,
  /** How far past those a browser goes before it is shown the door rather than trimmed. */
  'rate.closeFactor': 2,
  /** Bytes queued for a browser that has stopped reading before its state and news are dropped. */
  'send.backlog': 262144,
  /** How often the server pings, to keep a line open through a proxy and to find the dead. */
  'watch.ping': 20000,
  /** How long a browser may say nothing at all -- not even a pong -- before the line is closed. */
  'watch.silence': 60000,
  /** How long a browser has to say who it is when a join word is set, before it is turned away. */
  'claim.grace': 10000,
  /** How long the server waits for an answer about a character whose two copies tie. */
  'settle.wait': 60000,
  /** How long a browser being turned away has to read the reason before the line is closed. */
  'close.grace': 50,
  /** How long a shutdown waits for the sockets to close before it goes anyway. */
  'shutdown.wait': 500,
  /** How often the world is written to disk when anything has changed (the store's own default). */
  'store.saveEvery': STORE_TUNING.saveEvery,
  /** How many times a rename refused for an instant is tried before the next write is left to do it. */
  'store.renameTries': STORE_TUNING.renameTries,
};

// ---------------------------------------------------------------------------------------------
// The command line

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`swg3js server

  node server/relay.mjs [port] [options]
  npm run relay -- --word=mos-eisley

  --port=<n>          the port to listen on (default 8787; a bare number works too)
  --word=<something>  a join word: a browser must carry it, and one that cannot is turned away
  --data=<folder>     where the world is kept (default server/data)
  --friendly-fire     let players hurt each other (off by default)
  --day=<seconds>     how long a day is (default ${DAY_MS / 1000}, the game's own)
  --set <name>=<n>    move one of the server's own numbers for this run
  --help              this
`);
  process.exit(0);
}

const flag = (name) => args.some((a) => a === `--${name}`);
const option = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] && !args[at + 1].startsWith('--')) return args[at + 1];
  return fallback;
};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set' && !args[i].startsWith('--set=')) continue;
  const pair = args[i] === '--set' ? args[i + 1] : args[i].slice(6);
  const cut = String(pair ?? '').indexOf('=');
  if (cut <= 0) continue;
  const name = pair.slice(0, cut);
  const value = Number(pair.slice(cut + 1));
  if (!Number.isFinite(value)) continue;
  // `in` would see `toString` and every other name on the prototype and let one be written over.
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (has(TUNING, name)) TUNING[name] = value;
  else if (name.startsWith('wire.') && has(WIRE, name.slice(5))) WIRE[name.slice(5)] = value;
  else console.log(`  --set ${name}: there is no such number, and it has been ignored`);
}

const bare = args.find((a) => /^\d+$/.test(a));
const PORT = Number(option('port', bare ?? process.env.PORT ?? '8787'));
const WORD = option('word', process.env.SWG_WORD ?? '');
// Beside this file, not beside whatever folder the server happened to be started from: a world kept
// in the wrong place looks exactly like every player having disappeared.
const DATA = option('data', join(import.meta.dirname, 'data'));
const FRIENDLY_FIRE = flag('friendly-fire') || flag('ff');
const DAY = Number(option('day', '')) > 0 ? Number(option('day', '')) * 1000 : DAY_MS;

// ---------------------------------------------------------------------------------------------
// The truth, the clock and the rooms

// The store knows when this world first ran and hands that to the clock, which is how the server can
// say how old the world is. The time of day itself is the wall clock and needs nothing remembered.
const store = openStore({ dir: DATA, saveEvery: TUNING['store.saveEvery'], renameTries: TUNING['store.renameTries'], log: (line) => console.log(`  ${line}`) });
const clock = new WorldClock({ epoch: store.data.epoch, dayMs: DAY });
const rooms = new Rooms();
const sessions = new Sessions();
const settings = { friendlyFire: FRIENDLY_FIRE, word: WORD ? 1 : 0, dayMs: DAY };
const had = store.data.settings ?? {};
if (had.friendlyFire !== settings.friendlyFire || had.word !== settings.word || had.dayMs !== settings.dayMs) store.change({ t: 'settings', settings });

/** A connected browser: its socket, its buffers, who it turned out to be, and its last news. */
const clients = new Map();
let nextId = 1;

// ---------------------------------------------------------------------------------------------
// Frames

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const n = payload.length;
  let header;
  if (n < 126) header = Buffer.from([0x81, n]);
  else if (n < 65536) header = Buffer.from([0x81, 126, n >> 8, n & 255]);
  else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Send one message. `lossy` marks the news a browser can miss without harm -- where someone is
 * standing, what their rig is playing -- which is dropped while that browser's queue is backed up;
 * everything else (who joined, who left, who they are) is always queued, because missing one leaves
 * the two sides disagreeing for good.
 */
function send(c, msg, lossy = false) {
  if (!c || c.socket.destroyed) return;
  if (lossy && c.socket.writableLength > TUNING['send.backlog']) {
    c.dropped++;
    // Said once per browser, because there is otherwise nothing at all to see: the status page keeps
    // the running count beside how much is still queued.
    if (c.dropped === 1) console.log(`  ${c.id} ${who(c)} is not reading fast enough (${c.socket.writableLength} bytes queued): its news is being trimmed`);
    return;
  }
  c.socket.write(frame(JSON.stringify(msg)));
}

/** Everyone on one world, one of them left out. */
function sendToRoom(key, msg, except = null, lossy = false) {
  if (!key) return;
  for (const id of rooms.members(key)) {
    if (id === except) continue;
    send(clients.get(id), msg, lossy);
  }
}

/**
 * Tell one browser about a peer. The first time it is a `join`, which is what makes that browser
 * fetch a rig, dress it and build its ship; ever after it is a `hello`, which only hands over what
 * changed. This is the difference between a friend hopping to another planet and back costing
 * nothing and costing a shader compile on a live frame at the moment they reappear -- a browser
 * keeps a peer it has already built and simply stops drawing them while they are elsewhere, exactly
 * as it did when every message went to everybody.
 */
function tellAbout(c, peer) {
  if (!c || !peer?.hello || c.id === peer.id) return;
  if (c.known.has(peer.id)) send(c, { t: 'hello', id: peer.id, hello: peer.hello });
  else {
    c.known.add(peer.id);
    send(c, { t: 'join', id: peer.id, hello: peer.hello });
  }
}

/** The same for everyone on one world. */
function tellRoomAbout(key, peer) {
  if (!key) return;
  for (const id of rooms.members(key)) {
    if (id === peer.id) continue;
    tellAbout(clients.get(id), peer);
  }
}

/** Parse the frames in a browser's buffer; returns the messages found, keeping a partial frame. */
function parseFrames(c) {
  const out = [];
  let buf = c.buffer;
  while (buf.length >= 2) {
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let p = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      p = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      len = Number(buf.readBigUInt64BE(2));
      p = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < p + maskLen + len) break;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    const data = Buffer.from(buf.subarray(p + maskLen, p + maskLen + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    buf = buf.subarray(p + maskLen + len);
    if (opcode === 0x8) {
      out.push({ close: true });
      break;
    } else if (opcode === 0x9) {
      // Ping: pong back with the same payload.
      const pong = Buffer.concat([Buffer.from([0x8a, data.length]), data]);
      c.socket.write(pong);
    } else if (opcode === 0xa) {
      // The answer to our own ping: this line is alive.
      c.heard = Date.now();
    } else if (opcode === 0x1 || opcode === 0x0) {
      c.partial = Buffer.concat([c.partial, data]);
      if (fin) {
        out.push({ text: c.partial.toString('utf8') });
        c.partial = Buffer.alloc(0);
      }
    }
  }
  c.buffer = buf;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Who a browser is

/** The name to put in a log line for a connection. */
function who(c) {
  return c.hello?.name ? `"${c.hello.name}"` : c.character ? `"${c.character}"` : 'someone';
}

/** Turn a browser away, with a reason it can show the player, and close the line. */
function deny(c, why) {
  send(c, { t: 'denied', why });
  console.log(`  ${c.id} was turned away: ${why}`);
  setTimeout(() => c.socket.destroy(), TUNING['close.grace']);
}

function onClaim(c, msg) {
  const claim = cleanClaim(msg);
  if (!claim) return;
  const verdict = checkClaim(store.data, claim, c.nonce, { word: WORD });
  if (!verdict.ok) {
    // A bad proof or a bad join word is the end of the line: this browser is not who it says it is
    // and asking again cannot change that. A character another player already owns is the end of
    // that character only, so the line is left open and the browser can offer a different one --
    // closing it would lock a player out of the server for good over an id two browsers happened to
    // make the same way.
    if (verdict.character === false) {
      send(c, { t: 'refused', why: verdict.why });
      console.log(`  ${c.id} asked for ${claim.character}, which another player owns: refused, and the line is left open`);
    } else {
      deny(c, verdict.why);
    }
    return;
  }
  // The player: registered on a first meeting with the verifier they sent, and stamped as seen.
  if (verdict.registered) {
    store.change({ t: 'player', id: verdict.player, player: { key: claim.key, name: claim.name, first: clock.now(), seen: clock.now() } });
    console.log(`  ${c.id} is a player this server has not met before (${verdict.player}), now registered`);
  } else {
    store.change({ t: 'player', id: verdict.player, player: { name: claim.name, seen: clock.now() } });
  }
  c.player = verdict.player;
  c.character = verdict.character;
  // The character: decision 4's merge, and nothing is thrown away without the player being told.
  if (verdict.keep === 'browser') {
    store.change({ t: 'character', id: verdict.character, character: verdict.offered });
  } else if (verdict.keep === 'server') {
    send(c, { t: 'settled', character: verdict.character, take: 'server', record: summaryOf(verdict.stored) });
    console.log(`  ${c.id} offered ${who(c)} at change ${verdict.offered.counter} and the server holds change ${verdict.stored.counter}: the server's copy stands`);
  } else if (verdict.keep === 'ask') {
    send(c, { t: 'settle', character: verdict.character, browser: summaryOf(verdict.offered), server: summaryOf(verdict.stored) });
    c.asking = { character: verdict.character, offered: verdict.offered, stored: verdict.stored };
    console.log(`  ${c.id} and the server both have ${who(c)} at change ${verdict.offered.counter} and they differ: asking which to keep`);
    const wait = setTimeout(() => {
      if (c.asking?.character !== verdict.character) return;
      c.asking = null;
      send(c, { t: 'settled', character: verdict.character, take: 'server', record: summaryOf(verdict.stored) });
      console.log(`  ${c.id} did not answer about ${verdict.character}: the server's copy stands, and the browser still has its own`);
    }, TUNING['settle.wait']);
    if (typeof wait.unref === 'function') wait.unref();
  }
  // The same character in a second browser: the newer one has it, and the older is told so.
  const before = sessions.take(verdict.character, c.id);
  if (before !== null) {
    const old = clients.get(before);
    if (old) {
      send(old, { t: 'taken', by: claim.name });
      console.log(`  ${before} was playing ${verdict.character} and ${c.id} has just taken it over`);
      setTimeout(() => old.socket.destroy(), TUNING['close.grace']);
    }
  }
  send(c, { t: 'claimed', you: { player: verdict.player, character: verdict.character, name: claim.name }, keep: verdict.keep });
  console.log(`  ${c.id} is player ${verdict.player} playing ${claim.name}`);
}

function onSettle(c, msg) {
  const settle = cleanSettle(msg);
  if (!settle || c.asking?.character !== settle.character) return;
  const { offered, stored } = c.asking;
  c.asking = null;
  if (settle.take === 'browser') {
    store.change({ t: 'character', id: settle.character, character: offered });
    console.log(`  ${c.id} kept the browser's copy of ${settle.character}`);
  } else {
    send(c, { t: 'settled', character: settle.character, take: 'server', record: summaryOf(stored) });
    console.log(`  ${c.id} kept the server's copy of ${settle.character}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The switch

/**
 * One message from a browser. `trimmed` is set while that browser is past its allowance for the
 * second: the news is thrown away, but never the words that decide who someone is. A hello dropped
 * that way would leave the browser with no record on the server at all and every state it sent
 * afterwards would be dropped too -- invisible to everyone, with nothing in the log to say why.
 */
function onMessage(c, text, trimmed = false) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;
  if (trimmed && (msg.t === 'state' || msg.t === 'emote' || msg.t === 'ask')) return;
  if (msg.t === 'claim') {
    onClaim(c, msg);
    return;
  }
  if (msg.t === 'settle') {
    onSettle(c, msg);
    return;
  }
  if (msg.t === 'ping') {
    const ping = cleanPing(msg);
    if (ping) send(c, { t: 'pong', c: ping.c, s: clock.now() });
    return;
  }
  // With a join word set, nothing else is listened to until a browser has said who it is.
  if (WORD && !c.player) return;
  if (msg.t === 'hello') {
    const hello = cleanHello(msg);
    if (!hello) return;
    const first = !c.hello;
    c.hello = hello;
    if (msg.v === WIRE_VERSION) c.v = WIRE_VERSION;
    const key = roomKey(hello.planet, hello.zone);
    const move = rooms.set(c.id, key);
    if (first) {
      tellRoomAbout(key, c);
      const peers = roster(key, c.id);
      for (const peer of peers) c.known.add(peer.id);
      send(c, {
        t: 'welcome',
        id: c.id,
        v: WIRE_VERSION,
        ...clock.hand(),
        you: c.player ? { player: c.player, character: c.character } : undefined,
        ff: FRIENDLY_FIRE ? 1 : 0,
        peers,
      });
      console.log(`  ${c.id} ${who(c)} is on ${roomLabel(key)} (${rooms.members(key).size} there, ${clients.size} connected)`);
    } else if (move.from !== key) {
      // Travelled. Nobody is told anyone has left: the world they came from already holds them, and a
      // browser that is told a peer has gone takes that peer apart. It is handed their new hello
      // instead, which says they are on another planet, and it simply stops drawing them -- which is
      // what it did when every message went to everybody. What is saved is the stranger: a browser is
      // never told about someone it has not met while they are on another world, so it never fetches a
      // rig, dresses them or builds their ship for a player it cannot see.
      if (move.from) sendToRoom(move.from, { t: 'hello', id: c.id, hello }, c.id);
      tellRoomAbout(key, c);
      // The people where they have gone: their hellos may have changed while this browser was away,
      // since none of them reached it, so everyone here is handed over again with their last state.
      for (const peer of roster(key, c.id)) {
        tellAbout(c, peer);
        if (peer.state) send(c, { t: 'state', id: peer.id, ...peer.state });
      }
      console.log(`  ${c.id} ${who(c)} went to ${roomLabel(key)} (${rooms.members(key).size} there)`);
    } else {
      sendToRoom(key, { t: 'hello', id: c.id, hello }, c.id);
    }
  } else if (msg.t === 'state') {
    if (!c.hello) return;
    const state = cleanState(msg);
    if (!state) return;
    c.state = state;
    sendToRoom(rooms.keyOf(c.id), { t: 'state', id: c.id, ...state }, c.id, true);
  } else if (msg.t === 'emote') {
    if (!c.hello) return;
    const clip = cleanEmote(msg);
    if (clip === undefined) return;
    // Never dropped, unlike a state: an empty clip is how a dance or a sit ends, and there is no
    // later message to put it right -- a peer that missed it would dance for ever.
    sendToRoom(rooms.keyOf(c.id), { t: 'emote', id: c.id, clip }, c.id);
  } else if (msg.t === 'ask') {
    // The one directed message: it goes to the player named and to nobody else. A word for a player
    // who is not here, who has not said who they are yet, or who is on another world is simply
    // dropped -- the asker's own timeout is what tells them nothing came back.
    if (!c.hello) return;
    const ask = cleanAsk(msg);
    if (!ask) return;
    const to = clients.get(ask.to);
    if (!to || to === c || !to.hello) return;
    if (rooms.keyOf(to.id) !== rooms.keyOf(c.id)) return;
    send(to, { t: 'ask', id: c.id, word: ask.word });
  }
}

/** Everyone on one world who has said who they are, as the welcome and a travel hand them over. */
function roster(key, except) {
  const out = [];
  for (const id of rooms.members(key)) {
    if (id === except) continue;
    const o = clients.get(id);
    if (o?.hello) out.push({ id: o.id, hello: o.hello, state: o.state });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The socket

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    `${JSON.stringify(
      {
        swg3js: 'server',
        v: WIRE_VERSION,
        connected: clients.size,
        rooms: rooms.describe(),
        clock: clock.describe(),
        world: store.describe(),
        joinWord: WORD ? 'set' : 'none',
        friendlyFire: FRIENDLY_FIRE,
        // What each browser is behind by. There is nothing else that shows a line falling behind:
        // `queued` is what is waiting to go out and `dropped` is how much news has been trimmed
        // since it connected.
        backlog: [...clients.values()].map((c) => ({ id: c.id, who: c.hello?.name ?? '', queued: c.socket.writableLength, dropped: c.dropped, knows: c.known.size })),
        tuning: TUNING,
        caps: WIRE,
      },
      null,
      1,
    )}\n`,
  );
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(String(req.headers.upgrade))) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c = {
    id: nextId++,
    socket,
    buffer: Buffer.alloc(0),
    partial: Buffer.alloc(0),
    hello: null,
    state: null,
    v: 1,
    nonce: makeNonce(),
    player: null,
    character: null,
    asking: null,
    heard: Date.now(),
    dropped: 0,
    /** Every peer this browser has been told about and not been told has gone (see `tellAbout`). */
    known: new Set(),
    window: { at: Date.now(), messages: 0, bytes: 0, warned: false },
  };
  clients.set(c.id, c);
  console.log(`+ ${c.id} connected from ${socket.remoteAddress} (${clients.size} connected)`);
  // The hail goes out before the browser has said anything at all. A browser built before this has
  // no case for it and drops it without a word, which is exactly what is wanted: the welcome stays
  // where it has always been, sent once after the first hello, so nothing an old browser does runs
  // twice. A browser built for this that hears no hail knows it is talking to the old relay.
  send(c, { t: 'hail', v: WIRE_VERSION, ...clock.hand(), nonce: c.nonce, word: WORD ? 1 : 0, ff: FRIENDLY_FIRE ? 1 : 0 });
  if (WORD) {
    const grace = setTimeout(() => {
      if (!c.player && clients.has(c.id)) deny(c, 'this server has a join word and none was given');
    }, TUNING['claim.grace']);
    if (typeof grace.unref === 'function') grace.unref();
  }
  socket.on('data', (chunk) => {
    c.heard = Date.now();
    // What one browser may send in a second: past it the rest of the second is dropped, and well
    // past it the line is closed, so one browser cannot fill this server's memory.
    const now = Date.now();
    if (now - c.window.at >= 1000) c.window = { at: now, messages: 0, bytes: 0, warned: false };
    c.window.bytes += chunk.length;
    c.buffer = Buffer.concat([c.buffer, chunk]);
    if (c.buffer.length > 1 << 20) {
      socket.destroy();
      return;
    }
    const messages = parseFrames(c);
    c.window.messages += messages.length;
    const factor = TUNING['rate.closeFactor'];
    if (c.window.messages > TUNING['rate.messages'] * factor || c.window.bytes > TUNING['rate.bytes'] * factor) {
      console.log(`  ${c.id} ${who(c)} sent far more than it should have (${c.window.messages} messages, ${c.window.bytes} bytes in a second) and has been closed`);
      socket.destroy();
      return;
    }
    const over = c.window.messages > TUNING['rate.messages'] || c.window.bytes > TUNING['rate.bytes'];
    if (over && !c.window.warned) {
      console.log(`  ${c.id} ${who(c)} is sending faster than it may (${c.window.messages} messages, ${c.window.bytes} bytes this second): the news in the rest of this second is dropped`);
      c.window.warned = true;
    }
    for (const m of messages) {
      if (m.close) {
        socket.end();
        break;
      }
      onMessage(c, m.text, over);
    }
  });
  const gone = () => {
    if (!clients.has(c.id)) return;
    clients.delete(c.id);
    const key = rooms.leave(c.id);
    sessions.release(c.id);
    console.log(`- ${c.id} ${who(c)} left${key ? ` ${roomLabel(key)}` : ''} (${clients.size} connected)`);
    // Everyone who was ever told about this browser is told it has gone, wherever they are standing
    // now: a browser holds on to a peer it has met while that peer is on another world, so the news
    // has to reach further than the room. This is the only message that takes a peer apart.
    for (const other of clients.values()) {
      if (!other.known.delete(c.id)) continue;
      send(other, { t: 'leave', id: c.id });
    }
  };
  socket.on('close', gone);
  socket.on('error', gone);
  socket.on('end', gone);
});

// A ping every twenty seconds keeps idle connections alive through proxies. A browser that has
// answered nothing at all -- not even a pong, which its network stack sends without waking the page
// -- for a minute is gone whatever the socket says, and is closed rather than left in the table.
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) {
    if (c.socket.destroyed) continue;
    if (now - c.heard > TUNING['watch.silence']) {
      console.log(`  ${c.id} ${who(c)} has said nothing for ${Math.round((now - c.heard) / 1000)} s and has been closed`);
      c.socket.destroy();
      continue;
    }
    c.socket.write(Buffer.from([0x89, 0]));
  }
}, TUNING['watch.ping']);

let closing = false;
const shutDown = (why) => {
  if (closing) return;
  closing = true;
  console.log(`\nthe server is stopping (${why})`);
  store.close();
  console.log(`  the world is written: ${store.describe()}`);
  for (const c of clients.values()) c.socket.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), TUNING['shutdown.wait']).unref();
};
process.on('SIGINT', () => shutDown('interrupted'));
process.on('SIGTERM', () => shutDown('asked to stop'));

server.listen(PORT, () => {
  console.log(`swg3js server listening on ws://0.0.0.0:${PORT}`);
  console.log(`  ${clock.describe()}`);
  console.log(`  the world is kept in ${DATA}: ${store.describe()}`);
  console.log(`  ${WORD ? 'a join word is set: a browser must carry it in its address, and one that cannot is turned away' : 'no join word: anyone who can reach this port can join (--word=<something> sets one)'}`);
  console.log(`  damage between players is ${FRIENDLY_FIRE ? 'on' : 'off (--friendly-fire turns it on)'}`);
  console.log(`  a browser built before this one plays as it always has; http://localhost:${PORT}/ says what is going on`);
});
