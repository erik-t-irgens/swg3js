// Speaking to somebody: who may be spoken to at all, what they say first, what may be answered, and
// where the camera stands while they are listened to -- the pure half, with no three, no physics and
// no page, so a node test drives the very functions the game runs.
//
// **Only a person who is not hostile and not in a fight may be spoken to.** A person is a body on the
// humanoid skeleton the catalogue stands (`Mobile.humanoid`): never a creature, never a droid, which
// the catalogue's own kind decides, and never a hologram. Not hostile is two things and both are asked:
// a body on the hostile side (the bandits, the raiders, the Tuskens) is refused whatever its temper, and
// so is any body that would pick a fight with the player on sight (`hostileSides`, the one matrix every
// body fights by). That second rule is also why no fighter stood from the console can ever be spoken
// to: a fighter's side fights every person there is. Not in a fight is `Mobile.engaged`, which is a
// target, a grudge it still holds, or a fight's own state. A fixture the world cannot work without (the
// ticket collector, whose use key is the shuttle's) is refused too.
//
// **Anybody this browser can see may be spoken to, whichever browser is thinking for them**: with a
// server the world's people are everybody's, and refusing every one somebody else keeps would leave the
// world mute for anybody not standing nearest. **Following is this browser's alone**, though: a follower
// walks with this browser's player and is never handed to another keeper, so only a body this browser
// keeps -- or one on no wire at all -- may be asked to follow, and one another player's game keeps is
// refused in words (`talkOptions`' `keptElsewhere`). While spoken to, a body somebody else keeps goes on
// doing what its keeper says: the conversation is this screen's, and nothing of it crosses.
//
// **Everything here is ours.** The client's conversation trees were the server's and never shipped, and
// nothing the converter writes holds a greeting a stranger would say, so every line below is invented,
// chosen by the body's own key so the same person says the same thing each time they are spoken to. The
// numbers -- how near, how wide a look, where the camera stands and how fast it eases -- are invented
// too and live through `__debug.talk({ tune })`.
//
// Nothing here allocates in a frame: a caller keeps the structs it asks through and writes into them.
import { hostileSides, type Fighter } from '../combat/targets.ts';
import type { Aggression, Side } from '../combat/kit.ts';

/** Every number a conversation runs on, all of them ours. */
export const TALK_TUNE = {
  /** How near a person must stand to be spoken to, metres across the ground, and how far above or below. */
  reach: 3,
  rise: 2,
  /**
   * How squarely the view must face them: the cosine of the angle off the camera's own forward. Nearer
   * than `near` a person is in reach whichever way the view points, as somebody standing on your toes is.
   */
  cone: 0.55,
  near: 1.2,
  /** A conversation ends once the two have come farther apart than this, metres. */
  keep: 6,
  /** Seconds the camera takes to come over the shoulder, and to go back. */
  easeIn: 0.5,
  easeOut: 0.35,
  /**
   * Where the camera stands, from the player's eye: `back` metres behind them along the line to the one
   * spoken to, `shoulder` metres to their right and `raise` above, looking at the other's face, which is
   * `face` of their height over their feet.
   */
  back: 1.5,
  shoulder: 0.55,
  raise: 0.08,
  face: 0.93,
  /** How far short of whatever is behind it the camera stops, and the nearest it comes to the eye, metres. */
  pad: 0.3,
  nearest: 0.45,
  /** Seconds a reply stands in the window after an answer that has one, before the view goes back. */
  replyFor: 1.4,
  /** Whether the one spoken to plays a greeting as the conversation opens. */
  greet: true,
};

/** Set any of the numbers at once, a number only ever by a number and a switch by a switch. */
export function tuneTalk(o?: Partial<typeof TALK_TUNE> | null): typeof TALK_TUNE {
  if (!o) return TALK_TUNE;
  const into = TALK_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (!(k in TALK_TUNE)) continue;
    const had = into[k];
    if (typeof had === 'number' && typeof v === 'number' && Number.isFinite(v)) into[k] = Math.max(0, v);
    else if (typeof had === 'boolean' && typeof v === 'boolean') into[k] = v;
  }
  return TALK_TUNE;
}

/**
 * The game's own greeting clips out of the humanoid pack's curated emotes, tried in this order: the
 * first the body's animator holds is played as it turns to answer. Clip names, not tuning.
 */
export const GREET_CLIPS: readonly string[] = ['emt_wave1', 'emt_nod_head_once', 'emt_conversation_1'];

/** What `whyNotTalk` reads of a body: a catalogue person satisfies it as it stands. */
export interface TalkBody {
  /** On the humanoid skeleton the catalogue stands its people on, and not a hologram (`Mobile.humanoid`). */
  readonly humanoid: boolean;
  readonly dead: boolean;
  readonly removed: boolean;
  /** Its model is up: a body still loading is nobody to talk to yet. */
  readonly ready: boolean;
  /** Another browser thinks for it: it may be spoken to, and not asked to follow (`talkOptions`). */
  readonly isDriven: boolean;
  /** The name the server shares it under, or '' for one this browser alone holds. */
  readonly npcId: string;
  /** A fixture the world cannot work without (a ticket collector). */
  readonly fixture: boolean;
  /** In a fight, or holding a grudge from one (`Mobile.engaged`). */
  readonly engaged: boolean;
  readonly side: Side;
  readonly aggression: Aggression;
}

/**
 * Why a body cannot be spoken to, in a few words, or null when it can. The order is the order the
 * reasons are worth hearing in: a thing that is not a person is that before it is anything else.
 */
export function whyNotTalk(b: TalkBody, player: Fighter): string | null {
  if (!b.humanoid) return 'not somebody to talk to';
  if (b.dead || b.removed) return 'gone';
  if (!b.ready) return 'not here yet';
  if (b.fixture) return 'at its post';
  if (b.side === 'hostile' || hostileSides(b, player)) return 'hostile';
  if (b.engaged) return 'in a fight';
  return null;
}

/**
 * How near a body is for the use key, measured the way the key reads it: across the ground from the
 * player's feet (`dx`, `dz`, and `dy` above them), with `fx`, `fz` the view's own forward across the
 * ground, a unit vector. NaN when it is out of reach -- too far, too far above or below, or off to the
 * side of the view past `cone` and not within `near` -- and otherwise the distance, so the nearest wins.
 *
 * `squarely` takes the `near` exemption away, so only a body inside the cone is in reach however close
 * it stands: what somebody following the player is asked, since a follower stands at the player's elbow
 * as a matter of course and would otherwise have the key every time the player stopped beside it.
 */
export function reachOf(dx: number, dy: number, dz: number, fx: number, fz: number, tune = TALK_TUNE, squarely = false): number {
  if (!(Math.abs(dy) <= tune.rise)) return Number.NaN;
  const d = Math.hypot(dx, dz);
  if (!(d <= tune.reach)) return Number.NaN;
  if (d < 1e-6) return squarely ? Number.NaN : d;
  if (d <= tune.near && !squarely) return d;
  const cos = (dx * fx + dz * fz) / d;
  return cos >= tune.cone ? d : Number.NaN;
}

/**
 * Which body the use key speaks to, of the nearest not following the player (`other`) and the nearest
 * following them (`follower`, already asked `squarely`): anybody else before a follower, whatever their
 * distances, and a follower only while nothing else in reach wants the key (`elseWants`: a vehicle, a
 * hull to board, a gate). A follower is company that stands beside everything the player walks up to,
 * and E at the speeder or the gate it happens to be standing by must still mean the speeder or the gate.
 * `elseWants` is asked only when it could matter.
 */
export function talkPick<T>(other: T | null, follower: T | null, elseWants: () => boolean): T | null {
  if (other) return other;
  if (!follower) return null;
  return elseWants() ? null : follower;
}

/** One answer in the window: what it is, its words, whether it may be chosen now and why not. */
export interface TalkOption {
  id: 'follow' | 'stay' | 'leave';
  label: string;
  enabled: boolean;
  why: string;
}

/** The answers' words: the owner's own, "Follow me" and "Stop talking", and their turn for a follower. */
export const TALK_WORDS = Object.freeze({
  follow: 'Follow me.',
  stay: 'Stop following me.',
  leave: 'Stop talking.',
  full: 'you have as much company as you can take',
  /** Said of a body another player's game is thinking for: it may be spoken to, and not asked to follow. */
  keptElsewhere: 'another player’s game is looking after them, so they will not follow you',
  /** Said of a body on the wire of a server too old to hear one walk off with a player: it stays at its post. */
  serverKeeps: 'this server cannot let them walk off with you, so they will not follow you',
});

/**
 * The answers on offer: to a follower, stop following; to anybody else, follow, which is refused in
 * words once as many follow as may, and of a body another player's game keeps (`keptElsewhere`); and
 * always the way out. Written into `out` when one is given.
 */
export function talkOptions(following: boolean, full: boolean, out: TalkOption[] = [], keptElsewhere = false): TalkOption[] {
  out.length = 0;
  if (following) out.push({ id: 'stay', label: TALK_WORDS.stay, enabled: true, why: '' });
  else {
    const why = keptElsewhere ? TALK_WORDS.keptElsewhere : full ? TALK_WORDS.full : '';
    out.push({ id: 'follow', label: TALK_WORDS.follow, enabled: !why, why });
  }
  out.push({ id: 'leave', label: TALK_WORDS.leave, enabled: true, why: '' });
  return out;
}

/** The answer a number key picks (1 is the first), or null for a number past the list or one that is refused. */
export function pickOption(options: readonly TalkOption[], n: number): TalkOption | null {
  if (!Number.isInteger(n) || n < 1 || n > options.length) return null;
  const o = options[n - 1];
  return o.enabled ? o : null;
}

/**
 * What people say. Invented, every word: a stranger's hello, a guard's, a follower's, and the two
 * replies. A side that keeps order (the Empire's, the Alliance's) speaks as a guard does.
 */
export const TALK_LINES = {
  hello: [
    'Yes? Something I can do for you?',
    'You look like you have come a long way.',
    'Keep it short, spacer. I have places to be.',
    'Another traveller. What brings you here?',
    'Hm? Oh. What is it?',
    'Mind the droids round here. They are touchier than they look.',
    'If it is trouble you want, look somewhere else.',
    'Good to see a face that is not trying to sell me something.',
  ],
  guard: ['Move along, citizen.', 'Papers in order? Then keep walking.', 'Make it quick. I am on duty.', 'Stay out of trouble and we will get along.'],
  follower: ['Where to next?', 'I am right behind you.', 'Say the word.', 'Still with you.'],
  follow: ['Lead the way.', 'All right. I am with you.', 'After you.'],
  stay: ['I will wait here, then.', 'Suit yourself.', 'Good luck out there.'],
};

/** Sides that speak as guards. */
const GUARD_SIDES: readonly Side[] = ['imperial', 'rebel'];

/** One line of a list by a number the caller owns (a body's key), the same line for the same number. */
export function lineOf(lines: readonly string[], seed: number): string {
  if (!lines.length) return '';
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return lines[(h >>> 0) % lines.length];
}

/** What a body says as it turns to answer: a follower's line, a guard's, or a stranger's. */
export function greetingOf(side: Side, following: boolean, seed: number): string {
  if (following) return lineOf(TALK_LINES.follower, seed);
  return lineOf(GUARD_SIDES.includes(side) ? TALK_LINES.guard : TALK_LINES.hello, seed);
}

/** Where the camera stands and what it looks at, written in place. */
export interface TalkShot {
  cx: number;
  cy: number;
  cz: number;
  lx: number;
  ly: number;
  lz: number;
  /** How far the camera stands from the eye, metres: what a block test pulls in along. */
  reach: number;
}

export function newTalkShot(): TalkShot {
  return { cx: 0, cy: 0, cz: 0, lx: 0, ly: 0, lz: 0, reach: 0 };
}

/**
 * The shot over the player's shoulder: from the player's eye (`px`, `py`, `pz`), `back` metres behind
 * them along the line across the ground to the other's face (`nx`, `ny`, `nz`), `shoulder` to their
 * right of that line and `raise` above the eye, looking at the face. Right is the screen's right for a
 * camera looking along that line (this game's forward is `(sin, cos)` and a camera looking down +z has
 * the world's -x on its right). Two bodies on top of each other take +z for the line.
 */
export function talkShot(px: number, py: number, pz: number, nx: number, ny: number, nz: number, out: TalkShot, tune = TALK_TUNE): TalkShot {
  let fx = nx - px;
  let fz = nz - pz;
  const flat = Math.hypot(fx, fz);
  if (flat < 1e-6) {
    fx = 0;
    fz = 1;
  } else {
    fx /= flat;
    fz /= flat;
  }
  const rx = -fz;
  const rz = fx;
  out.cx = px - fx * tune.back + rx * tune.shoulder;
  out.cy = py + tune.raise;
  out.cz = pz - fz * tune.back + rz * tune.shoulder;
  out.lx = nx;
  out.ly = ny;
  out.lz = nz;
  out.reach = Math.hypot(out.cx - px, out.cy - py, out.cz - pz);
  return out;
}

/**
 * How far out along its line the camera may stand when something is in the way `hit` metres out
 * (null for nothing): short of it by `pad`, never nearer the eye than `nearest`, never farther than it
 * asked for. The orbit's own rule, with the conversation's numbers.
 */
export function pullIn(reach: number, hit: number | null, tune = TALK_TUNE): number {
  if (hit === null || !(hit < reach + tune.pad)) return reach;
  return Math.max(Math.min(tune.nearest, reach), Math.min(reach, hit - tune.pad));
}

/**
 * The camera's share of the way over the shoulder, moved toward `want` (0 or 1) at a steady rate that
 * crosses the whole way in `easeIn` seconds going in and `easeOut` coming back. A rate of nought or
 * less is there at once.
 */
export function stepBlend(blend: number, want: number, dt: number, tune = TALK_TUNE): number {
  const seconds = want > blend ? tune.easeIn : tune.easeOut;
  if (!(seconds > 0)) return want;
  const step = Math.max(0, dt) / seconds;
  return want > blend ? Math.min(want, blend + step) : Math.max(want, blend - step);
}

/** The eased share the picture is drawn at, smooth at both ends. */
export function easeShare(blend: number): number {
  const s = Math.min(1, Math.max(0, blend));
  return s * s * (3 - 2 * s);
}
