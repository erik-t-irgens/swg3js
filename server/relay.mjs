#!/usr/bin/env node
// A relay for playing together: every client sends where it is and what it is doing a few times
// a second, and the relay passes each one's news to all the others. No accounts, no world state
// of its own, no dependencies: a WebSocket server on Node's http module, text frames only.
//
//   node server/relay.mjs [port]      (default 8787)
//
// Messages, JSON, client to relay:
//   { t: 'hello', name, species, class, planet, zone }   who and where; sent on joining and on travel
//   { t: 'state', p: [x, y, z], h, s, v }                position, heading, rig state, speed
//   { t: 'emote', clip }
// Relay to client:
//   { t: 'welcome', id, peers: [{ id, hello, state }] }
//   { t: 'join', id, hello }   { t: 'leave', id }   { t: 'state', id, ... }   { t: 'emote', id, clip }
//   { t: 'hello', id, hello }  (a peer moved to another world)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** A connected player: its socket, its hello and its last state. */
const clients = new Map();
let nextId = 1;

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

function send(c, msg) {
  if (c.socket.destroyed) return;
  c.socket.write(frame(JSON.stringify(msg)));
}

function broadcast(msg, except = null) {
  for (const c of clients.values()) if (c !== except) send(c, msg);
}

/** Parse the frames in a client's buffer; returns the messages (text) found, keeping a partial frame. */
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

function onMessage(c, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'hello') {
    const hello = { name: String(msg.name ?? 'someone').slice(0, 24), species: String(msg.species ?? 'human_male').slice(0, 40), class: msg.class === 'bounty_hunter' ? 'bounty_hunter' : 'jedi', planet: String(msg.planet ?? '').slice(0, 24), zone: msg.zone ? String(msg.zone).slice(0, 24) : undefined };
    const first = !c.hello;
    c.hello = hello;
    broadcast({ t: first ? 'join' : 'hello', id: c.id, hello }, c);
    if (first) send(c, { t: 'welcome', id: c.id, peers: [...clients.values()].filter((o) => o !== c && o.hello).map((o) => ({ id: o.id, hello: o.hello, state: o.state })) });
  } else if (msg.t === 'state') {
    if (!c.hello) return;
    const p = Array.isArray(msg.p) && msg.p.length === 3 ? msg.p.map(Number) : null;
    if (!p || p.some((v) => !Number.isFinite(v))) return;
    c.state = { p, h: Number(msg.h) || 0, s: typeof msg.s === 'string' ? msg.s.slice(0, 32) : 'idle', v: Number(msg.v) || 0, m: !!msg.m, sab: !!msg.sab };
    broadcast({ t: 'state', id: c.id, ...c.state }, c);
  } else if (msg.t === 'emote') {
    if (!c.hello || typeof msg.clip !== 'string') return;
    broadcast({ t: 'emote', id: c.id, clip: msg.clip.slice(0, 48) }, c);
  }
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`swg3js relay: ${clients.size} connected\n`);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(String(req.headers.upgrade))) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c = { id: nextId++, socket, buffer: Buffer.alloc(0), partial: Buffer.alloc(0), hello: null, state: null };
  clients.set(c.id, c);
  console.log(`+ client ${c.id} from ${socket.remoteAddress} (${clients.size} connected)`);
  socket.on('data', (chunk) => {
    c.buffer = Buffer.concat([c.buffer, chunk]);
    if (c.buffer.length > 1 << 20) {
      socket.destroy();
      return;
    }
    for (const m of parseFrames(c)) {
      if (m.close) {
        socket.end();
        break;
      }
      onMessage(c, m.text);
    }
  });
  const gone = () => {
    if (!clients.has(c.id)) return;
    clients.delete(c.id);
    console.log(`- client ${c.id}${c.hello ? ` (${c.hello.name})` : ''} (${clients.size} connected)`);
    if (c.hello) broadcast({ t: 'leave', id: c.id });
  };
  socket.on('close', gone);
  socket.on('error', gone);
  socket.on('end', gone);
});

// A ping every twenty seconds keeps idle connections alive through proxies, and finds the dead.
setInterval(() => {
  for (const c of clients.values()) if (!c.socket.destroyed) c.socket.write(Buffer.from([0x89, 0]));
}, 20000);

server.listen(PORT, () => console.log(`swg3js relay listening on ws://0.0.0.0:${PORT}`));
