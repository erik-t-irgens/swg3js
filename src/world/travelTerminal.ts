// The travel terminal, the ticket, the ticket collector and the shuttle's own clock.
//
// The game's own arrangement, which the emulator's building scripts still carry, is three things
// and not one: a **terminal** inside the starport where a ticket is bought, a **collector** outside
// where it is taken, and a **transport** that lands, waits and leaves. A ticket names where it is
// from and where it goes, and it is the collector, not the terminal, that puts you on the shuttle.
//
// **The shuttle's timetable is ours.** Nothing in the archives says how often one came or how long
// it waited: that was the server's, and the emulator's own figures are that server's choice rather
// than something the game shipped. So the clock here is invented, and it is built the way this game
// already keeps two players agreeing about the weather and about lightning -- straight off the wall
// clock with no message between browsers, each port's line cut into slots and each slot's moment
// hashed from the port's own name. Two people standing at one starport see the same shuttle land at
// the same instant, and nothing is sent to make that true.
//
// Pure: no three, no fetch, no DOM. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

/** One travel thing, as a world's pack carries it. */
export interface TravelRow {
  kind: 'terminal' | 'collector' | 'shuttle';
  building: string;
  /** The room it stands in, or 0 for out in the open. */
  cell: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Where the building it belongs to stands, in the snapshot's own frame. */
  bx: number;
  by: number;
  bz: number;
  byaw: number;
}

/** One of them in the world's own frame, with what it belongs to. */
export interface TravelThing {
  kind: 'terminal' | 'collector' | 'shuttle';
  /** Where it really is, in the world's frame. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  cell: number;
  building: string;
  /** Where the building it belongs to stands, which is how a terminal is tied to its own port. */
  bx: number;
  bz: number;
}

/** Every number of the shuttle's own timetable. All of them ours; live through `__debug.terminal`. */
export const TRAVEL_TUNE = {
  /** How near a terminal or a collector you have to stand to use it, metres. */
  reach: 4,
  /** How long a whole round goes, seconds: one shuttle leaving to the next landing. */
  every: 300,
  /** How long it stands waiting once it has landed, seconds. */
  waits: 60,
  /** How long it takes to come down and to go up again, seconds, drawn at each end of the wait. */
  glide: 12,
};

/**
 * The travel things of a world, **every one of them in the world's own frame**.
 *
 * Snapshot space is mirrored in X and centred on the layout centre, which is the streamer's own
 * transform, and that is the whole of what a thing standing outside a building needs. A thing
 * *inside* one is written in the building's own frame instead -- that is the frame its room was
 * authored and is drawn in -- and it is brought over here rather than left there, because the one
 * thing it is measured against is the player's position, which is the world's for anybody walking
 * a room (only a ship's rooms keep their own frame, and no starport is a ship).
 *
 * Leaving it in the building's frame is exactly what made the starports' terminals unreachable: the
 * shuttleports' are outside and came out in the world's frame and worked, while a starport's read
 * as a few metres from the world's origin and so stood some kilometres from the player wherever
 * they went. Nothing ever showed, because there is nothing to show for a thing you are not near.
 *
 * How it gets there is not guessed at either. The offset is composed **in the snapshot's own frame**
 * -- the very arithmetic the converter used for the outdoor children, turned by the building's
 * snapshot yaw -- and only then is it mirrored, which is what the whole-world mirror does to every
 * other point. Written the other way round (mirror the local point, then turn it by the mirrored
 * yaw) the two paths disagree the moment a building is turned at all, which the node test catches
 * by putting the same local place through both.
 */
export function travelThingsOf(rows: readonly TravelRow[], centre: { x: number; z: number }): TravelThing[] {
  const out: TravelThing[] = [];
  for (const r of rows) {
    const bx = -(r.bx - centre.x);
    const bz = r.bz - centre.z;
    if (r.cell > 0) {
      const cos = Math.cos(r.byaw);
      const sin = Math.sin(r.byaw);
      // The offset in the snapshot's frame, then mirrored across: the building's own place is
      // already over here, so all that is left of the mirror is the offset's own across-part.
      out.push({
        kind: r.kind,
        x: bx - (r.x * cos + r.z * sin),
        y: r.by + r.y,
        z: bz + (-r.x * sin + r.z * cos),
        yaw: -(r.byaw + r.yaw),
        cell: r.cell,
        building: r.building,
        bx,
        bz,
      });
      continue;
    }
    out.push({ kind: r.kind, x: -(r.x - centre.x), y: r.y, z: r.z - centre.z, yaw: -r.yaw, cell: 0, building: r.building, bx, bz });
  }
  return out;
}

/**
 * The terminal or collector somebody is standing at, or null.
 *
 * Everything is in the world's frame, so the reach is one distance whether a thing stands in a room
 * or in the open. The room is still asked about, because a terminal on the other side of a wall is
 * four metres away and should not be reachable through it: a thing in a room is offered only to
 * somebody standing in that same room of that same building, and one in the open only to somebody
 * who is not indoors at all.
 */
export function thingAt(things: readonly TravelThing[], at: { x: number; y: number; z: number }, room: { building: string; cell: number } | null, kind: 'terminal' | 'collector', tune = TRAVEL_TUNE): TravelThing | null {
  let best: TravelThing | null = null;
  let bestD = Infinity;
  for (const t of things) {
    if (t.kind !== kind) continue;
    if (t.cell > 0) {
      if (!room || room.cell !== t.cell || room.building !== t.building) continue;
    } else if (room) continue;
    const d = Math.hypot(t.x - at.x, t.z - at.z) + Math.abs(t.y - at.y) * 0.5;
    if (d > tune.reach || d >= bestD) continue;
    bestD = d;
    best = t;
  }
  return best;
}

/** A ticket: where it is from, where it goes, and when it was bought. */
export interface Ticket {
  /** This ticket and no other, so the panel can name which one is being used or thrown away. */
  id: string;
  /** The pack the journey starts on. */
  from: string;
  /** The pack it ends on; the same one for a hop about a single world. */
  pack: string;
  /** The port it lands at, by the name the game gave it. */
  to: string;
  /** Where that port is, in the destination world's own frame, for a hop about this one. */
  at: { x: number; z: number } | null;
  price: number;
  bought: number;
}

/** How many tickets may be held at once. Ours; a ticket has no weight and this is a sanity bound. */
export const TICKETS_HELD = 12;

/**
 * Put a ticket in hand, oldest thrown away once there are too many.
 *
 * A player may hold several, which is the whole of the owner's ask: a ticket is a thing you buy and
 * keep rather than a slot with one in it. The list is kept newest last, so the oldest is the one
 * that goes when the cap is reached, and nothing is ever silently replaced.
 */
export function addTicket(tickets: readonly Ticket[], ticket: Ticket, most = TICKETS_HELD): Ticket[] {
  const out = [...tickets.filter((t) => t.id !== ticket.id), ticket];
  return out.length > most ? out.slice(out.length - most) : out;
}

/**
 * Which ticket the collector would take, from the ones held.
 *
 * The one the player picked, when it is good from here; otherwise the oldest that is, so somebody
 * who never opens the list is simply served in the order they bought. A ticket for another world's
 * shuttle is not good here and is stepped over rather than refused, or holding one would stop every
 * other ticket working.
 */
export function pickTicket(tickets: readonly Ticket[], using: string, here: string): Ticket | null {
  const chosen = tickets.find((t) => t.id === using);
  if (chosen && chosen.from === here) return chosen;
  return tickets.find((t) => t.from === here) ?? null;
}

/** What a ticket reads as in the list. */
export function ticketText(t: Ticket, here: string): string {
  const where = t.from === here ? 'taken at the collector outside' : `from ${t.from}`;
  return `to ${t.to} — ${where}`;
}

/**
 * A number drawn from a name and a slot, evenly between 0 and 1.
 *
 * The same shape the weather's schedule and the nebulae's lightning use, and for the same reason:
 * two browsers must agree with nothing sent between them, so every moment has to come out of the
 * wall clock and a name rather than out of anybody's decision.
 */
export function slotHash(name: string, slot: number): number {
  let h = 0x811c9dc5 ^ slot;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return (h >>> 8) / 0x1000000;
}

/** Where a port's shuttle is in its round, at a moment of the shared wall clock. */
export interface ShuttleState {
  /** 'away', 'landing', 'waiting' (it may be boarded) or 'leaving'. */
  phase: 'away' | 'landing' | 'waiting' | 'leaving';
  /** Seconds until it can be boarded; 0 while it can. */
  until: number;
  /** Seconds it will stay, while it is waiting; 0 otherwise. */
  left: number;
  /** How far through its landing or its leaving it is, 0 to 1, for whatever draws it. */
  glide: number;
}

/**
 * Where a port's shuttle is, from the wall clock and the port's own name and nothing else.
 *
 * Every port keeps its own round of `every` seconds, and where in that round it lands is drawn from
 * its name -- so two ports do not all land together, and the same port lands at the same instant in
 * every browser with nothing sent between them.
 */
export function shuttleAt(name: string, seconds: number, tune = TRAVEL_TUNE): ShuttleState {
  const every = Math.max(tune.waits + tune.glide * 2 + 1, tune.every);
  const slot = Math.floor(seconds / every);
  // Where in this round it comes down: anywhere that leaves room for the whole visit.
  const room = every - (tune.waits + tune.glide * 2);
  const start = slotHash(name, slot) * room;
  const t = seconds - slot * every - start;
  if (t < 0) return { phase: 'away', until: -t, left: 0, glide: 0 };
  if (t < tune.glide) return { phase: 'landing', until: tune.glide - t, left: 0, glide: t / tune.glide };
  if (t < tune.glide + tune.waits) return { phase: 'waiting', until: 0, left: tune.glide + tune.waits - t, glide: 1 };
  if (t < tune.glide * 2 + tune.waits) return { phase: 'leaving', until: every - t + slotHash(name, slot + 1) * room, left: 0, glide: 1 - (t - tune.glide - tune.waits) / tune.glide };
  return { phase: 'away', until: every - t + slotHash(name, slot + 1) * room, glide: 0, left: 0 };
}

/** What a shuttle's state reads as under the collector, in words. */
export function shuttleWords(s: ShuttleState): string {
  if (s.phase === 'waiting') return `the shuttle is here, leaving in ${Math.ceil(s.left)}s`;
  if (s.phase === 'landing') return 'the shuttle is coming down';
  if (s.phase === 'leaving') return 'the shuttle is lifting off';
  const m = Math.floor(s.until / 60);
  const sec = Math.ceil(s.until % 60);
  return m ? `the next shuttle is ${m}m ${sec}s away` : `the next shuttle is ${sec}s away`;
}

/** Whether a ticket can be handed in here: it must be a ticket from this world, and one must be held. */
export function canBoard(ticket: Ticket | null, here: string, s: ShuttleState): { ok: boolean; why: string } {
  if (!ticket) return { ok: false, why: 'you have no ticket' };
  if (ticket.from !== here) return { ok: false, why: `that ticket is for a shuttle from ${ticket.from}` };
  if (s.phase !== 'waiting') return { ok: false, why: shuttleWords(s) };
  return { ok: true, why: '' };
}

/**
 * What standing at a collector offers, in words, whichever way it falls.
 *
 * It is one line rather than two because it answers one question -- can I get on -- and because a
 * shuttle that is not there has to say so in the same place a shuttle that is says so. Before this
 * the only time the shuttle's own clock was ever shown was the moment it refused, so somebody who
 * pressed at the right moment never saw a shuttle at all and had no way of knowing one had been
 * there: there is nothing drawn on the pad, and there was nothing said either.
 */
export function collectorWords(ticket: Ticket | null, here: string, s: ShuttleState): { can: boolean; text: string } {
  const can = canBoard(ticket, here, s);
  if (can.ok) return { can: true, text: `board the shuttle to ${ticket!.to} — it leaves in ${Math.ceil(s.left)}s` };
  if (!ticket || ticket.from !== here) return { can: false, text: `${can.why}; ${shuttleWords(s)}` };
  return { can: false, text: shuttleWords(s) };
}
