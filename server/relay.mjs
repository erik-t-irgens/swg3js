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
//   { t: 'state', p: [x, y, z], h, s, v, m, sab, q?, veh? | in? }   position, heading, rig state, speed, mounted, saber lit,
//                                                          the whole turn as a quaternion (aboard, adrift), the vehicle
//                                                          ridden { id, p, q, role: ride|pilot|aboard, pose, w, landed, dock }
//                                                          (vehicleWire.mjs); or, standing in a hull somebody else flies,
//                                                          in { ship, p, h } -- whose hull and where in that hull's own
//                                                          frame, which takes the place of veh so that a watcher draws
//                                                          one hull with people in it and not one hull per person;
//                                                          j: 1 while in a hyperspace jump
//   { t: 'emote', clip }
//   { t: 'ask', to, word: dock|allow|refuse|undock }         the one message meant for a single other player: asking
//                                                          their pilot for room on their hull, and the answer
//   { t: 'group', do: invite|accept|decline|leave|kick|promote|disband|trip|travel, to?, who?, where? }
//                                                          a fireteam (groups.mjs): who to ask is the connection id
//                                                          the browser already knows them by, who to put out or hand
//                                                          the group to is the member id the roster gives, and a trip
//                                                          is the world the leader is going to
//   { t: 'chat', scope: say|group, text }                    a line, to everyone on this world or to the group
//   { t: 'cross', phase: going|here, planet, zone, how, at? }  travelling together (crossWire.mjs): the world this
//                                                          player is crossing to, and where they came out when they
//                                                          are there. It goes to their group and only to their
//                                                          group, members on other worlds included: it is what
//                                                          lets somebody who takes the leader's trip up arrive
//                                                          beside them rather than at their own world's spawn
//   { t: 'shot', n, p, d, s, l, c, z, g?, a?, b?, fx?, rc?, hx?, pk?, in? }
//                                                          a bolt that left this player's gun (combatWire.mjs): its
//                                                          own number, where it left and which way, how fast, how
//                                                          long it lives, its colour and size, the fall on it, what
//                                                          it would take and the walls it may still glance off, the
//                                                          game's own projectile effect it is drawn as, and whose
//                                                          hull's rooms it is flying inside. Every other browser
//                                                          flies a copy that hurts nothing
//   { t: 'end', n, at }                                     that shot stopped here: the copies are cut short at the
//                                                          same point, so the mark is in one place on every screen
//   { t: 'hit', to, a, at, w? }                             the shooter says it struck that player for that much
//   { t: 'blocked', of, n, at }                             a lit blade turned that shot away here
//   { t: 'health', hp, d? }                                 how much of this player is left, and whether they are down
//   { t: 'died', by? }                                      the one who fell says so, and who struck the blow
//   { t: 'duel', do: ask|accept|decline|end, to? }           the game's own COMBAT_DUEL and COMBAT_PEACE, at its own
//                                                          128 m: how two players agree to fight where the server's
//                                                          switch for it is off
//   { t: 'spawn', do: add|remove|clear|dead, species?, at?, h?, seed?, id?, inside? }
//                                                          the world's creatures (ownership.mjs). Nothing appears on
//                                                          its own: an admin stands one by hand and what they stand
//                                                          is the world's. `add`, `remove` and `clear` are the
//                                                          admin's alone; `dead` is the word of whichever browser
//                                                          was keeping that creature, and a death happens once
//   { t: 'keep', do: 'awake', a }                            this browser has been put to sleep, or woken: asleep it
//                                                          keeps nothing, and the server picks again at once
//   { t: 'npcState', r: [{ i, p, h, s, v, hp, f? }] }        where the creatures this browser keeps have got to, four
//                                                          times a second (npcWire.mjs); rows for anything it was not
//                                                          granted are dropped rather than passed on
//   { t: 'npcHit', i, a, at, w?, b? }                        a blow struck against a creature somebody else keeps: it
//                                                          goes to that keeper alone, who decides what it does
//   { t: 'npcDrop', i }                                      this browser cannot keep that one (no body, no species):
//                                                          the grant goes back and it is not offered again for a while
//   { t: 'items', do: list|get|add|drop|using, rows?, kind?, what?, id?, worn?, held? }
//                                                          what this character owns (ledger.mjs). `list` is the
//                                                          backpack handed up on a first claim; after that the
//                                                          server's list is the truth and this is answered with it.
//                                                          `add` and `drop` are the game's own changes (the starting
//                                                          kit, the give tab, destroying something), and `using` says
//                                                          what is on the body and in the hands, which may not be
//                                                          put up in a trade
//   { t: 'trade', do: ask|accept|decline|offer|ready|unready|cancel, to?, rows? }
//                                                          handing something over at the game's own 8 m: who to ask
//                                                          is the connection id the browser already knows them by,
//                                                          an offer is the whole of this side's pane by row id, and
//                                                          the swap happens when both sides have said they are happy
//   { t: 'claimSpot', do: take|free, kind: dock|carrier, what }
//                                                          a place two players can both want (spots.mjs): a station's
//                                                          dock lane, or the spot on a hull that one ship rides
//                                                          another on. The server's answer is the only thing that
//                                                          makes a claim real, and a line that closes gives back
//                                                          everything it held
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
//   { t: 'group', do: 'roster', id, leader, you, members: [{ m, s, name, planet, zone, hp, leader, here }] }
//   { t: 'group', do: 'news', what: joined|left|kicked|away|back|leader|disbanded|declined|lapsed|
//                                    gone|withdrawn, who, name }   (withdrawn: an invitation you sent
//                                    is void because the one you asked has gone)
//   { t: 'group', do: 'health', who, hp }   (one member's health moved; the roster carries it too, and
//                                            this is the line sent when nothing else changed)
//   { t: 'group', do: 'invited', from, name, until }   { t: 'group', do: 'sent', to, name, until }
//   { t: 'group', do: 'trip', from, name, where, until }   { t: 'group', do: 'travelling', who, name, where }
//   { t: 'group', do: 'none', why }   (you are in no group now)   { t: 'group', do: 'gone' }   (the invitation has)
//   { t: 'group', do: 'refused', why }   (to whoever asked, and to nobody else)
//   { t: 'chat', id, from, scope, text }
//   { t: 'cross', id, from, phase, planet, zone, how, at? }   (to the sender's group, and to nobody else)
//   { t: 'shot', id, ... }   { t: 'end', id, n, at }   { t: 'blocked', id, of, n, at }
//   { t: 'health', id, hp, d? }   { t: 'died', id, by? }
//   { t: 'hurt', id, a, at, w? }   (to the one hurt and to nobody else, and only where they may be hurt)
//   { t: 'duel', do: asked|sent|on|off|declined|refused, id?, why? }
//   { t: 'spawn', do: 'list', world, rows: [{ id, world, species, at, h, seed, inside?, hp? }] }   (what stands on
//                                                          this world, sent on arriving and again when it is cleared)
//   { t: 'spawn', do: 'add', row }   { t: 'spawn', do: 'gone', id, why: dead|removed }
//   { t: 'spawn', do: 'refused', why }   (to whoever asked, and to nobody else)
//   { t: 'keep', add: [id], drop: [id] }   (who thinks for which creature: the server's answer is the only one,
//                                           and a browser never thinks for one it was not granted)
//   { t: 'npcState', id?, r: [...] }   (a keeper's batch passed on to the rest of that world; with no `id` it is the
//                                       picture a browser is handed on arriving, of where everything was last seen)
//   { t: 'npcHurt', id, i, a, at, w?, b? }   (a blow, to the browser keeping that creature and to nobody else)
//   { t: 'items', do: 'list', take: browser|server, rows: [{ id, kind, what, got }] }   (the settled list, sent back
//                                                          in answer to a list or a get: the first one a character
//                                                          hands up is written down, and after that this is the truth)
//   { t: 'items', do: 'added', row }   { t: 'items', do: 'gone', id }   { t: 'items', do: 'refused', why }
//   { t: 'trade', do: 'asked', id, from, name, until }   { t: 'trade', do: 'sent', id, to, name, until }
//   { t: 'trade', do: 'state', id, with, name, yours: { rows, ready }, theirs: { rows, ready } }
//                                                          (the whole trade from each side's own end, so neither
//                                                           browser has to work out what the other is looking at)
//   { t: 'trade', do: 'done', with, gave, got }   { t: 'trade', do: 'off', why }   { t: 'trade', do: 'refused', why }
//   { t: 'spot', kind, what, granted, why? }   (to whoever asked, and to nobody else)
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
import { Sessions, adminFor, checkClaim, firstRegistered, isAdmin, makeNonce, summaryOf } from './identity.mjs';
import { OWN_TUNING, Ownership, cleanKeep, cleanSpawn, maySpawn } from './ownership.mjs';
import { GROUP_RANGES, GROUP_TUNING, Groups, cleanChat, cleanGroup } from './groups.mjs';
import { cleanCross, mayCross } from './crossWire.mjs';
import { COMBAT_WIRE, Duels, cleanBlocked, cleanDied, cleanDuel, cleanEnd, cleanHealth, cleanHit, cleanShot, mayHurt } from './combatWire.mjs';
import { NpcPlaces, cleanNpcBatch, cleanNpcDrop, cleanNpcHit } from './npcWire.mjs';
import { LEDGER_TUNING, Ledger, cleanItems, cleanTrade, mayItems } from './ledger.mjs';
import { SPOT_TUNING, Spots, cleanSpot, mayClaim } from './spots.mjs';

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
  --admin=<player id> who may stand creatures in the world (default: the first player this world met)
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
  else if (name.startsWith('group.') && has(GROUP_TUNING, name.slice(6))) GROUP_TUNING[name.slice(6)] = value;
  else if (name.startsWith('combat.') && has(COMBAT_WIRE, name.slice(7))) COMBAT_WIRE[name.slice(7)] = value;
  else if (name.startsWith('own.') && has(OWN_TUNING, name.slice(4))) OWN_TUNING[name.slice(4)] = value;
  else if (name.startsWith('item.') && has(LEDGER_TUNING, name.slice(5))) LEDGER_TUNING[name.slice(5)] = value;
  else if (name.startsWith('spot.') && has(SPOT_TUNING, name.slice(5))) SPOT_TUNING[name.slice(5)] = value;
  else console.log(`  --set ${name}: there is no such number, and it has been ignored`);
}

const bare = args.find((a) => /^\d+$/.test(a));
const PORT = Number(option('port', bare ?? process.env.PORT ?? '8787'));
const WORD = option('word', process.env.SWG_WORD ?? '');
// Beside this file, not beside whatever folder the server happened to be started from: a world kept
// in the wrong place looks exactly like every player having disappeared.
const DATA = option('data', join(import.meta.dirname, 'data'));
// Who may stand creatures in the world. Named here it stands for this run whatever is written down;
// with none given the world's own answer is used, and a world that has met nobody yet makes the first
// player it registers its admin (see below), which is the person who started the server and joined it.
const ADMIN = option('admin', process.env.SWG_ADMIN ?? '');
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
// The groups are keyed by character, not by connection, which is what lets someone reload their
// browser without their friends losing them: the line closes, their place is held, and the new line
// claiming the same character picks it up again. They are not written to disk -- a group is a thing
// people are doing together this evening, not a thing the world remembers.
const groups = new Groups({ tuning: GROUP_TUNING });
// Who has agreed to fight whom. With the server's own switch off -- which is how it starts -- this
// is the only way one player's shot may take another player's health, and it is the game's own word
// at the game's own distance, so the range comes from the table the groups already read. Like a
// group, a duel is a thing two people are doing this minute: it is held by connection and nothing
// of it is written to disk.
const duels = new Duels({ range: GROUP_RANGES.duel, seconds: COMBAT_WIRE.duel });
// The world's creatures: what an admin has stood by hand, and which browser is thinking for each of
// them this half-second (ownership.mjs). Nothing appears on its own -- the planet's automatic
// wildlife is off -- so this list is empty until somebody stands something in it. It is not written
// to disk: what stands in the world is a thing people are doing this evening, like a group.
const ownership = new Ownership({ tuning: OWN_TUNING });
// Where each of the world's creatures was last said to be, so a browser arriving on a world is told
// where things are standing rather than waiting a quarter of a second for the first batch. It is a
// picture and nothing else: what exists and whether it is alive is the spawn list's above.
const npcPlaces = new NpcPlaces();
// What every connected character owns, and the trades that move a row from one to another
// (ledger.mjs). Unlike the groups and the creatures this *is* written to disk: it is the one thing
// here the world remembers, and the reason a character no longer lives or dies with one browser's
// local storage. Every change goes out through the store, so the log has it before anybody is told.
const ledger = new Ledger({ tuning: LEDGER_TUNING, write: (rec) => store.change(rec) });
ledger.load(store.data);
// The places two people can both want: a station's dock lane, and the spot on a hull that one ship
// rides another on (spots.mjs). Held by connection and never written down -- a claim means "a ship is
// flying at this right now", which nothing about a restart can still be true of.
const spots = new Spots({ tuning: SPOT_TUNING });
const settings = { friendlyFire: FRIENDLY_FIRE, word: WORD ? 1 : 0, dayMs: DAY };
const had = store.data.settings ?? {};
if (had.friendlyFire !== settings.friendlyFire || had.word !== settings.word || had.dayMs !== settings.dayMs) store.change({ t: 'settings', settings });
// A world played in before there was an admin at all takes the first player it ever registered, so
// nobody has to name themselves on a command line to be the admin of their own world. A name given
// on the command line stands for the run and is not written down: it is a switch, not the truth.
if (!ADMIN && !adminFor(store.data)) {
  const first = firstRegistered(store.data);
  if (first) store.change({ t: 'settings', settings: { admin: first } });
}

/** Whether this browser is the world's admin: the server's answer, asked fresh each time. */
function admins(c) {
  return isAdmin(store.data, c.player, ADMIN);
}

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

/**
 * Send out what a group decided. The rules in `groups.mjs` know members by a key that outlives a
 * connection, so this is where a key becomes a socket again; a member whose line is closed is simply
 * not written to, and what they missed is in the roster they are sent when they come back.
 */
function deliver(result) {
  const tell = result?.tell;
  if (!tell?.length) return;
  for (const line of tell) {
    for (const key of line.to) {
      const session = groups.sessionOf(key);
      if (session) send(clients.get(session), line.msg);
    }
  }
}

/**
 * The same for words that name a connection rather than a member of a group: the duels. A duel dies
 * with the line either side of it is on, so there is no key here that outlives one and nothing to
 * look up -- an id that has gone is simply not written to.
 */
function deliverTo(result) {
  const tell = result?.tell;
  if (!tell?.length) return;
  for (const line of tell) send(clients.get(line.to), line.msg);
}

/**
 * How far apart two players are, for the invitation's own range. Infinity when either has not moved
 * yet or they are on different worlds, which is the honest answer: the client's table gives an
 * invitation 90 m and 90 m only reaches across one world.
 *
 * A player aboard a ship's rooms sends their place in that hull's frame rather than the world's, so
 * this measures an invitation between someone inside a hull and someone standing outside it against
 * the wrong origin. Both aboard the same hull is right, both outside is right, and the mixed case
 * is left alone until a friend's hull is a place you can stand in.
 */
function metresBetween(a, b) {
  if (!a?.state?.p || !b?.state?.p) return Infinity;
  if (rooms.keyOf(a.id) !== rooms.keyOf(b.id)) return Infinity;
  return Math.hypot(a.state.p[0] - b.state.p[0], a.state.p[1] - b.state.p[1], a.state.p[2] - b.state.p[2]);
}

/**
 * The nearest player on this world who answers to a name, for an invitation typed as a line rather
 * than picked off a list. Two players can share a name, so the nearest is the one meant; somebody on
 * another world is not considered at all, since an invitation could not reach them anyway.
 */
function nearestNamed(c, name) {
  if (!name) return null;
  const want = name.toLowerCase();
  let best = null;
  let nearest = Infinity;
  for (const id of rooms.members(rooms.keyOf(c.id))) {
    const other = clients.get(id);
    if (!other || other === c || other.hello?.name?.toLowerCase() !== want) continue;
    const how = metresBetween(c, other);
    // The first one found stands even when there is no telling how far off they are, so that asking
    // them is refused for being too far away rather than for there being nobody of that name.
    if (best && how >= nearest) continue;
    nearest = how;
    best = other;
  }
  return best;
}

/**
 * The name a group knows a browser by: its character when it has said which one it is playing, and
 * its connection otherwise. The character is what survives a reload; a browser that never says who
 * it is (an older one, or a server with no join word set) is known by its line and loses its group
 * when that line closes, which is the behaviour it would have had anyway.
 */
function memberKeyOf(c) {
  return c.character ? `c:${c.character}` : `s:${c.id}`;
}

/**
 * Whether this line is still the one holding its member. The same character opened in a second
 * browser moves the member across at once and the older line is closed a moment later; inside that
 * moment a word from the dying line would be taken as the member's -- a `leave` would put the new
 * browser out of the group, and a chat line would go out under the old line's name.
 */
function holdsMember(c) {
  return groups.sessionOf(c.member) === c.id;
}

/**
 * Tell the groups where a browser is and what it is called, on the way in and after a travel.
 * `moved` says the world changed under it, which throws the last place away: a position is in the
 * world it was sent from, so an invitation's distance and the place a newcomer is handed would both
 * be measured against a world this browser has left until its first state on the new one arrives.
 */
function markPresent(c, moved = false) {
  const key = memberKeyOf(c);
  if (moved) c.state = null;
  const about = { session: c.id, name: c.hello?.name ?? c.claimed ?? '', planet: c.hello?.planet ?? '', zone: c.hello?.zone ?? '' };
  if (c.member === key) deliver(groups.place(key, about));
  else {
    c.member = key;
    deliver(groups.present(key, about));
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
    // The first player a world ever meets is its admin, and that is written down beside the rest of
    // the truth: it is the person who started the server and joined it, and they should not have to
    // name themselves on a command line to be able to stand anything in their own world. With
    // `--admin=` given, nothing is written down at all -- the same guard the startup block wears,
    // and for the same reason: the name on the command line is a switch for this run, and writing
    // somebody else down while it is set would hand the world to them at the next start with no flag.
    if (!ADMIN && !adminFor(store.data)) {
      store.change({ t: 'settings', settings: { admin: verdict.player } });
      console.log(`  ${verdict.player} is the first player this world has met and is its admin`);
    }
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
  // Whether this player is the one who may stand creatures in the world goes out with the answer to
  // their claim, which is the first thing the server says that knows who they are; a browser built
  // before this has no field for it and reads nothing, and one with no server is never an admin.
  send(c, { t: 'claimed', you: { player: verdict.player, character: verdict.character, name: claim.name, admin: admins(c) ? 1 : 0 }, keep: verdict.keep });
  console.log(`  ${c.id} is player ${verdict.player} playing ${claim.name}${admins(c) ? ' (the admin of this world)' : ''}`);
  // Now that there is a name for this browser that outlives its line, the groups can have it: if
  // this character's place in a group is still being held -- a reload, a line that dropped -- it is
  // picked up here and everyone is told they are back, before a word about where they are.
  c.claimed = claim.name;
  markPresent(c);
  // And the ledger has it too, which is what lets a trade name a character rather than a line: the
  // same character opened in a second browser is the newer one's from this instant, and whatever
  // trade the older line had open is broken off with the items where they started.
  deliverTo(ledger.here(c.character, { session: c.id, name: claim.name }));
  const back = groups.groupOf(c.member);
  if (back) console.log(`  ${c.id} "${claim.name}" is in ${back.id} again (${back.members.size} in it)`);
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
  // Chat is dropped with the news when a browser is past its allowance for the second: it has a far
  // tighter limit of its own already, so anything arriving here in that state is a browser shouting.
  // What a group is asked for is not: those are rare, they are decisions rather than news, and one
  // lost would leave the two sides disagreeing about who is in.
  // A shot goes with the news for the same reason: one nobody sees is a picture missing. Where that
  // shot stopped does not: it is the word that puts the mark in the same place on every screen, and
  // a copy that never hears it flies its whole life out and bursts wherever this browser's own
  // streamed world happened to stop it -- which is the one thing this is all for. A hit, a block, a
  // health and a death are decisions too, and leave the two sides disagreeing for good if lost.
  if (trimmed && (msg.t === 'state' || msg.t === 'emote' || msg.t === 'ask' || msg.t === 'chat' || msg.t === 'shot')) return;
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
    // A group's roster says what world each member is on, so it is told here and nowhere else; this
    // is also where a browser that never claims a character becomes someone a group can hold.
    markPresent(c, !first && move.from !== key);
    // The world's creatures. Which browser thinks for which of them is worked out from where
    // everybody is standing, so the world a browser is on is told here; and a browser arriving on one
    // is handed the list of what stands there, which is how everyone sees the same creatures whoever
    // stood them. A browser that has only just arrived has not said where it is standing on that
    // world yet, so it is nowhere until its first state and keeps nothing meanwhile.
    ownership.here(c.id, key, null);
    // A dock, or the spot on a hull one ship rides another on, is a place in one world: whatever this
    // browser was holding where it came from is given back as it leaves, or a lane it is no longer
    // anywhere near would stay shut behind it for the rest of the evening.
    if (move.from && move.from !== key) spots.left(c.id, move.from);
    if (first || move.from !== key) send(c, { t: 'spawn', do: 'list', world: key, rows: ownership.listFor(key) });
    // ...and where those creatures have got to, so they are stood where they really are rather than
    // at the spot they were first put down and then walked across the world by the first batches.
    if (first || move.from !== key) {
      const where = npcPlaces.rows(key);
      if (where.length) send(c, { t: 'npcState', r: where });
    }
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
    const state = cleanState(msg, c.id);
    if (!state) return;
    c.state = state;
    // Where this browser is standing is also what decides which creatures it keeps, and a state
    // arriving is what says it is still awake: a tab that has stopped drawing has stopped sending,
    // and the silence in ownership.mjs is what takes its creatures off it.
    ownership.here(c.id, rooms.keyOf(c.id), state.p);
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
  } else if (msg.t === 'group') {
    // Everything a fireteam is: the rules are in groups.mjs, which knows nothing about sockets, and
    // all that happens here is that the browser asking is named, the one it names is looked up, and
    // whatever the rules decided is sent out. Nothing is answered with an error the browser could
    // read as something happening: a refusal is its own message and goes only to whoever asked.
    if (!c.hello || !c.member || !holdsMember(c)) return;
    const g = cleanGroup(msg, GROUP_TUNING);
    if (!g) return;
    // A decision is never thrown away for being behind, so this is the one thing standing between a
    // key held down and the server writing a roster to all eight as fast as it can read.
    if (!groups.mayAsk(c.member)) return;
    if (g.do === 'invite') {
      const to = (g.to ? clients.get(g.to) : null) ?? nearestNamed(c, g.name);
      // The distance is measured here because this is the only place that knows where two people
      // are standing; the rule it is held to -- the client's own 90 m -- is in groups.mjs.
      deliver(groups.invite(c.member, to?.member ?? '', metresBetween(c, to)));
    } else if (g.do === 'accept') deliver(groups.accept(c.member));
    else if (g.do === 'decline') deliver(groups.decline(c.member));
    else if (g.do === 'leave') deliver(groups.leave(c.member));
    else if (g.do === 'kick') deliver(groups.kick(c.member, g.who));
    else if (g.do === 'promote') deliver(groups.promote(c.member, g.who));
    else if (g.do === 'disband') deliver(groups.disband(c.member));
    else if (g.do === 'trip') deliver(groups.trip(c.member, g.where));
    else if (g.do === 'travel') deliver(groups.travel(c.member));
  } else if (msg.t === 'cross') {
    // Travelling together. A group's offer carries the world its leader is going to, which is
    // enough to send everybody to the same planet and not enough to put them beside each other
    // when they arrive: where a player actually came out is known only to their own browser, and a
    // member on another world is sent nothing that would say, since a state goes to the world its
    // player is on and no further. So this word goes to the group and only to the group -- to
    // people on other planets included, which is the whole point of it.
    if (!c.hello || !c.member || !holdsMember(c)) return;
    const cross = cleanCross(msg);
    if (!cross) return;
    // Twice a crossing is all anybody needs, and a crossing takes seconds. The allowance is this
    // word's own rather than the group's for decisions: sharing that one, a member who crossed in
    // the same second as an invitation or a promotion could have the word saying where they came
    // out dropped without a sound, and the group would then scatter with nothing to say why. The
    // record is made the first time this browser crosses and written in place after that.
    c.crossing ??= { at: 0, lines: 0 };
    if (!mayCross(c.crossing, Date.now())) return;
    const to = groups.chatTo(c.member);
    if (!to) return;
    const line = { t: 'cross', id: c.id, from: c.hello.name, ...cross };
    for (const key of to) {
      const session = groups.sessionOf(key);
      if (session && session !== c.id) send(clients.get(session), line);
    }
  } else if (msg.t === 'chat') {
    // A line, and only ever a line: it is cut to length, stripped of anything that is not text and
    // sent on as text. Whatever shows it escapes it; nothing here ever reads it.
    if (!c.hello || !c.member || !holdsMember(c)) return;
    const chat = cleanChat(msg, GROUP_TUNING);
    if (!chat) return;
    if (!groups.mayChat(c.member)) return;
    const line = { t: 'chat', id: c.id, from: c.hello.name, scope: chat.scope, text: chat.text };
    // The speaker is sent their own line back rather than showing it themselves, so what everyone
    // reads is the same text in the same order, whatever the server made of it.
    if (chat.scope === 'group') {
      const to = groups.chatTo(c.member);
      if (!to) {
        send(c, { t: 'group', do: 'refused', why: 'you are not in a group' });
        return;
      }
      for (const key of to) {
        const session = groups.sessionOf(key);
        if (session) send(clients.get(session), line);
      }
    } else {
      sendToRoom(rooms.keyOf(c.id), line);
    }
  } else if (msg.t === 'shot') {
    // A bolt that left somebody's gun. It goes to the world they are on and no further, and every
    // browser there flies a copy of it that hurts nothing: the one that fired it is the only one
    // whose bolt is real, so nothing can be hurt twice by one shot.
    if (!c.hello) return;
    const shot = cleanShot(msg);
    if (!shot) return;
    sendToRoom(rooms.keyOf(c.id), { t: 'shot', id: c.id, ...shot }, c.id, true);
  } else if (msg.t === 'end') {
    // Where that bolt stopped. Each browser traces its own streamed world, so a copy cannot be
    // relied on to stop in the same place: this is what puts the mark and the burst in one place on
    // every screen rather than in a place each browser guessed for itself.
    if (!c.hello) return;
    const end = cleanEnd(msg);
    if (!end) return;
    // Never dropped, however far behind a browser is: it is a few dozen bytes once per shot, and it
    // is a decision rather than news. A shot that is dropped is a picture missing; an end that is
    // dropped leaves that picture flying on and bursting somewhere nobody else saw.
    sendToRoom(rooms.keyOf(c.id), { t: 'end', id: c.id, ...end }, c.id);
  } else if (msg.t === 'hit') {
    // The shooter says it struck somebody. The server checks the one named is here, is on this same
    // world and may be hurt at all; it does not check the shot, because it does not fly bolts. The
    // one hurt is the only place a number is ever taken off, and their own health message is what
    // everyone else reads, so two browsers can never come to disagree about it.
    if (!c.hello) return;
    const hit = cleanHit(msg);
    if (!hit) return;
    const to = clients.get(hit.to);
    if (!to || to === c || !to.hello) return;
    if (rooms.keyOf(to.id) !== rooms.keyOf(c.id)) return;
    if (!mayHurt(FRIENDLY_FIRE, duels, c.id, to.id)) return;
    duels.touch(c.id, to.id);
    send(to, { t: 'hurt', id: c.id, a: hit.a, at: hit.at, ...(hit.w ? { w: hit.w } : {}) });
  } else if (msg.t === 'blocked') {
    // A lit blade turned a bolt away. It reaches the whole world including whoever fired, since
    // theirs is the one real bolt and it has to stop where the blade met it; whoever blocked it
    // announces a shot of their own, which crosses as any other shot does.
    if (!c.hello) return;
    const blocked = cleanBlocked(msg);
    if (!blocked) return;
    sendToRoom(rooms.keyOf(c.id), { t: 'blocked', id: c.id, ...blocked }, c.id);
  } else if (msg.t === 'health') {
    // How much of this player is left. It is sent when it changes and at no other time, and it is
    // also what fills the health bar on a group's roster, which until now had nothing to show.
    if (!c.hello) return;
    const health = cleanHealth(msg);
    if (!health) return;
    sendToRoom(rooms.keyOf(c.id), { t: 'health', id: c.id, ...health }, c.id);
    if (c.member && holdsMember(c)) deliver(groups.note(c.member, { hp: health.hp }));
  } else if (msg.t === 'died') {
    if (!c.hello) return;
    const died = cleanDied(msg);
    if (!died) return;
    sendToRoom(rooms.keyOf(c.id), { t: 'died', id: c.id, ...died }, c.id);
  } else if (msg.t === 'duel') {
    // The game's own words: asking for a duel and calling it off, at the client's own distance. It
    // is the way two players may hurt each other on a server whose switch for that is off.
    if (!c.hello) return;
    const duel = cleanDuel(msg);
    if (!duel) return;
    if (duel.do === 'ask') {
      const to = duel.to ? clients.get(duel.to) : null;
      if (!to || to === c || !to.hello) {
        deliverTo(duels.refuse(c.id, 'there is nobody there to fight'));
        return;
      }
      deliverTo(duels.ask(c.id, to.id, metresBetween(c, to)));
    } else if (duel.do === 'accept') deliverTo(duels.accept(c.id));
    else if (duel.do === 'decline') deliverTo(duels.decline(c.id));
    else if (duel.do === 'end') deliverTo(duels.end(c.id));
  } else if (msg.t === 'spawn') {
    // The world's creatures. Nothing appears on its own: an admin stands one by hand and what they
    // stand belongs to the world -- everyone on it is told, one browser thinks for it, and it is
    // handed between browsers as people walk about. The asking browser is told along with everyone
    // else rather than standing its own copy, so there is one path and not two.
    if (!c.hello) return;
    const ask = cleanSpawn(msg, OWN_TUNING);
    if (!ask) return;
    const world = rooms.keyOf(c.id);
    if (!world) return;
    if (ask.do === 'dead') {
      // A death is the word of whichever browser was keeping that creature, and of nobody else: it
      // is the one that was thinking for it. It is also the word of whoever was keeping it a moment
      // ago (`mayKill`, the grace in OWN_TUNING): a keeper drops one to nothing and says so in the
      // same breath, the grants go out twice a second, and the two cross -- without the grace a kill
      // that landed as the creature changed hands would simply be dropped and the creature stood
      // back up whole by whoever took it. A death happens once and stays, so a browser that takes
      // the creature over afterwards cannot stand it up again. It is not counted against the spawn
      // allowance below: a death is not a thing asked for, and a fight is not a key held down.
      if (!ownership.mayKill(c.id, ask.id)) return;
      const end = ownership.died(ask.id);
      if (!end.ok) return;
      deliverTo(end);
      sendToRoom(end.world, { t: 'spawn', do: 'gone', id: ask.id, why: 'dead' });
      // It is gone, so the picture of where things stand forgets it.
      npcPlaces.gone(end.world, ask.id);
      return;
    }
    // The allowance is counted before anything is decided about who is asking, and before a word
    // goes back: it is what stands between a key held down and a world filling up as fast as it can
    // be read, and a browser that is not the admin is exactly the one it has to hold. Counted after
    // the refusal, the browsers the cap exists for would be the only ones it never reached, each
    // junk word costing an outbound frame.
    c.spawning ??= { at: 0, lines: 0 };
    if (!maySpawn(c.spawning, Date.now(), OWN_TUNING)) return;
    if (!admins(c)) {
      send(c, { t: 'spawn', do: 'refused', why: 'only this world’s admin can stand creatures in it' });
      return;
    }
    if (ask.do === 'add') {
      // The seed is the server's when the browser named none: it is what each browser rolls the
      // creature's own numbers from, so it has to be the same one everywhere and it is decided once.
      const seed = ask.seed || (Math.random() * 0xffffffff) >>> 0;
      const made = ownership.spawn({ world, species: ask.species, at: ask.at, h: ask.h, seed, by: c.player ?? '', id: ask.id ?? '', inside: !!ask.inside });
      if (!made.ok) {
        send(c, { t: 'spawn', do: 'refused', why: made.why });
        return;
      }
      // The news first and the grant after it, so that the browser told to think for this creature
      // has already been told there is one: a grant naming something a browser has never heard of is
      // taken all the same, but only because nothing should ever rest on the order two messages
      // happen to arrive in.
      sendToRoom(world, { t: 'spawn', do: 'add', row: made.row });
      deliverTo(made);
      console.log(`  ${c.id} ${who(c)} stood ${made.row.species} on ${roomLabel(world)} as ${made.row.id}`);
    } else if (ask.do === 'remove') {
      const off = ownership.remove(ask.id);
      if (!off.ok) return;
      deliverTo(off);
      sendToRoom(off.world, { t: 'spawn', do: 'gone', id: ask.id, why: 'removed' });
      npcPlaces.gone(off.world, ask.id);
    } else if (ask.do === 'clear') {
      const cleared = ownership.clearWorld(world);
      deliverTo(cleared);
      // The whole list again rather than a word per creature: a browser reading a list takes down
      // whatever is not in it, so an empty one is exactly "nothing stands here now" in one message.
      sendToRoom(world, { t: 'spawn', do: 'list', world, rows: ownership.listFor(world) });
      // Everything that stood here has gone, so where it all stood goes with it.
      npcPlaces.forget(world);
      if (cleared.ids.length) console.log(`  ${c.id} ${who(c)} took down ${cleared.ids.length} on ${roomLabel(world)}`);
    }
  } else if (msg.t === 'npcState') {
    // A keeper's batch: where the creatures it is thinking for have got to. It goes to the world it
    // was sent from and no further, and only for the ones this browser really keeps -- the grant is
    // the server's answer and a browser never speaks for something it was not given. Dropped with
    // the news when a browser is behind: a lost batch is a quarter of a second of a creature's walk,
    // and the next one puts it right.
    if (!c.hello) return;
    const batch = cleanNpcBatch(msg);
    if (!batch) return;
    const world = rooms.keyOf(c.id);
    if (!world) return;
    const rows = batch.r.filter((r) => ownership.keeps(c.id, r.i) && ownership.worldOf(r.i) === world);
    if (!rows.length) return;
    npcPlaces.note(world, rows);
    // What is left of each of them, kept with the list rather than only in the last batch: the list
    // is what a browser arriving builds from, and a creature that has been fought must not be stood
    // up whole by whoever the grant lands on next.
    for (const r of rows) ownership.health(c.id, r.i, r.hp);
    sendToRoom(world, { t: 'npcState', id: c.id, r: rows }, c.id, true);
  } else if (msg.t === 'npcHit') {
    // A blow struck against a creature somebody else is thinking for. It is a claim addressed to
    // whoever keeps that creature: the server checks that it is real, that it is alive, that it is
    // on this world, and passes it on. The keeper applies it on its own copy and what comes back is
    // the health in its next batch or the word that the creature is gone, so two browsers can never
    // come to disagree about how hurt one is. Never dropped for being behind: a blow is a decision,
    // and one lost is a shot that hurt nothing.
    //
    // `b` is the whole of what crosses about who struck, and it is passed on exactly as it came.
    // The `id` on this message names the browser the blow was sent from, which is not the same thing
    // as the striker: with `b` the player at that browser struck it themselves and the keeper may
    // blame them, and without it the blow was a creature's, a fighter's or a turret's and there is
    // nobody the keeper can name. Blamed on the browser regardless, the keeper's creature and its
    // whole pack would turn on a player who never touched it.
    if (!c.hello) return;
    const hit = cleanNpcHit(msg);
    if (!hit) return;
    if (!ownership.alive(hit.i)) return;
    const world = ownership.worldOf(hit.i);
    if (!world || world !== rooms.keyOf(c.id)) return;
    const keeper = ownership.keeperOf(hit.i);
    if (!keeper || keeper === c.id) return;
    send(clients.get(keeper), { t: 'npcHurt', id: c.id, i: hit.i, a: hit.a, at: hit.at, ...(hit.w ? { w: hit.w } : {}), ...(hit.b ? { b: 1 } : {}) });
  } else if (msg.t === 'npcDrop') {
    // A browser saying it cannot keep one: it has no body for that creature and cannot build one
    // (its catalogue does not know the species), or its model has still not landed. Keeping a
    // creature means saying where it has got to, and a browser that cannot is invisible from here --
    // it is talking normally, so the silence rule never reaches it, and it is the nearest, so every
    // pass hands the creature straight back to it. Frozen on every screen, for the life of the
    // world. It asks for nothing, so nothing is answered: the grant goes back and that browser is
    // not offered this creature again for a while.
    if (!c.hello) return;
    const drop = cleanNpcDrop(msg);
    if (!drop) return;
    if (!ownership.worldOf(drop.i) || ownership.worldOf(drop.i) !== rooms.keyOf(c.id)) return;
    deliverTo(ownership.refuse(c.id, drop.i));
  } else if (msg.t === 'keep') {
    // The one thing a browser says about keeping: that it has been put to sleep, or woken. A sleeping
    // tab draws no frames and sends nothing at all, so it says so on its way out rather than being
    // found a minute later by the silence; what it was keeping goes to somebody who is awake.
    if (!c.hello) return;
    const word = cleanKeep(msg);
    if (!word) return;
    deliverTo(ownership.awake(c.id, word.a === 1));
  } else if (msg.t === 'items') {
    // What this character owns. It is the character's and not the line's, so a browser that has not
    // said which character it is playing has nothing here: with no claim the game is exactly what it
    // was, its backpack in its own local storage and the server never asked.
    if (!c.hello || !c.character) return;
    const ask = cleanItems(msg, LEDGER_TUNING);
    if (!ask) return;
    c.owning ??= { at: 0, lines: 0 };
    if (!mayItems(c.owning, Date.now(), LEDGER_TUNING['ask.perSecond'])) return;
    if (ask.do === 'get' && ledger.holds(c.character)) {
      // A browser asking for what it already has is not settling anything, so it must not break
      // that character's live trade off: the list is sent and nothing else happens.
      send(c, { t: 'items', do: 'list', take: 'server', rows: ledger.listFor(c.character) });
      return;
    }
    if (ask.do === 'list' || ask.do === 'get') {
      // The first list a character hands up is written down and is the list; every one after it is
      // answered with the server's, which is the whole of decision 7(a). A browser whose storage was
      // cleared sends `get` and is handed everything back. What the browser's own record claims
      // about itself goes with the list: an empty list from a browser that believes the server has
      // already taken this character down is a cache that was cleared, and is never written down.
      const settled = ledger.settle(c.character, ask.do === 'list' ? ask.rows : [], { known: ask.do === 'list' && ask.known === true, rev: ask.do === 'list' ? ask.rev : 0 });
      deliverTo(settled);
      send(c, { t: 'items', do: 'list', take: settled.take, rows: settled.rows });
      if (settled.take === 'browser') console.log(`  ${c.id} ${who(c)} handed up ${settled.rows.length} things, which this world now holds`);
      return;
    }
    if (ask.do === 'using') {
      ledger.using(c.character, ask.worn, ask.held);
      return;
    }
    if (ask.do === 'add') {
      const made = ledger.add(c.character, ask.kind, ask.what, ask.got);
      if (!made.ok) {
        send(c, { t: 'items', do: 'refused', why: made.why });
        return;
      }
      if (!made.already) send(c, { t: 'items', do: 'added', row: made.row });
      return;
    }
    const off = ledger.drop(c.character, ask.id);
    if (!off.ok) {
      send(c, { t: 'items', do: 'refused', why: off.why });
      return;
    }
    send(c, { t: 'items', do: 'gone', id: ask.id });
  } else if (msg.t === 'trade') {
    // Handing something over. The rules are in ledger.mjs, which knows nothing about sockets; all
    // that happens here is that the two players are named, how far apart they are standing is
    // measured -- this being the only place that knows -- and whatever the rules decided is sent out.
    if (!c.hello || !c.character) return;
    const step = cleanTrade(msg, LEDGER_TUNING);
    if (!step) return;
    c.owning ??= { at: 0, lines: 0 };
    if (!mayItems(c.owning, Date.now(), LEDGER_TUNING['ask.perSecond'])) return;
    if (step.do === 'ask') {
      const to = clients.get(step.to);
      if (!to || to === c || !to.hello || !to.character) return;
      deliverTo(ledger.ask(c.character, to.character, metresBetween(c, to)));
    } else if (step.do === 'accept') deliverTo(ledger.accept(c.character));
    else if (step.do === 'decline') deliverTo(ledger.decline(c.character));
    else if (step.do === 'offer') deliverTo(ledger.offer(c.character, step.rows));
    else if (step.do === 'unready') deliverTo(ledger.unready(c.character));
    else if (step.do === 'cancel') deliverTo(ledger.cancel(c.character));
    else if (step.do === 'ready') {
      // The game's own TRADE_ACCEPT, measured again on the press: two people who have walked apart
      // with the window open do not trade, and neither do two on different worlds.
      const trade = ledger.tradeOf(c.character);
      if (!trade) return;
      const other = trade.a === c.character ? trade.b : trade.a;
      deliverTo(ledger.ready(c.character, metresBetween(c, clients.get(ledger.sessionOf(other)))));
    }
  } else if (msg.t === 'claimSpot') {
    // A place two players can both want. Pass 1 built these as local claims and said so; this is the
    // server answer that makes one real. It is about a ship in the world this minute, so it is held
    // by the line and nothing of it is written down.
    if (!c.hello) return;
    const spot = cleanSpot(msg, SPOT_TUNING);
    if (!spot) return;
    const world = rooms.keyOf(c.id);
    if (!world) return;
    // Giving a place back is never rate-limited and never dropped: it is a map delete, it can only
    // ever make the world freer, and one dropped would leave a lane held by a browser that does not
    // believe it holds it -- shut until that line closes, with nothing on either side to say why.
    if (spot.do === 'free') {
      deliverTo(spots.free(c.id, world, spot.kind, spot.what));
      return;
    }
    c.claiming ??= { at: 0, lines: 0 };
    // Asking faster than a ship can need places is refused **in words**, never in silence: the
    // browser flies on its own answer until this comes back, so a question answered with nothing is
    // read as a grant when the wait runs out and the same lane is then handed to the next ship.
    if (!mayClaim(c.claiming, Date.now(), SPOT_TUNING)) {
      deliverTo(spots.tooFast(c.id, spot.kind, spot.what));
      return;
    }
    deliverTo(spots.take(c.id, world, spot.kind, spot.what));
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
        groups: groups.describe(),
        duels: duels.describe(),
        clock: clock.describe(),
        world: store.describe(),
        creatures: ownership.describe(),
        creaturePlaces: npcPlaces.describe(),
        items: ledger.describe(),
        spots: spots.describe(),
        joinWord: WORD ? 'set' : 'none',
        admin: adminFor(store.data, ADMIN) || 'nobody yet',
        friendlyFire: FRIENDLY_FIRE,
        // What each browser is behind by. There is nothing else that shows a line falling behind:
        // `queued` is what is waiting to go out and `dropped` is how much news has been trimmed
        // since it connected.
        backlog: [...clients.values()].map((c) => ({ id: c.id, who: c.hello?.name ?? '', queued: c.socket.writableLength, dropped: c.dropped, knows: c.known.size })),
        tuning: TUNING,
        caps: WIRE,
        group: GROUP_TUNING,
        combat: COMBAT_WIRE,
        own: OWN_TUNING,
        item: LEDGER_TUNING,
        spot: SPOT_TUNING,
        // The distances a group works to, which are the client's own and not this server's to pick:
        // they are printed here so what is being enforced can be read off without reading the code.
        ranges: GROUP_RANGES,
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
    /** The name a group knows this browser by, which outlives the line when it has claimed one. */
    member: null,
    /** What the character it claimed is called, before its first hello says so. */
    claimed: '',
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
    // Their group is told they have stepped out, not that they have gone: their place is held for a
    // while, so a reload does not cost anybody their group and the leader does not change hands
    // over one. It is `tick` that gives a place up when nobody comes back for it.
    deliver(groups.absent(c.id));
    // A duel does not wait for anybody: whoever they were fighting is told it is over, rather than
    // being left in a fight with a line that has closed.
    deliverTo(duels.drop(c.id));
    // Whatever this browser was thinking for is taken off it at once and given to whoever is nearest,
    // so nothing is left standing with nobody's brain in it. The creatures themselves stay: they
    // belong to the world and not to anybody in it, whoever stood them.
    deliverTo(ownership.gone(c.id));
    // A trade dies with either line: it ends with both sides' items exactly where they started, and
    // the other player is told why rather than being left with a window over a browser that has gone.
    // A swap that had already been written down is not undone by this -- it was one step, and it is
    // done -- so whoever came back would find the item where the log says it is.
    deliverTo(ledger.gone(c.id));
    // And whatever dock or spot on a hull it was holding is free at once, so nobody circles a lane a
    // browser that has gone still has its name on.
    spots.gone(c.id);
    // A world nobody is left standing on stops being remembered: the picture of where its creatures
    // had got to is only there for the next browser to arrive, and it is rebuilt from their batches.
    if (key && rooms.members(key).size === 0) npcPlaces.forget(key);
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

// The only clock a group needs: an invitation nobody answered, a trip nobody took and a place held
// for someone who has not come back all have a life on them, and this is what ends them. With
// nobody grouped and nobody asked it walks two empty tables a second and writes nothing.
setInterval(() => deliver(groups.tick()), GROUP_TUNING.tick);

// Who thinks for which creature, worked out twice a second: the rate the grants go out at is this
// clock and nothing in ownership.mjs counts. With nothing stood anywhere it walks an empty table.
setInterval(() => deliverTo(ownership.tick()), OWN_TUNING.grant);

// An invitation to trade nobody answered, and a trade nobody has touched for a long while: both have
// a life on them, and this is what ends them. With nobody trading it walks an empty table a second
// and writes nothing. (A claimed dock needs no clock: it is given back when the ship lets go, when
// its browser leaves that world, and when its line closes.)
setInterval(() => deliverTo(ledger.tick()), LEDGER_TUNING.tick);

// A duel nobody answered, and one nobody has landed a blow in for an hour, both end on their own.
// It is a slow clock on purpose: with nobody fighting it walks two empty tables once a minute.
setInterval(() => deliverTo(duels.tick()), COMBAT_WIRE.tick);

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
  console.log(`  damage between players is ${FRIENDLY_FIRE ? 'on' : `off (--friendly-fire turns it on); with it off, two players may still agree to a duel, which reaches ${GROUP_RANGES.duel} m -- the client's own distance`}`);
  console.log(`  a group holds ${GROUP_TUNING.members}, an invitation reaches ${GROUP_RANGES.invite} m (the client's own distance), and a place is held for ${Math.round(GROUP_TUNING.hold / 1000)} s while someone reloads`);
  const admin = adminFor(store.data, ADMIN);
  console.log(`  nothing appears in the world on its own: ${admin ? `${admin} is its admin and stands creatures by hand` : 'the first player this world meets becomes its admin and stands creatures by hand'} (--admin=<player id> names another)`);
  console.log(`  one browser thinks for each of them: the nearest player within ${OWN_TUNING.range} m, changing hands only after another has been a quarter nearer for ${Math.round(OWN_TUNING.steady / 1000)} s`);
  console.log(`  what each character owns is kept here too: ${ledger.describe()}; two players trade within ${GROUP_RANGES.trade} m -- the client's own distance -- and a swap is one line in the log or none`);
  console.log(`  a browser built before this one plays as it always has; http://localhost:${PORT}/ says what is going on`);
});
