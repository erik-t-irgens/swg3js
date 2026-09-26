// Which few things you can do right now, and nothing else.
//
// The bottom line of the screen used to be one long string rebuilt every frame: every key you could
// press, your speed, your hull, your heat, your wings and why a landing was refused, all at once. The
// readouts have their own places on the display now, so what is left is the short list of things you
// can actually press here — at most four, each a key and two or three words.
//
// This module is the choosing, and nothing else: no DOM, no three, no imports at all. It is handed a
// flat description of where the player is standing and it fills a preallocated array. That makes it
// testable outside a browser, which the chain of template literals it replaces never was, and it makes
// it free: no string is built, no object is made, and the same array comes back every time.
//
// The words are ours. So is every rule about which action wins when two of them want the same key.

/**
 * The most cells the bar is ever built with. The bar makes its cells once, at whatever `PROMPT.slots`
 * said then, so a larger number set afterwards cannot grow it: the live setter is clamped to this
 * rather than taking a number that would quietly do nothing. Lowering `slots` does work and is what
 * the console is for.
 */
export const PROMPT_MAX_SLOTS = 4;

/**
 * How many actions the bar shows, and how long a label may be.
 *
 * `slots` is the design's own answer and the reason the bar can replace the long line at all: flying a
 * ship the old line genuinely carried four things you could press (let go, set it down, cut the
 * engines, the ship menu), and three would have dropped one. `maxLabel` is invented — it is the width
 * at which a label stops being two or three words and starts being a sentence, and it is here so that a
 * label added later cannot quietly widen the bar. Both are live, so they can be tried from the console.
 *
 * How often a second the state behind the bar is gathered is deliberately not one of these. It is the
 * frame loop's business and it lives with the other rates the loop keeps, where it is read: a number
 * with two homes is a number the console can set without anything happening.
 */
export const PROMPT = {
  /** Actions shown at once. Between one and `PROMPT_MAX_SLOTS`, which is what the bar was built with. */
  slots: PROMPT_MAX_SLOTS,
  /** Invented: characters a label may run to. Only the tests read it; nothing cuts a label at run time. */
  maxLabel: 22,
};

/** Set any of the live numbers at once (the console's one call), clamped to what makes sense. */
export function tunePrompt(o: Partial<typeof PROMPT>): typeof PROMPT {
  if (typeof o.slots === 'number' && Number.isFinite(o.slots)) PROMPT.slots = Math.max(1, Math.min(PROMPT_MAX_SLOTS, Math.round(o.slots)));
  if (typeof o.maxLabel === 'number' && Number.isFinite(o.maxLabel)) PROMPT.maxLabel = Math.max(4, Math.round(o.maxLabel));
  return PROMPT;
}

/**
 * One thing you can press. `action` is a binding's name, so the cap shows the key you have bound rather
 * than a key written into the words; `code` is a bare key for the one thing that has no binding of its
 * own yet (the engine cut), and is read only when `action` is empty. `label` is always one of the
 * constants below, never a string built here.
 */
export interface PromptAction {
  action: string;
  code: string;
  label: string;
}

/** A fresh slot, empty. The caller makes `PROMPT.slots` of these once and the fill writes into them. */
export function newPromptAction(): PromptAction {
  return { action: '', code: '', label: '' };
}

/** The array the fill writes into: made once, at the size the bar shows. */
export function newPromptActions(n: number = PROMPT.slots): PromptAction[] {
  const out: PromptAction[] = [];
  for (let i = 0; i < Math.max(1, Math.round(n)); i++) out.push(newPromptAction());
  return out;
}

/** The vehicle ridden or flown from a bridge, as the rules need it. Filled in place, never rebuilt. */
export interface PromptVehicle {
  /** 'ship', 'ground', 'air', 'mount', … — the game's own word for the kind. */
  kind: string;
  /** A ship, as against a speeder or a creature: only a ship is set down, cut or given wings. */
  ship: boolean;
  /** Out in space, where there is no ground and the same key sets it down on whatever is under it. */
  space: boolean;
  /** Resting on the ground, being set down, and up off it. */
  landed: boolean;
  holding: boolean;
  airborne: boolean;
  /** Whether a ship can be set down at all here, and whether there is anything under it to set down on. */
  canLand: boolean;
  setDownNear: boolean;
  /** Engines running: the cut is only worth offering while there is something to cut. */
  powered: boolean;
  /** Wings that open, and whether the pilot has chosen them open. */
  wings: boolean;
  wingsOpen: boolean;
  /** Guns, which is what makes the next target worth offering. */
  guns: boolean;
  /** A hop, and a boost of either kind. */
  hop: boolean;
  boost: boolean;
  /** The key that cuts a flying ship's engines. It has no binding of its own, so it comes in as a key. */
  cutKey: string;
}

/** A vehicle struct with nothing in it: the caller keeps one and fills it. */
export function newPromptVehicle(): PromptVehicle {
  return {
    kind: '',
    ship: false,
    space: false,
    landed: false,
    holding: false,
    airborne: false,
    canLand: false,
    setDownNear: false,
    powered: false,
    wings: false,
    wingsOpen: false,
    guns: false,
    hop: false,
    boost: false,
    cutKey: '',
  };
}

/** What a jump has taken over: the tunnel locks most of what you could otherwise press. */
export type PromptJump = 'none' | 'lift' | 'piloting' | 'controls' | 'waiting';

/** What is beside you on foot, in the order the game already decides it. */
export type PromptNear = '' | 'board' | 'mount' | 'flip';

/** Whether the ship menu is worth offering here, and whether reaching it is news. */
export type PromptShipMenu = '' | 'here' | 'altitude';

/**
 * Where the player is standing, flat. Every field is a boolean, a number or one of the small string
 * unions above, so the caller can gather it into one kept struct a few times a second and hand the same
 * struct over every time. Nothing in here is a game object and nothing in here is built.
 */
export interface PromptState {
  /** The game is simulating: false empties the bar (a panel, the death card, the loading screen). */
  live: boolean;
  /** Flying free of the world. */
  noclip: boolean;
  /** A jump's own line, which wins over everything else. */
  jump: PromptJump;
  /** Seated in a vehicle, or at a ship's bridge controls on foot. `vehicle` says which vehicle. */
  mounted: boolean;
  piloting: boolean;
  vehicle: PromptVehicle;
  /** Standing in a lift shaft, at an elevator, or beside a building with no way in on foot. */
  lift: boolean;
  elevator: '' | 'up' | 'down';
  doorless: boolean;
  /**
   * Which of a port's three things is within reach: the terminal a ticket is bought at, the
   * collector it is handed to outside, or the terminal the player's own ship answers to.
   *
   * They were one boolean and one word, "the shuttle", which named none of the three and was wrong
   * about all of them. They are mutually exclusive where they are gathered -- the terminal wins over
   * the collector, and the ship terminal is only reached when neither is there -- which is the same
   * chain the key itself takes, so one field with four values is the shape and not three booleans.
   */
  travel: '' | 'terminal' | 'collector' | 'ship';
  /**
   * Standing at one of the gates a world's zones are walked between: 'travel' where the pack names
   * a destination and 'nowhere' where it does not. It carries no place name, deliberately — a cap
   * wears a word from the table below and never the name of what you are looking at, so where the
   * gate leads is said on the message line as you come to it and on the long line in full.
   */
  gate: '' | 'travel' | 'nowhere';
  /** The gravity boots hold a surface out in space; `bootsReach` is a ship close enough to climb into. */
  boots: boolean;
  bootsReach: boolean;
  /** In a ship's rooms, and within reach of its controls. */
  aboard: boolean;
  atControls: boolean;
  /** Adrift in space on foot. */
  eva: boolean;
  /** A vehicle within reach, and what pressing the key would do with it. */
  near: PromptNear;
  /** The ship menu. 'altitude' is the moment the sky is high enough for space, which is worth saying. */
  shipMenu: PromptShipMenu;
}

/** A state struct with nothing in it: the caller keeps one and fills it. */
export function newPromptState(): PromptState {
  return {
    live: false,
    noclip: false,
    jump: 'none',
    mounted: false,
    piloting: false,
    vehicle: newPromptVehicle(),
    lift: false,
    elevator: '',
    doorless: false,
    travel: '',
    gate: '',
    boots: false,
    bootsReach: false,
    aboard: false,
    atControls: false,
    eva: false,
    near: '',
    shipMenu: '',
  };
}

/** Everything back to nothing, the vehicle included, without making a new struct. */
export function resetPromptState(s: PromptState): PromptState {
  s.live = false;
  s.noclip = false;
  s.jump = 'none';
  s.mounted = false;
  s.piloting = false;
  s.lift = false;
  s.elevator = '';
  s.doorless = false;
  s.travel = '';
  s.gate = '';
  s.boots = false;
  s.bootsReach = false;
  s.aboard = false;
  s.atControls = false;
  s.eva = false;
  s.near = '';
  s.shipMenu = '';
  const v = s.vehicle;
  v.kind = '';
  v.ship = false;
  v.space = false;
  v.landed = false;
  v.holding = false;
  v.airborne = false;
  v.canLand = false;
  v.setDownNear = false;
  v.powered = false;
  v.wings = false;
  v.wingsOpen = false;
  v.guns = false;
  v.hop = false;
  v.boost = false;
  v.cutKey = '';
  return s;
}

/**
 * Every word the bar can say, frozen at module scope so that filling it allocates nothing, ever. They
 * are ours: short, lower case, and in the voice the rest of the game speaks in. A label is the thing
 * that happens, not the thing you are looking at — "set it down", never "landing gear".
 */
export const PROMPT_WORDS = Object.freeze({
  // On foot and beside things.
  board: 'board',
  mount: 'mount',
  flip: 'flip it upright',
  lift: 'the lift',
  up: 'up a level',
  down: 'down a level',
  inside: 'go inside',
  // A port's three things, each named for itself. The cap says what you are standing at, not where it
  // goes: where is a list of places and fares, which is what the panel is for. They were one word,
  // "the shuttle", which was the wrong noun for all three -- a terminal is not a shuttle, and the
  // one thing at a port that really is a shuttle is the thing the collector puts you on.
  ticketTerminal: 'the ticket terminal',
  collector: 'the ticket collector',
  shipTerminal: 'the ship terminal',
  // A gate between two of a world's zones. The cap says what happens, never where it goes: the
  // destination is a place name, which is the thing you are looking at, and it is said on the
  // message line as you come to the gate and written in full on the long line.
  gate: 'through the gate',
  gateNowhere: 'the gate (nowhere)',
  stepOut: 'step out',
  takeControls: 'take the controls',
  climbIn: 'climb in',
  bootsOff: 'boots off',
  bootsOn: 'gravity boots',
  letGoSurface: 'let go',
  brake: 'brake',
  // In a vehicle.
  leave: 'leave',
  letGo: 'let go',
  dismount: 'dismount',
  liftOff: 'lift off',
  bringDown: 'bring it down',
  setDown: 'set it down',
  cutEngines: 'cut the engines',
  openWings: 'open the wings',
  closeWings: 'close the wings',
  nextTarget: 'next target',
  hop: 'hop',
  boost: 'boost',
  // Everywhere.
  shipMenu: 'ship menu',
  noclipOff: 'noclip off',
  faster: 'faster',
  slower: 'slower',
});

/**
 * How far the fill may go. It is the one thing `push` needs that is the same for a whole fill, and it
 * is a number rather than a closed-over variable because a closure made inside the fill would itself be
 * an allocation, and this runs in the frame loop. Nothing else is kept between calls: the array being
 * written is handed to `push` and let go of again, so the bar's slots are not held by this module and
 * two bars could fill without ever seeing each other's.
 */
let fillCap = 0;

/**
 * Offer an action, and give back the new count. It is dropped when the bar is full, and dropped when
 * something already on the bar wears the same binding: two words under one cap is worse than one word.
 *
 * This catches two actions that name the same binding, which is all the rules can see. Two *different*
 * bindings the owner has put on one key look different here and are caught by the bar itself, which is
 * the only place that knows what each binding resolved to.
 */
function push(out: PromptAction[], n: number, action: string, label: string, code: string = ''): number {
  if (n >= fillCap) return n;
  for (let i = 0; i < n; i++) {
    const had = out[i];
    if (action ? had.action === action : had.action === '' && had.code === code) return n;
  }
  const slot = out[n];
  slot.action = action;
  slot.code = code;
  slot.label = label;
  return n + 1;
}

/**
 * Fill `out` with the actions on offer, newest state in, and give back how many were written. The array
 * is the caller's and is never grown or replaced: past its length an action is simply not shown, which
 * is what makes the count the one thing to read.
 *
 * The order the states are asked in is the order the long line asked them in, so nothing it used to say
 * can be reached in a state where the bar says something else instead. Inside a state the order is
 * ours: the key you press to get out or get in comes first, because it is the one that is nearly always
 * there and the eye learns where it stands.
 *
 * Two actions never share a binding: an action whose binding (or bare key) is already on the bar is
 * dropped. That is why standing in a lift shaft aboard a ship offers the lift and not the way out — as
 * the long line did — rather than the same cap twice with two different words. Two different bindings
 * the owner has put on one key are caught by the bar, which is the only thing that knows the codes.
 */
export function fillActions(s: PromptState, out: PromptAction[]): number {
  // How far the fill may go is the one thing kept outside it, so that `push` need not be handed it on
  // every call; the array itself is threaded through, so nothing here holds the caller's slots after
  // the fill returns. The fill is never reentered: it calls nothing but `push`.
  fillCap = Math.min(out.length, Math.max(1, Math.round(PROMPT.slots)));
  let n = 0;
  if (!s.live) return 0;
  const W = PROMPT_WORDS;

  // A jump has the controls: what the crew can do in the tunnel, and nothing else.
  if (s.jump !== 'none') {
    if (s.jump === 'lift') n = push(out, n, 'mount', W.lift);
    else if (s.jump === 'piloting') n = push(out, n, 'mount', W.letGo);
    else if (s.jump === 'controls') n = push(out, n, 'mount', W.takeControls);
    return n;
  }

  // Flying free of the world: out of it, and the two keys that change how fast.
  if (s.noclip) {
    n = push(out, n, 'noclip', W.noclipOff);
    n = push(out, n, 'noclipFaster', W.faster);
    n = push(out, n, 'noclipSlower', W.slower);
    return n;
  }

  // Seated in a vehicle, or standing at a ship's bridge controls. Both fly the same hull.
  if (s.mounted || s.piloting) {
    const v = s.vehicle;
    const out1 = s.piloting ? W.letGo : v.ship ? W.leave : W.dismount;
    n = push(out, n, 'mount', out1);
    if (!v.ship) {
      if (v.hop) n = push(out, n, 'jump', W.hop);
      if (v.boost) n = push(out, n, 'walk', W.boost);
      return n;
    }
    // Down on the ground, or on its way down: what gets it up again is the whole of it.
    if (v.landed) {
      n = push(out, n, 'forward', W.liftOff);
      if (s.shipMenu) n = push(out, n, 'ship', W.shipMenu);
      return n;
    }
    if (v.holding) return n;
    // Reaching the height where space is open is news, and it is the only time the menu comes first.
    if (s.shipMenu === 'altitude') n = push(out, n, 'ship', W.shipMenu);
    // The same key does two different things with a hull in flight, and the bar must name the one it
    // will really do. On a planet it cuts the engines and the way down is its own key. Out in space
    // there is no down: the key asks for a set-down on whatever the hull has come to a stop over, and
    // it is worth offering only while something is under it. So the engine cut is a planet's word
    // alone; offered in space it would name an action the key cannot perform, which is the one thing
    // a bar of bound keys must never do.
    if (v.canLand) {
      if (v.space) {
        if (v.setDownNear) n = push(out, n, '', W.setDown, v.cutKey);
      } else {
        n = push(out, n, 'crouch', W.bringDown);
        if (v.powered) n = push(out, n, '', W.cutEngines, v.cutKey);
      }
    }
    if (v.wings) n = push(out, n, 'wings', v.wingsOpen ? W.closeWings : W.openWings);
    if (s.shipMenu) n = push(out, n, 'ship', W.shipMenu);
    if (v.guns) n = push(out, n, 'target', W.nextTarget);
    return n;
  }

  // On foot. A lift shaft, an elevator and a doorless building all want the same key, so the one
  // underfoot wins, exactly as it does today.
  if (s.lift) n = push(out, n, 'mount', W.lift);
  else if (s.elevator) n = push(out, n, 'mount', s.elevator === 'down' ? W.down : W.up);
  else if (s.doorless) n = push(out, n, 'mount', W.inside);
  // A port's own things are the last of the four to have the key, exactly as the game's own dispatch
  // orders them: a lift shaft, an elevator and a doorway are all underfoot and all outrank a terminal
  // you have walked up to.
  else if (s.travel) n = push(out, n, 'mount', s.travel === 'collector' ? W.collector : s.travel === 'ship' ? W.shipTerminal : W.ticketTerminal);

  if (s.boots) {
    // The boots hold a surface out in space: a ship beside you is climbed into, otherwise they come off.
    n = push(out, n, 'mount', s.bootsReach ? W.climbIn : W.bootsOff);
    n = push(out, n, 'jump', W.letGoSurface);
  } else if (s.aboard) {
    n = push(out, n, 'mount', s.atControls ? W.takeControls : W.stepOut);
  } else if (s.eva) {
    // Adrift, the key takes whatever is in reach first and only then puts the boots on. Anything in
    // reach at all is mounted or boarded: a hull on its back means nothing where there is no down,
    // and the game mounts it just the same, so "flip it upright" would be a word for nothing.
    n = push(out, n, 'mount', s.near ? (s.near === 'board' ? W.board : W.mount) : W.bootsOn);
    n = push(out, n, 'brake', W.brake);
  } else if (s.near) {
    n = push(out, n, 'mount', s.near === 'board' ? W.board : s.near === 'flip' ? W.flip : W.mount);
  }
  // The gate between two of a world's zones is the last thing the key can mean, which is why it is
  // asked last: a lift, an elevator, a way into a building, a vehicle or a hull in reach has already
  // taken the cap by then and `push` drops this outright. The gather stands the gate down in that
  // case as well, in `zoneGates.ts`, so the key never does one thing and say another; offering it
  // here last is the same rule written where the bar can be driven and checked.
  if (s.gate) n = push(out, n, 'mount', s.gate === 'travel' ? W.gate : W.gateNowhere);
  if (s.shipMenu) n = push(out, n, 'ship', W.shipMenu);
  return n;
}
