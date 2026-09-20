// The browser's half of a fight two people are in: the bolts that cross between them, where each one
// landed, the health it took, a blade turning one away, and dying.
//
// The shape is the one the groups already have. The server holds what is decided -- whether two
// players may hurt each other at all, and who is in a duel -- and this side holds what is observed.
// It decides nothing on its own: everything it is told comes through `handle`, everything it asks
// for goes out through `send`, and with no server (no address set, or the relay that came before)
// `active` is false, nothing is sent, no bolt crosses and the game is exactly what it is today.
//
// Four rules shape it. Nothing here touches the document, three.js or the socket, so a node test
// runs it as it is: what a bolt is made of reaches this file as plain numbers, and the making of one
// is a hook the game fills in. Nothing here runs in a frame -- a shot is an event, and health is
// looked at a few times a second and sent only when it has moved. Nothing is allocated except the
// messages themselves, one per shot. And words from the far end are data: a number is checked
// finite before it is used, and nothing that arrives is ever allowed to throw in the middle of a
// message, since a throw there would cost every message after it.
//
// Who decides a hit is the owner's decision: the shooter. Everyone is drawn ten times a second and
// glided in between, so two screens never agree exactly, and somebody has to be right. The one who
// was hit is the only place a number is subtracted, and their own health message is what everyone
// else reads, so two browsers cannot come to disagree about how much of anybody is left -- and a
// death is always announced by the one who died.
//
// The wire is the server's (server/combatWire.mjs, and the list at the top of server/relay.mjs).
// This side sends `shot`, `end`, `hit`, `blocked`, `health`, `died` and `duel`; it is sent `shot`,
// `end`, `hurt`, `blocked`, `health`, `died` and `duel` -- the words in `COMBAT_WORDS`, which the
// socket has to hand over for any of this to happen at all.
//
// What the far end is taken on trust for is written out in the design's trust model, and one line
// of it belongs here: a `blocked` names a shot by whose it is and which, and every browser obeys it
// without asking whether a blade was anywhere near that bolt. Among friends that is the point --
// the blocker's own screen is the only one that can know -- and it means a browser on another build
// can stop anybody's bolts. It cannot make one hurt anybody, which is the line that matters.

import type { Authority } from './session.ts';

/**
 * The words this module answers. The socket (`src/net/net.ts`) hands a word over rather than
 * reading it, so this list and the one in its switch have to agree: a word missing there is a word
 * this side never hears, and the whole fight is quiet with nothing to say why.
 */
export const COMBAT_WORDS = ['shot', 'end', 'hurt', 'blocked', 'health', 'died', 'duel'] as const;

/**
 * Every number this side invents, in one place and live: `__debug.combat({ shotsPerSecond: 30 })`
 * sets one and the next shot obeys it. None of them is from the game. The distance a duel reaches
 * is not here, because that one is the game's (GROUP_RANGE.duel, out of the client's own table), and
 * the server's caps are the server's.
 */
export const COMBAT_TUNE = {
  /**
   * Invented: how many shots of this player's may cross in a second. A rapid trigger is about seven
   * a second and a scattergun's pellets are several at once, so this is a ceiling on a held trigger
   * rather than a limit anybody meets; over it the rest of that second is not sent, which loses
   * pictures of bolts and never loses a hit, since a hit is its own message.
   */
  shotsPerSecond: 20,
  /** Invented: how many pictures of other people's bolts may be in the air here at once. */
  copies: 96,
  /**
   * Invented: times a second this player's own health is looked at. It is sent only when it moves.
   * The wiring looks ten times a second, so anything above ten is the same as ten and is clamped
   * there rather than looking set and doing nothing.
   */
  healthHz: 5,
  /** Invented: how much health must move before it is worth a message, as a share of the whole. */
  healthStep: 0.01,
  /** Invented: seconds after a blow during which whoever struck it is named as the one who killed you. */
  blameSeconds: 8,
  /**
   * Invented: how many colours of bolt may be taken from the wire. Every distinct colour a bolt is
   * flown in costs this browser two materials for as long as the page is open, and what arrives is
   * a number another browser chose: past this many, a shot is drawn in the plain blaster's colour
   * rather than in one nobody here has ever used. The game's own guns and ships use a handful.
   */
  colours: 64,
  /**
   * Invented: how many shots a browser may keep a picture of before the numbers wrap. It is read
   * by `tuneCombat` and not written by it on purpose: a shot's name is its shooter times this, so
   * moving it while shots are in the air would rename every one of them and no `end` or `blocked`
   * would ever find its bolt again.
   */
  shotSpace: 1000000,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneCombat(o: Partial<typeof COMBAT_TUNE>): typeof COMBAT_TUNE {
  if (typeof o.shotsPerSecond === 'number') COMBAT_TUNE.shotsPerSecond = Math.max(1, Math.min(200, Math.round(o.shotsPerSecond)));
  if (typeof o.copies === 'number') COMBAT_TUNE.copies = Math.max(0, Math.min(1000, Math.round(o.copies)));
  if (typeof o.colours === 'number') COMBAT_TUNE.colours = Math.max(1, Math.min(1000, Math.round(o.colours)));
  // Ten is the rate the wiring looks at: see the note on the number itself.
  if (typeof o.healthHz === 'number') COMBAT_TUNE.healthHz = Math.max(0.5, Math.min(10, o.healthHz));
  if (typeof o.healthStep === 'number') COMBAT_TUNE.healthStep = Math.max(0.001, Math.min(1, o.healthStep));
  if (typeof o.blameSeconds === 'number') COMBAT_TUNE.blameSeconds = Math.max(0, Math.min(120, o.blameSeconds));
  return COMBAT_TUNE;
}

/**
 * What this file needs of a bolt in the air. It is written out rather than taken from the combat
 * code so that nothing of three.js reaches in here: a real bolt fits this shape exactly, and a node
 * test can hand in three numbers and a flag.
 */
export interface ShotBolt {
  pos: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  /** Metres a second, the shooter's own velocity already in it. */
  speed: number;
  /** Seconds it flies before it fades. */
  life: number;
  damage: number;
  /** Which shot it is, where shots cross; 0 for a bolt that is nobody else's business. */
  wire: number;
  /** A picture of somebody else's shot: it hurts nothing. */
  inert: boolean;
  /**
   * Who fired it, by the key everything else in the game remembers a shooter by. It is how this
   * player's own shots are told from everything else in the air, and nothing more of the shooter is
   * ever wanted here.
   */
  source?: { readonly key: number } | null;
  /** What it looks like, so a bolt flown again elsewhere is the same bolt to look at. */
  color?: number;
  size?: number;
  gravity?: number;
  /** How many walls it may glance off before it stops, so a bouncing bolt bounces everywhere. */
  bounces?: number;
  projectile?: { effect: string; reach: number; hit?: string | null; pack?: 'ships' | 'weapons' } | null;
  /**
   * Whether it flies in a hull's frame rather than in the world: the live thing itself is never
   * read here, only whether there is one. It is what decides whether a shot names a hull, and it
   * must be asked of the bolt and never of the player -- a ship flown from its bridge has a pilot
   * standing in its rooms while its guns fire in the world.
   */
  frame?: object | null;
}

/** A shot as it crosses: everything needed to fly the same bolt again, and nothing that cannot be written down. */
export interface WireShot {
  n: number;
  p: [number, number, number];
  d: [number, number, number];
  s: number;
  l: number;
  c: number;
  z: number;
  g?: number;
  /**
   * What it would take off what it struck. A picture of it takes nothing from anybody -- that is
   * what `inert` is for -- and this is read by one browser only: whoever turns the bolt away with a
   * blade, whose own bolt back off the blade carries the same blow the one that came in did.
   */
  a?: number;
  /** Walls it may still glance off. */
  b?: number;
  fx?: string;
  rc?: number;
  hx?: string;
  pk?: 'ships' | 'weapons';
  /** Fired inside a hull's rooms: whose hull. A browser not standing in that same hull lets it alone. */
  in?: number;
}

/** What the module is doing, filled in place so the console can read it between frames. */
export interface CombatStats {
  active: boolean;
  friendlyFire: boolean;
  /** How many other people's bolts are in the air here. */
  copies: number;
  /** Shots sent and shots heard since the page began. */
  sent: number;
  heard: number;
  /** Shots not sent because this browser was firing faster than they may cross. */
  held: number;
  /** Pictures not flown because there were already as many as there may be. */
  refused: number;
  /**
   * Pictures flown as a plain bolt rather than as the game's own effect, because this browser has
   * never fired that weapon and the effect is being got ready in the background. It should climb
   * once per weapon a stranger carries and then stand still: a climbing number every shot means
   * the effect never came, and a first shot that stutters means this counter was 0 when it should
   * not have been.
   */
  plain: number;
  /** Bolts drawn in the plain colour because as many colours as there may be have already come off the wire. */
  recoloured: number;
  /** Hits claimed against other players, and hits taken from them. */
  hits: number;
  hurts: number;
  blocks: number;
  /** This player's own health as it last went over, 0 to 1, and whether they went over as down. */
  hp: number;
  down: boolean;
  /** Who this browser is fighting a duel with, and who has asked it to. */
  duels: number[];
  asked: number;
}

/** The plain blaster's own colour, which is what a bolt is drawn in when nothing better is known. */
const DEFAULT_BOLT = 0xff4a2a;

/** A finite number, or the fallback: everything that arrives is read through one of these. */
function num(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Three finite numbers, or null. */
function point(x: unknown): [number, number, number] | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out: [number, number, number] = [Number(x[0]), Number(x[1]), Number(x[2])];
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

/**
 * A particle effect's path inside its pack, or an empty string. The server checks this too; it is
 * checked again here because what it names is a file this browser is going to ask its pack for, and
 * a browser must never take a path from another browser on trust.
 */
const EFFECT_PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

function effect(x: unknown): string {
  if (typeof x !== 'string' || !x || x.length > 120 || !EFFECT_PATH.test(x)) return '';
  return x.split('/').includes('..') ? '' : x;
}

/** A relay id: a whole number above zero, or 0 for nobody. */
function who(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The name one browser's shot goes by here: whose it is and which of theirs. Two numbers in one, so
 * that a picture of a bolt can be found again by a word about it without a string being made for
 * every shot fired.
 */
export function shotKey(id: number, n: number): number {
  return id * COMBAT_TUNE.shotSpace + (n % COMBAT_TUNE.shotSpace);
}

/**
 * The fights between players as this browser holds them. One of these is made once and lives for the
 * page.
 */
export class CombatNet {
  /** Something to send: the socket puts it on the wire. Set by the wiring. */
  send: (msg: Record<string, unknown>) => void = () => {};
  /** Who decides: with no server this answers 'me' and the whole module stays quiet. */
  authority: () => Authority = () => 'me';
  /** This browser's own connection number, so its own shots are known for its own. */
  selfId: () => number = () => 0;
  /** Whether damage between players is switched on where we are (the server's switch; off with none). */
  friendlyFire: () => boolean = () => false;
  /** The clock the rates are measured on, in seconds; a test hands in its own. */
  private readonly now: () => number;

  // ---- what the game fills in ------------------------------------------------------------------

  /**
   * Fly a picture of somebody else's bolt and give it back, or null when this browser will not (it
   * is not in the world, or the shot is inside a hull it is not standing in). Whatever comes back is
   * held only until that bolt leaves the air.
   */
  fly: (shot: WireShot, key: number) => ShotBolt | null = () => null;
  /** Cut a bolt short where the one who fired it says it landed. */
  cut: (bolt: ShotBolt, x: number, y: number, z: number) => void = () => {};
  /** Whether a bolt is this player's own, and so one that crosses. Everything else in the air is this browser's business alone. */
  isMine: (bolt: ShotBolt) => boolean = () => false;
  /** Whose hull's rooms this player is standing in, 0 in the open world. */
  hullNow: () => number = () => 0;
  /**
   * Whether this browser's own pack already holds that particle effect, ready to be placed without
   * building anything. It answers false the first time it is asked about a weapon nobody here has
   * fired and gets it ready in the background, because making a batch and its program is main-thread
   * work and would land on whatever frame the shot arrived in -- which is the one thing the whole
   * game is built to avoid. Until it answers true the copy is flown as a plain bolt, which uses the
   * materials every bolt here already uses.
   */
  fxReady: (file: string, pack: 'ships' | 'weapons') => boolean = () => false;
  /** This player's health, 0 to 1, and whether they are down. */
  healthNow: () => { hp: number; down: boolean } = () => ({ hp: 1, down: false });

  // ---- what it tells the game -------------------------------------------------------------------

  /**
   * Somebody hurt this player: take it off, and turn toward where it came from. `what` is the word
   * the shooter used for what they struck -- their hull rather than the person in it -- so a pilot
   * takes it on the ship they are flying and a body takes it on the body.
   */
  onHurt: (amount: number, x: number, y: number, z: number, from: number, what: string) => void = () => {};
  /** A peer's health moved, or they went down. */
  onPeerHealth: (id: number, hp: number, down: boolean) => void = () => {};
  /** A peer died, and who struck the blow (0 when nobody was named). */
  onPeerDied: (id: number, by: number) => void = () => {};
  /** A duel began or ended with that player. */
  onDuel: (id: number, on: boolean) => void = () => {};
  /** Something the player should read. */
  onNote: (text: string) => void = () => {};
  /** What to call a player, for the words. */
  peerName: (id: number) => string = () => 'someone';

  /** Every picture of somebody else's bolt in the air here, and this player's own shots still flying. */
  private readonly flying = new Map<number, ShotBolt>();
  /** Whom this browser is fighting, and who has asked it to. */
  private readonly duelling = new Set<number>();
  private askedBy = 0;
  /** The last person to hurt this player, and when, so a death can say who did it. */
  private blame = 0;
  private blameAt = -1e9;
  private shotCount = 0;
  private shotWindow = 0;
  private shotsThisSecond = 0;
  private healthClock = 0;
  private sentHp = 1;
  private sentDown = false;
  private readonly stat: CombatStats = { active: false, friendlyFire: false, copies: 0, sent: 0, heard: 0, held: 0, refused: 0, plain: 0, recoloured: 0, hits: 0, hurts: 0, blocks: 0, hp: 1, down: false, duels: [], asked: 0 };
  /**
   * Every colour a bolt has arrived in. It is the cap's own memory and is kept across a line
   * dropping, because what it stands for -- the materials the bolts themselves keep, one pair per
   * colour -- is kept across one too.
   */
  private readonly wireColours = new Set<number>();

  constructor(now: () => number = () => Date.now() / 1000) {
    this.now = now;
    theFight = this;
  }

  // ---- what everything else asks -----------------------------------------------------------------

  /** Whether there is a server holding a world. With none, no shot crosses and nobody can be hurt. */
  get active(): boolean {
    return this.authority() === 'server';
  }

  /**
   * Whether this player may take health off that one. It is the server's switch, or, while that is
   * off, a duel the two of them agreed to -- the game's own `COMBAT_DUEL`. The server checks it
   * again on its own copy and is what decides; this is here so a shot that could never land is not
   * sent, and so the game can say why.
   */
  mayHurt(id: number): boolean {
    if (!this.active || !id || id === this.selfId()) return false;
    return this.friendlyFire() || this.duelling.has(id);
  }

  /** Whether this browser is in a duel with that player. */
  duelWith(id: number): boolean {
    return this.duelling.has(id);
  }

  // ---- the shots ----------------------------------------------------------------------------------

  /**
   * A bolt left a muzzle. Only this player's own cross, and only as many in a second as they may:
   * over that the rest of the second is not sent, which loses pictures of bolts and never loses a
   * hit. A picture of somebody else's shot comes back through here and is known by not being this
   * player's, so nothing goes round for ever.
   */
  fired(bolt: ShotBolt): void {
    if (!this.active || bolt.inert || !this.isMine(bolt)) return;
    const at = this.now();
    if (at - this.shotWindow >= 1) {
      this.shotWindow = at;
      this.shotsThisSecond = 0;
    }
    if (++this.shotsThisSecond > COMBAT_TUNE.shotsPerSecond) {
      this.stat.held++;
      return;
    }
    // 1 upward, never 0: a shot numbered 0 would be a key this browser could not tell from "no
    // shot at all", and the numbers wrap rather than growing for ever.
    this.shotCount = (this.shotCount % (COMBAT_TUNE.shotSpace - 1)) + 1;
    const n = this.shotCount;
    const key = shotKey(this.selfId(), n);
    bolt.wire = key;
    this.flying.set(key, bolt);
    this.stat.copies = this.flying.size;
    const shot: WireShot = {
      n,
      p: [r2(bolt.pos.x), r2(bolt.pos.y), r2(bolt.pos.z)],
      d: [r3(bolt.dir.x), r3(bolt.dir.y), r3(bolt.dir.z)],
      s: r2(bolt.speed),
      l: r2(bolt.life),
      c: Math.floor(bolt.color ?? DEFAULT_BOLT),
      z: r2(bolt.size ?? 1),
    };
    if (bolt.gravity) shot.g = r2(bolt.gravity);
    // What it would take. Nothing on the far side takes it off anybody -- the copy is inert and the
    // hit is its own message -- but the browser whose blade turns this bolt away fires one back with
    // the same blow in it, and without this that blow would be nothing.
    if (bolt.damage > 0) shot.a = r2(bolt.damage);
    if (bolt.bounces) shot.b = Math.floor(bolt.bounces);
    const p = bolt.projectile;
    if (p?.effect) {
      shot.fx = p.effect;
      shot.rc = r2(p.reach ?? 0);
      if (p.hit) shot.hx = p.hit;
      shot.pk = p.pack === 'weapons' ? 'weapons' : 'ships';
    }
    // Whose hull's rooms it is flying inside, and only when it really is flying inside one: the
    // question is about the bolt's own frame and not about where the player happens to be standing.
    // A multi-crew ship is flown from its bridge, so its pilot is in its rooms while its guns fire
    // in the world; asked of the player, every one of those bolts would name a hull and be let alone
    // on every other screen.
    const hull = bolt.frame ? this.hullNow() : 0;
    if (hull) shot.in = hull;
    this.stat.sent++;
    this.send({ t: 'shot', ...shot });
  }

  /**
   * A bolt left the air. This player's own says where it stopped, so every picture of it is cut
   * short at the same point and the mark is in one place on every screen; a picture of somebody
   * else's is simply let go of. A bolt that reached the end of its flight without striking anything
   * says nothing: it ends on its own on every screen, at the same moment.
   */
  ended(bolt: ShotBolt, at: { x: number; y: number; z: number } | null): void {
    const key = bolt.wire;
    if (!key) return;
    bolt.wire = 0;
    if (this.flying.get(key) === bolt) this.flying.delete(key);
    this.stat.copies = this.flying.size;
    if (!this.active || !at || Math.floor(key / COMBAT_TUNE.shotSpace) !== this.selfId()) return;
    this.send({ t: 'end', n: key % COMBAT_TUNE.shotSpace, at: [r2(at.x), r2(at.y), r2(at.z)] });
  }

  /**
   * A lit blade turned somebody else's bolt away here. True when the word has gone out: that shot
   * then ends at this point on every browser, the shooter's own real bolt included, and whoever
   * blocked it is to announce a shot of their own from the same point -- which crosses as any other
   * shot does. One bolt in, one bolt out, on every screen.
   */
  blockedHere(bolt: ShotBolt, x: number, y: number, z: number): boolean {
    const key = bolt.wire;
    if (!this.active || !key) return false;
    const of = Math.floor(key / COMBAT_TUNE.shotSpace);
    if (!of || of === this.selfId()) return false;
    this.stat.blocks++;
    this.send({ t: 'blocked', of, n: key % COMBAT_TUNE.shotSpace, at: [r2(x), r2(y), r2(z)] });
    return true;
  }

  /**
   * This player struck another, for that much, there. It is the one message that can take another
   * player's health, and it is sent only where they may be hurt at all -- the server drops it
   * otherwise, so a browser on another build cannot hurt anybody in a peaceful world either.
   *
   * Everything that hurts a peer comes through here: a bolt, a blade, a blast, a power.
   */
  sendHit(to: number, amount: number, x: number, y: number, z: number, what = ''): boolean {
    if (!this.mayHurt(to) || !(amount > 0)) return false;
    this.stat.hits++;
    this.send({ t: 'hit', to, a: r2(amount), at: [r2(x), r2(y), r2(z)], ...(what ? { w: what.slice(0, 16) } : {}) });
    return true;
  }

  // ---- health and death ----------------------------------------------------------------------------

  /**
   * Time passing, at whatever rate the wiring asks (a few times a second, never per frame): this
   * player's own health, sent when it has moved enough to be worth a message, and a death announced
   * once with whoever struck the blow. Everyone else's health is their own to send.
   */
  step(dt: number): void {
    if (!this.active) return;
    this.healthClock -= dt;
    if (this.healthClock > 0) return;
    this.healthClock = 1 / Math.max(0.5, COMBAT_TUNE.healthHz);
    const state = this.healthNow();
    const hp = Math.min(1, Math.max(0, num(state.hp, 1)));
    const down = !!state.down;
    if (down && !this.sentDown) {
      // The one who fell says so, and says who did it: a death announced by the one who died is the
      // one thing two browsers can never disagree about.
      const by = this.now() - this.blameAt < COMBAT_TUNE.blameSeconds ? this.blame : 0;
      this.send({ t: 'died', ...(by ? { by } : {}) });
    }
    if (down === this.sentDown && Math.abs(hp - this.sentHp) < COMBAT_TUNE.healthStep) return;
    this.sentHp = hp;
    this.sentDown = down;
    this.stat.hp = hp;
    this.stat.down = down;
    this.send({ t: 'health', hp: Math.round(hp * 1000) / 1000, ...(down ? { d: 1 } : {}) });
  }

  // ---- the duel ------------------------------------------------------------------------------------

  /** Ask that player for a duel: the game's own `COMBAT_DUEL`, which the server holds to its own 128 m. */
  askDuel(id: number): string {
    if (!this.active) return 'there is no server here, so there is nobody to fight';
    if (!id || id === this.selfId()) return 'nobody there to fight';
    if (this.duelling.has(id)) return 'you are already fighting them';
    this.send({ t: 'duel', do: 'ask', to: id });
    return '';
  }

  acceptDuel(): void {
    if (this.active && this.askedBy) this.send({ t: 'duel', do: 'accept' });
  }

  declineDuel(): void {
    if (this.active && this.askedBy) this.send({ t: 'duel', do: 'decline' });
  }

  /** Call it off: the game's own `COMBAT_PEACE`. Every duel this player is in ends. */
  peace(): void {
    if (this.active) this.send({ t: 'duel', do: 'end' });
  }

  /** Who asked this browser for a duel, and has not been answered; 0 when nobody has. */
  get asked(): number {
    return this.askedBy;
  }

  // ---- what the server says --------------------------------------------------------------------------

  /**
   * One message from the far end. True when it was one of ours, so the socket's own switch can go on
   * ignoring everything it does not know. Everything in it is treated as words from a stranger: read
   * through the checks above, never trusted, and never allowed to throw.
   */
  handle(msg: Record<string, unknown>): boolean {
    switch (String(msg?.t ?? '')) {
      case 'shot':
        this.heardShot(msg);
        return true;
      case 'end': {
        const at = point(msg.at);
        const bolt = this.take(shotKey(who(msg.id), Math.floor(num(msg.n))));
        if (bolt && at) this.cut(bolt, at[0], at[1], at[2]);
        return true;
      }
      case 'hurt': {
        const a = num(msg.a);
        const at = point(msg.at) ?? [0, 0, 0];
        const from = who(msg.id);
        if (!(a > 0)) return true;
        this.stat.hurts++;
        this.blame = from;
        this.blameAt = this.now();
        this.onHurt(a, at[0], at[1], at[2], from, typeof msg.w === 'string' ? msg.w.slice(0, 16) : '');
        return true;
      }
      case 'blocked': {
        // A blade somewhere else turned a bolt away. Whoever fired it stops their own real bolt here
        // and everybody else stops their picture of it, so the one that flies on from the blade is
        // the blocker's and there is never more than one.
        const at = point(msg.at);
        const bolt = this.take(shotKey(who(msg.of), Math.floor(num(msg.n))));
        if (bolt && at) this.cut(bolt, at[0], at[1], at[2]);
        return true;
      }
      case 'health': {
        const id = who(msg.id);
        if (id) this.onPeerHealth(id, Math.min(1, Math.max(0, num(msg.hp, 1))), msg.d === 1);
        return true;
      }
      case 'died': {
        const id = who(msg.id);
        if (id) this.onPeerDied(id, who(msg.by));
        return true;
      }
      case 'duel':
        this.heardDuel(msg);
        return true;
      default:
        return false;
    }
  }

  /**
   * The bolt a word is about, let go of in the same breath. Letting go here rather than waiting for
   * the game to say the bolt has left the air is what makes a word that arrives twice -- or one
   * about a bolt this browser never flew -- do its work once and then nothing.
   */
  private take(key: number): ShotBolt | undefined {
    const bolt = this.flying.get(key);
    if (!bolt) return undefined;
    this.flying.delete(key);
    this.stat.copies = this.flying.size;
    return bolt;
  }

  private heardShot(msg: Record<string, unknown>): void {
    const id = who(msg.id);
    const n = Math.floor(num(msg.n));
    const p = point(msg.p);
    const d = point(msg.d);
    if (!id || !p || !d) return;
    this.stat.heard++;
    // A shot fired inside a hull's rooms is only a shot for somebody standing in the same hull:
    // anywhere else there is nothing to fly it against, so it is let alone rather than drawn
    // through the open air where the hull happens to be.
    const hull = who(msg.in);
    if (hull && hull !== this.hullNow()) return;
    if (this.flying.size >= COMBAT_TUNE.copies) {
      this.stat.refused++;
      return;
    }
    const shot: WireShot = {
      n,
      p,
      d,
      s: num(msg.s),
      l: num(msg.l, 1),
      c: this.colourFor(Math.floor(num(msg.c, DEFAULT_BOLT))),
      z: num(msg.z, 1),
    };
    const g = num(msg.g);
    if (g > 0) shot.g = g;
    const a = num(msg.a);
    if (a > 0) shot.a = a;
    const b = Math.floor(num(msg.b));
    if (b > 0) shot.b = Math.min(64, b);
    const fx = effect(msg.fx);
    const pk = msg.pk === 'weapons' ? 'weapons' : 'ships';
    // The game's own effect the bolt is drawn as, but only once this browser's pack can place it
    // without building anything. The first shot from a weapon nobody here has fired is drawn as a
    // plain bolt while the effect is got ready behind it, because a batch and its program made in
    // the middle of a frame is the stutter the rest of the game goes out of its way to avoid.
    if (fx && this.fxReady(fx, pk)) {
      shot.fx = fx;
      shot.rc = num(msg.rc);
      const hx = effect(msg.hx);
      if (hx && this.fxReady(hx, pk)) shot.hx = hx;
      shot.pk = pk;
    } else if (fx) {
      this.stat.plain++;
    }
    if (hull) shot.in = hull;
    const key = shotKey(id, n);
    const bolt = this.fly(shot, key);
    if (!bolt) return;
    bolt.wire = key;
    this.flying.set(key, bolt);
    this.stat.copies = this.flying.size;
  }

  /**
   * The colour a bolt off the wire is drawn in. Every new one costs this browser a pair of
   * materials for the life of the page, and the number came from somewhere else: past as many as
   * there may be, a shot is drawn in the plain blaster's colour. The game's own weapons and ships
   * use a handful, so nobody playing ever meets this.
   */
  private colourFor(c: number): number {
    if (this.wireColours.has(c)) return c;
    if (this.wireColours.size >= COMBAT_TUNE.colours) {
      this.stat.recoloured++;
      return DEFAULT_BOLT;
    }
    this.wireColours.add(c);
    return c;
  }

  private heardDuel(msg: Record<string, unknown>): void {
    const id = who(msg.id);
    switch (String(msg.do ?? '')) {
      case 'asked':
        this.askedBy = id;
        this.stat.asked = id;
        this.onNote(`${this.peerName(id)} has asked you for a duel: /duel to fight, /peace to say no`);
        break;
      case 'sent':
        this.onNote(`asked ${this.peerName(id)} for a duel`);
        break;
      case 'on':
        if (!id) break;
        this.duelling.add(id);
        if (this.askedBy === id) this.askedBy = 0;
        this.stat.asked = this.askedBy;
        this.stat.duels = [...this.duelling];
        this.onDuel(id, true);
        this.onNote(`a duel with ${this.peerName(id)}: /peace ends it`);
        break;
      case 'off':
        if (!id) break;
        this.duelling.delete(id);
        if (this.askedBy === id) this.askedBy = 0;
        this.stat.asked = this.askedBy;
        this.stat.duels = [...this.duelling];
        this.onDuel(id, false);
        this.onNote(`the duel with ${this.peerName(id)} is over`);
        break;
      case 'declined':
        this.onNote(`${this.peerName(id)} would rather not`);
        break;
      case 'refused':
        this.onNote(typeof msg.why === 'string' ? msg.why.slice(0, 160) : 'the server would not do that');
        break;
      default:
        // A word this browser does not know: the server is on a newer build, and saying nothing is
        // what keeps an older browser working against it.
        break;
    }
  }

  /**
   * The line dropped, the player went to the select screen, or the world was unloaded: nothing that
   * was in the air is in the air any more, and no duel outlives a line. The bolts themselves belong
   * to the world and go with it; what is let go of here is only the holding of them.
   */
  clear(): void {
    this.flying.clear();
    this.duelling.clear();
    this.askedBy = 0;
    this.blame = 0;
    this.blameAt = -1e9;
    this.stat.copies = 0;
    this.stat.duels = [];
    this.stat.asked = 0;
    // The next look at health sends it, whatever it was before: a browser that comes back with a
    // world's worth of healing behind it would otherwise say nothing until it was hurt again.
    // Whether this player is down is left exactly as it was, because a death is announced once and
    // by the one who died: cleared here, a line that dropped while its player lay dead would
    // announce the same death again on the way back, and with nobody named for it, since whoever
    // struck the blow is forgotten in this same call.
    this.sentHp = -1;
    this.healthClock = 0;
  }

  /**
   * Say this player's health again at the next look, whatever it was last time. Somebody who has
   * only just arrived is told about everyone through their greeting and their states, none of which
   * carries health, so without this they would read everyone as whole until the next time somebody
   * was hurt.
   */
  announceHealth(): void {
    this.sentHp = -1;
    this.healthClock = 0;
  }

  /** What the fight is doing, in the object it always answers with. */
  debug(): CombatStats {
    this.stat.active = this.active;
    this.stat.friendlyFire = this.friendlyFire();
    this.stat.copies = this.flying.size;
    return this.stat;
  }
}

/**
 * The one in play. There is a single fight for the life of the page, and the parts of the game that
 * are not handed it -- a body standing in for another player, which is built far from the wiring --
 * ask for it here. It answers null before the game has made one, and with no server it is made and
 * quiet, so a caller never has to ask whether there is a server: `mayHurt` answers no.
 */
let theFight: CombatNet | null = null;

export function combatNow(): CombatNet | null {
  return theFight;
}

/** Two and three decimal places: a place to the centimetre and a heading to a thousandth, as the states are cut. */
function r2(n: number): number {
  return Number(num(n).toFixed(2));
}

function r3(n: number): number {
  return Number(num(n).toFixed(3));
}
