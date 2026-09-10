// Jedi Academy's lightsaber move system, translated from OpenJK's codemp/game/bg_saber.c and
// bg_pmove.c: the saberMoveData table (attacks, starts, returns, the arcs between quadrants and
// the special moves), transitionMove, PM_SaberAttackForMovement with its special-move checks
// (lunges, jump attacks, cartwheels, butterflies, backflip attacks, back attacks, the dual
// mirror attacks), PM_CanDoKata and the katas, PM_KickMoveForConditions for the staff's kicks,
// the roll stab, PM_SaberAnimTransitionAnim, PM_SaberKataDone and the style speed rules of
// BG_SaberStartTransAnim. A swing is a quadrant-to-quadrant move; the direction keys pick the
// swing, holding attack chains the next one through a transition arc, and each style (fast,
// medium, strong, dual, staff) has its own animations, speed and chain length.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).

export type Quad = 'BR' | 'R' | 'TR' | 'T' | 'TL' | 'L' | 'BL' | 'B';
export type MoveKind = 'none' | 'ready' | 'attack' | 'start' | 'return' | 'transition' | 'special';
export type SaberStyle = 'fast' | 'medium' | 'strong' | 'dual' | 'staff';
export type Dir = 'F' | 'B' | 'L' | 'R';

/** Metres per Quake unit, for the speeds the moves set. */
const UNIT = 0.0254;

/** A push a special move gives the body, in units a second: along the facing, to the right, and up (null keeps the vertical speed). */
export interface Impulse {
  forward: number;
  right: number;
  up: number | null;
}

/**
 * Motion a move plays out over its length, in seconds from its start: a forward or sideways
 * push while a window lasts, and hops (a vertical speed set while on the ground) in others.
 * The dual and staff leaps use these, as PM_CheckDualForwardJumpDuck's caller does.
 */
export interface MoveScript {
  forward?: { from: number; to: number; amount?: number }[];
  right?: [number, number, 1 | -1];
  hops?: { from: number; to: number; vy: number }[];
}

export interface SaberMove {
  name: string;
  /** Animation for the fast style; the style digit is swapped in for the others. */
  anim: string;
  start: Quad;
  end: Quad;
  kind: MoveKind;
  /** Blend into the animation, in milliseconds. */
  blend: number;
  /** Next move when attack is not held when this one ends, and when it is. */
  chainIdle: string;
  chainAttack: string;
  /** A kick: hurts with the foot in this direction rather than with the blade. */
  kick?: Dir;
  /** The move's own motion over time. */
  script?: MoveScript;
  /** A kata: the long spinning specials, which cost the most Force and cannot be chained. */
  kata?: boolean;
}

const QUADS: Quad[] = ['BR', 'R', 'TR', 'T', 'TL', 'L', 'BL', 'B'];
/** Quadrant codes as the animation names spell them. */
const CODE: Record<Quad, string> = { BR: 'BR', R: '_R', TR: 'TR', T: 'T_', TL: 'TL', L: '_L', BL: 'BL', B: 'B_' };

/** The attack that starts from a quadrant (PM_AttackMoveForQuad). */
export function attackForQuad(q: Quad): string {
  switch (q) {
    case 'B':
    case 'BR':
      return 'A_BR2TL';
    case 'R':
      return 'A_R2L';
    case 'TR':
      return 'A_TR2BL';
    case 'T':
      return 'A_T2B';
    case 'TL':
      return 'A_TL2BR';
    case 'L':
      return 'A_L2R';
    case 'BL':
      return 'A_BL2TR';
  }
}

/** The return-to-ready move that begins in a quadrant (as the transition table's chain_idle column uses them). */
const RETURN_FROM: Record<Quad, string> = { BR: 'R_TL2BR', R: 'R_L2R', TR: 'R_BL2TR', T: 'R_BL2TR', TL: 'R_BR2TL', L: 'R_R2L', BL: 'R_TR2BL', B: 'R_T2B' };

export const MOVES = new Map<string, SaberMove>();
function def(m: SaberMove): void {
  MOVES.set(m.name, m);
}
def({ name: 'NONE', anim: 'BOTH_STAND1', start: 'R', end: 'R', kind: 'none', blend: 350, chainIdle: 'NONE', chainAttack: 'NONE' });
def({ name: 'READY', anim: 'BOTH_STAND2', start: 'R', end: 'R', kind: 'ready', blend: 350, chainIdle: 'READY', chainAttack: 'S_R2L' });
// The seven attacks: top-left to bottom-right and so on.
const ATTACKS: [string, string, Quad, Quad, number][] = [
  ['A_TL2BR', 'BOTH_A1_TL_BR', 'TL', 'BR', 100],
  ['A_L2R', 'BOTH_A1__L__R', 'L', 'R', 100],
  ['A_BL2TR', 'BOTH_A1_BL_TR', 'BL', 'TR', 50],
  ['A_BR2TL', 'BOTH_A1_BR_TL', 'BR', 'TL', 100],
  ['A_R2L', 'BOTH_A1__R__L', 'R', 'L', 100],
  ['A_TR2BL', 'BOTH_A1_TR_BL', 'TR', 'BL', 100],
  ['A_T2B', 'BOTH_A1_T__B_', 'T', 'B', 100],
];
for (const [name, anim, start, end, blend] of ATTACKS) {
  const ret = `R_${name.slice(2)}`;
  def({ name, anim, start, end, kind: 'attack', blend, chainIdle: ret, chainAttack: ret });
  // Its wind-up from ready, and its return to ready.
  def({ name: `S_${name.slice(2)}`, anim: `BOTH_S1_S1_${CODE[start]}`, start: 'R', end: start, kind: 'start', blend: 100, chainIdle: name, chainAttack: name });
  def({ name: ret, anim: `BOTH_R1_${CODE[end]}_S1`, start: end, end: 'R', kind: 'return', blend: 100, chainIdle: 'READY', chainAttack: 'READY' });
}
// Arcs from the end of one swing to the start of the next.
for (const from of QUADS) {
  if (from === 'B') continue;
  for (const to of QUADS) {
    if (to === 'B' || to === from) continue;
    def({ name: `T_${from}_${to}`, anim: `BOTH_T1_${CODE[from]}_${CODE[to]}`, start: from, end: to, kind: 'transition', blend: 100, chainIdle: RETURN_FROM[to], chainAttack: attackForQuad(to) });
  }
}
// Special attacks, one animation whatever the style (the saberMoveData rows from LS_A_BACKSTAB on).
function special(name: string, anim: string, start: Quad, end: Quad, chainAttack = 'READY', extra: Partial<SaberMove> = {}): void {
  def({ name, anim, start, end, kind: 'special', blend: 100, chainIdle: 'READY', chainAttack, ...extra });
}
special('A_BACKSTAB', 'BOTH_A2_STABBACK1', 'R', 'R');
special('A_BACK', 'BOTH_ATTACK_BACK', 'R', 'R');
special('A_BACK_CR', 'BOTH_CROUCHATTACKBACK1', 'R', 'R');
special('ROLL_STAB', 'BOTH_ROLL_STAB', 'R', 'R');
special('A_LUNGE', 'BOTH_LUNGE2_B__T_', 'B', 'T');
// The strong leap always comes back through the overhead's return (PM_WeaponLightsaber).
special('A_JUMP_T2B', 'BOTH_FORCELEAP2_T__B_', 'T', 'B', 'R_T2B', { chainIdle: 'R_T2B' });
special('A_FLIP_STAB', 'BOTH_JUMPFLIPSTABDOWN', 'R', 'T', 'T_T_R');
special('A_FLIP_SLASH', 'BOTH_JUMPFLIPSLASHDOWN1', 'L', 'R', 'T_R_T');
// The dual leap (42 frames): runs forward through its middle and hops twice off the ground.
special('JUMPATTACK_DUAL', 'BOTH_JUMPATTACK6', 'R', 'BL', 'T_BL_TR', { script: { forward: [{ from: 0.25, to: 2.0 }], hops: [{ from: 0.4, to: 0.5, vy: 250 }, { from: 0.95, to: 1.2, vy: 250 }] } });
special('JUMPATTACK_ARIAL_LEFT', 'BOTH_ARIAL_LEFT', 'R', 'TL', 'A_TL2BR');
special('JUMPATTACK_ARIAL_RIGHT', 'BOTH_ARIAL_RIGHT', 'R', 'TR', 'A_TR2BL');
special('JUMPATTACK_CART_LEFT', 'BOTH_CARTWHEEL_LEFT', 'R', 'TL', 'T_TL_BR');
special('JUMPATTACK_CART_RIGHT', 'BOTH_CARTWHEEL_RIGHT', 'R', 'TR', 'T_TR_BL');
// The staff's forward butterflies (56 frames) run forward and hop once.
special('JUMPATTACK_STAFF_LEFT', 'BOTH_BUTTERFLY_FL1', 'R', 'L', 'T_L_R', { script: { forward: [{ from: 0.25, to: 2.7 }], hops: [{ from: 1.0, to: 1.1, vy: 250 }] } });
special('JUMPATTACK_STAFF_RIGHT', 'BOTH_BUTTERFLY_FR1', 'R', 'R', 'T_R_L', { script: { forward: [{ from: 0.25, to: 2.7 }], hops: [{ from: 1.0, to: 1.1, vy: 250 }] } });
// The staff's sideways butterflies keep pushing sideways and hop again in the middle.
special('BUTTERFLY_LEFT', 'BOTH_BUTTERFLY_LEFT', 'R', 'L', 'T_L_R', { script: { right: [0, 1.85, -1], hops: [{ from: 0.9, to: 1.1, vy: 350 }] } });
special('BUTTERFLY_RIGHT', 'BOTH_BUTTERFLY_RIGHT', 'R', 'R', 'T_R_L', { script: { right: [0, 2.35, 1], hops: [{ from: 1.0, to: 1.1, vy: 250 }] } });
special('A_BACKFLIP_ATK', 'BOTH_JUMPATTACK7', 'B', 'T', 'T_T_R');
special('SPINATTACK_DUAL', 'BOTH_SPINATTACK6', 'R', 'R');
special('SPINATTACK', 'BOTH_SPINATTACK7', 'L', 'R');
for (const d of ['F', 'B', 'R', 'L'] as Dir[]) {
  special(`KICK_${d}`, `BOTH_A7_KICK_${d}`, 'R', 'R', 'S_R2L', { kick: d });
  special(`KICK_${d}_AIR`, `BOTH_A7_KICK_${d}_AIR`, 'R', 'R', 'S_R2L', { kick: d });
}
// The katas move on their own (PM_MoveForKata): the staff's spins forward at half speed and hops,
// the medium one steps forward twice, the strong one once.
special('DUAL_SPIN_PROTECT', 'BOTH_A6_SABERPROTECT', 'R', 'R', 'READY', { kata: true });
special('STAFF_SOULCAL', 'BOTH_A7_SOULCAL', 'R', 'R', 'READY', { kata: true, script: { forward: [{ from: 0, to: 1.25, amount: 0.5 }], hops: [{ from: 1.15, to: 1.35, vy: 250 }] } });
special('A1_SPECIAL', 'BOTH_A1_SPECIAL', 'R', 'R', 'READY', { kata: true });
special('A2_SPECIAL', 'BOTH_A2_SPECIAL', 'R', 'R', 'READY', { kata: true, script: { forward: [{ from: 0.1, to: 0.5 }, { from: 1.9, to: 2.3 }] } });
special('A3_SPECIAL', 'BOTH_A3_SPECIAL', 'R', 'R', 'READY', { kata: true, script: { forward: [{ from: 0.75, to: 1.45 }] } });
special('DUAL_FB', 'BOTH_A6_FB', 'R', 'R');
special('DUAL_LR', 'BOTH_A6_LR', 'R', 'R');

/** transitionMove[end][start]: the arc between two quadrants, or none when they are the same. */
export function transitionBetween(end: Quad, start: Quad): string {
  const e = end === 'B' ? 'BL' : end;
  const s = start === 'B' ? 'BL' : start;
  return e === s ? 'NONE' : `T_${e}_${s}`;
}

/** saberMoveTransitionAngle: how far the saber has to swing round between two quadrants, in degrees. */
const ANGLE: number[][] = [
  [0, 45, 90, 135, 180, 215, 270, 45],
  [45, 0, 45, 90, 135, 180, 215, 90],
  [90, 45, 0, 45, 90, 135, 180, 135],
  [135, 90, 45, 0, 45, 90, 135, 180],
  [180, 135, 90, 45, 0, 45, 90, 135],
  [215, 180, 135, 90, 45, 0, 45, 90],
  [270, 215, 180, 135, 90, 45, 0, 45],
  [45, 90, 135, 180, 135, 90, 45, 0],
];
export function chainAngle(from: string, to: string): number {
  const a = MOVES.get(from);
  const b = MOVES.get(to);
  if (!a || !b) return -1;
  return ANGLE[QUADS.indexOf(a.end)][QUADS.indexOf(b.start)];
}

const irand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** PM_SaberKataDone: whether the chain has run long enough that the next swing has to wait for a return. */
export function kataDone(style: SaberStyle, chainCount: number, cur: string, next: string): boolean {
  // The staff and the dual sabers chain without end.
  if (style === 'staff' || style === 'dual') return false;
  if (style === 'strong') {
    if (cur === 'NONE' || next === 'NONE') return chainCount > irand(0, 1);
    if (chainCount > irand(2, 3)) return true;
    if (chainCount > 0) {
      const angle = chainAngle(cur, next);
      if (angle < 135 || angle > 215) return true;
      if (angle === 180) return chainCount > 1;
      return chainCount > 2;
    }
    return false;
  }
  if (['A_TL2BR', 'A_L2R', 'A_BL2TR', 'A_BR2TL', 'A_R2L', 'A_TR2BL'].includes(next)) {
    const tolerance = style === 'fast' ? 5 : 3;
    if (chainCount >= tolerance && irand(1, chainCount) > tolerance) return true;
  }
  if (style === 'medium' && chainCount > irand(2, 5)) return true;
  return false;
}

const SEVEN = ['A_TL2BR', 'A_L2R', 'A_BL2TR', 'A_BR2TL', 'A_R2L', 'A_TR2BL', 'A_T2B'];
const isAttack = (m: string) => SEVEN.includes(m);
const isReturn = (m: string) => m.startsWith('R_');
const isStart = (m: string) => m.startsWith('S_');
const isTransition = (m: string) => m.startsWith('T_');

/** PM_SaberAnimTransitionAnim: the move that actually plays when `next` is asked for after `cur`. */
export function transitionMove(style: SaberStyle, chainCount: number, cur: string, next: string): string {
  let ret = next;
  if (cur === 'READY') {
    if (isAttack(next)) ret = `S_${next.slice(2)}`;
  } else if (next === 'READY') {
    if (isAttack(cur)) ret = `R_${cur.slice(2)}`;
  } else if (isAttack(next)) {
    const c = MOVES.get(cur)!;
    const n = MOVES.get(next)!;
    if (next === cur) {
      ret = kataDone(style, chainCount, cur, next) ? `R_${next.slice(2)}` : transitionBetween(c.end, n.start);
    } else if (c.end === n.start) {
      ret = next;
    } else if (isAttack(cur) || isReturn(cur)) {
      ret = transitionBetween(c.end, n.start);
    }
  }
  return ret === 'NONE' ? next : ret;
}

export interface AttackContext {
  /** -1..1 command along forward and right. */
  fmove: number;
  smove: number;
  grounded: boolean;
  /** Vertical speed in metres per second and height above ground in metres. */
  vy: number;
  aboveGround: number;
  jumpHeld: boolean;
  crouch: boolean;
  /** Attack held (the special jump attacks want it), and the Force pool. */
  attack?: boolean;
  force?: number;
  /** Whether an enemy stands within `radius` metres in a direction (PM_CheckEnemyPresence, PM_CanBackstab). */
  enemyNear?: (dir: Dir, radius: number) => boolean;
}

/** A move picked for the command, with the push it gives the body and the Force it costs. */
export interface Selection {
  move: string;
  impulse?: Impulse;
  forceCost?: number;
}

/** The Force the special moves cost (SABER_ALT_ATTACK_POWER and its _FB and _LR variants). */
export const ALT_ATTACK_POWER = { kata: 50, sideways: 10, forwardBack: 25 };

/**
 * PM_SaberAttackForMovement: which swing the direction keys ask for, including the special
 * moves the keys, the air and the style allow. `cur` is the move playing now.
 */
export function attackForMovement(style: SaberStyle, ctx: AttackContext, cur = 'READY'): Selection {
  const vy = ctx.vy / UNIT;
  const above = ctx.aboveGround / UNIT;
  const force = ctx.force ?? 100;
  const canFB = force >= ALT_ATTACK_POWER.forwardBack;
  const busy = isTransition(cur) || isStart(cur) || isAttack(cur);
  let sel: Selection;
  if (ctx.smove > 0) {
    if (ctx.attack && vy > 20 && above < 70 && ctx.jumpHeld && force >= ALT_ATTACK_POWER.sideways) {
      // Rising just off the ground while strafing: the cartwheel (the staff's butterfly).
      sel = style === 'staff' ? { move: 'BUTTERFLY_RIGHT', impulse: { forward: 0, right: 190, up: 350 }, forceCost: ALT_ATTACK_POWER.sideways } : { move: 'JUMPATTACK_ARIAL_RIGHT', impulse: { forward: 0, right: 190, up: 300 }, forceCost: ALT_ATTACK_POWER.sideways };
    } else sel = { move: ctx.fmove > 0 ? 'A_TL2BR' : ctx.fmove < 0 ? 'A_BL2TR' : 'A_L2R' };
  } else if (ctx.smove < 0) {
    if (ctx.attack && vy > 20 && above < 70 && ctx.jumpHeld && force >= ALT_ATTACK_POWER.sideways) {
      sel = style === 'staff' ? { move: 'BUTTERFLY_LEFT', impulse: { forward: 0, right: -190, up: 250 }, forceCost: ALT_ATTACK_POWER.sideways } : { move: 'JUMPATTACK_ARIAL_LEFT', impulse: { forward: 0, right: -190, up: 350 }, forceCost: ALT_ATTACK_POWER.sideways };
    } else sel = { move: ctx.fmove > 0 ? 'A_TR2BL' : ctx.fmove < 0 ? 'A_BR2TL' : 'A_R2L' };
  } else if (ctx.fmove > 0) {
    if ((style === 'dual' || style === 'staff') && (ctx.grounded || above <= 40) && vy >= 0 && ctx.jumpHeld && !busy && ctx.attack && canFB) {
      // Forward, jump and attack together: the dual leap or the staff's forward butterfly.
      sel = { move: style === 'dual' ? 'JUMPATTACK_DUAL' : 'JUMPATTACK_STAFF_RIGHT', forceCost: ALT_ATTACK_POWER.forwardBack };
    } else if (style === 'medium' && vy > 100 && above < 32 && canFB) {
      // Rising just off the ground: medium flips over into a downward slash.
      sel = { move: 'A_FLIP_SLASH', impulse: { forward: 150, right: 0, up: 400 }, forceCost: ALT_ATTACK_POWER.forwardBack };
    } else if (style === 'strong' && vy > 100 && above < 32 && canFB) {
      // Strong leaps into the overhead (the death from above).
      sel = { move: 'A_JUMP_T2B', impulse: { forward: 300, right: 0, up: 280 }, forceCost: ALT_ATTACK_POWER.forwardBack };
    } else if ((style === 'fast' || style === 'dual' || style === 'staff') && ctx.grounded && ctx.crouch && canFB) {
      // Crouched and moving forward: fast lunges, the staff and the dual sabers spin.
      sel = style === 'fast' ? { move: 'A_LUNGE', impulse: { forward: 150, right: 0, up: null }, forceCost: ALT_ATTACK_POWER.forwardBack } : { move: style === 'staff' ? 'SPINATTACK' : 'SPINATTACK_DUAL', forceCost: ALT_ATTACK_POWER.forwardBack };
    } else sel = { move: 'A_T2B' };
  } else if (ctx.fmove < 0) {
    if (style === 'staff' && (ctx.grounded || above <= 40) && vy >= 0 && ctx.jumpHeld && !busy && ctx.attack) {
      // Back, jump and attack with the staff: the backflip attack.
      sel = { move: 'A_BACKFLIP_ATK', impulse: { forward: 0, right: 0, up: 500 } };
    } else if (ctx.enemyNear?.('B', 128 * UNIT)) {
      // Someone behind: the back attack, which the fast style stabs and the others swing (crouched: low).
      sel = { move: style === 'fast' || style === 'staff' ? 'A_BACKSTAB' : ctx.crouch ? 'A_BACK_CR' : 'A_BACK' };
    } else sel = { move: 'A_T2B' };
  } else sel = { move: 'A_T2B' };
  if (style === 'dual' && ctx.enemyNear) {
    // Enemies on both sides, or before and behind: the dual sabers hit both ways at once.
    const r = 100 * UNIT;
    if (['A_R2L', 'S_R2L', 'A_L2R', 'S_L2R'].includes(sel.move) && ctx.enemyNear('R', r) && ctx.enemyNear('L', r)) sel = { move: 'DUAL_LR' };
    else if (['A_T2B', 'S_T2B', 'A_BACK', 'A_BACK_CR'].includes(sel.move) && ctx.enemyNear('F', r) && ctx.enemyNear('B', r)) sel = { move: 'DUAL_FB' };
  }
  return sel;
}

/** The style's kata (attack and the alternate attack pressed together while standing still). */
export function kataFor(style: SaberStyle): string {
  return style === 'fast' ? 'A1_SPECIAL' : style === 'medium' ? 'A2_SPECIAL' : style === 'strong' ? 'A3_SPECIAL' : style === 'dual' ? 'DUAL_SPIN_PROTECT' : 'STAFF_SOULCAL';
}

/** PM_KickMoveForConditions: the staff's kick for the direction keys (forward when none is held). */
export function kickForMovement(ctx: AttackContext): string {
  if (ctx.smove > 0) return 'KICK_R';
  if (ctx.smove < 0) return 'KICK_L';
  if (ctx.fmove < 0) return 'KICK_B';
  return 'KICK_F';
}

const STYLE_DIGIT: Record<SaberStyle, string> = { fast: '1', medium: '2', strong: '3', dual: '6', staff: '7' };
export const STANCE_ANIM: Record<SaberStyle, string> = { fast: 'BOTH_SABERFAST_STANCE', medium: 'BOTH_STAND2', strong: 'BOTH_SABERSLOW_STANCE', dual: 'BOTH_SABERDUAL_STANCE', staff: 'BOTH_SABERSTAFF_STANCE' };

/** Animation name for a move in a style: the style digit replaces the 1 of the fast style's names. */
export function animForStyle(move: SaberMove, style: SaberStyle): string {
  const d = STYLE_DIGIT[style];
  if (move.kind === 'special' || move.kind === 'none') return move.anim;
  if (move.kind === 'ready') return STANCE_ANIM[style];
  let anim = move.anim.replace(/^BOTH_([ASRTB])1_/, `BOTH_$1${d}_`);
  // The single styles' starts and returns all leave from and return to the "_S1" stance
  // (BOTH_S2_S1_T_, BOTH_R3_B__S1); the dual and staff styles have their own (BOTH_S6_S6_T_).
  if (style === 'dual' || style === 'staff') anim = anim.replace(/_S1(_|$)/, `_S${d}$1`);
  return anim;
}

/** BG_SaberStartTransAnim: the arcs play quicker in the fast style and slower in the strong one. */
export function animSpeed(move: SaberMove, style: SaberStyle): number {
  if (move.kind !== 'transition') return 1;
  return style === 'fast' ? 1.5 : style === 'strong' ? 0.75 : 1;
}

export const STYLE_DAMAGE: Record<SaberStyle, number> = { fast: 30, medium: 45, strong: 75, dual: 38, staff: 42 };
export const STYLES: SaberStyle[] = ['fast', 'medium', 'strong', 'dual', 'staff'];
/** How the kicks hurt: damage (10 to 15 in the game) and the shove. */
export const KICK_DAMAGE = { min: 10, max: 15, push: 6 };

export interface SaberInput extends AttackContext {
  attack: boolean;
  attackPressed: boolean;
  /** The alternate attack (right mouse): kicks with the staff, katas with both buttons, else the throw. */
  altAttack: boolean;
  altAttackPressed: boolean;
  /** A forward roll in its last quarter second: attack then stabs out of it. */
  rollEnding: boolean;
  /** Ground and air movement in progress that a swing must not interrupt (a wall run, a flip). */
  inSpecialJump: boolean;
}

export interface SaberPlay {
  move: SaberMove;
  anim: string;
  speed: number;
  /** Seconds of blend into the animation. */
  blend: number;
  loop: boolean;
  /** The push the move gives the body as it starts, and the Force it took. */
  impulse: Impulse | null;
  forceCost: number;
}

/**
 * The saber state machine. `clipDuration` answers the length in seconds of an animation the rig
 * has, or null; a missing animation plays for a stand-in time so the chain still works.
 */
export class SaberCombat {
  style: SaberStyle = 'medium';
  move = 'NONE';
  /** Seconds left in the current move, and its full length. */
  timer = 0;
  duration = 0;
  chainCount = 0;
  /** Counts up on every attack move, so a hit test can tell one swing from the next. */
  attackId = 0;
  private buffered = false;

  get current(): SaberMove {
    return MOVES.get(this.move) ?? MOVES.get('NONE')!;
  }

  /** Seconds since the current move began. */
  get elapsed(): number {
    return Math.max(0, this.duration - this.timer);
  }

  /** True while a swing that can hurt is playing (kicks hurt with the foot instead). */
  get attacking(): boolean {
    const k = this.current.kind;
    return (k === 'attack' || k === 'special') && !this.current.kick;
  }

  /** The direction of a kick while its foot is out (the middle of the kick), else null. */
  get kicking(): Dir | null {
    const c = this.current;
    if (!c.kick || this.duration <= 0) return null;
    const t = this.elapsed / this.duration;
    return t >= 0.2 && t <= 0.7 ? c.kick : null;
  }

  /** True while any move other than the ready stance plays. */
  get busy(): boolean {
    const k = this.current.kind;
    return k !== 'ready' && k !== 'none';
  }

  /** The move's scripted push for now: forward and right as -1..1 commands, and a hop's vertical speed in m/s. */
  scriptNow(): { fmove: number; smove: number; hop: number | null } | null {
    const s = this.current.script;
    if (!s || this.duration <= 0) return null;
    const t = this.elapsed;
    const fw = s.forward?.find((w) => t >= w.from && t <= w.to);
    const hop = s.hops?.find((h) => t >= h.from && t <= h.to);
    return { fmove: fw ? (fw.amount ?? 1) : 0, smove: s.right && t >= s.right[0] && t <= s.right[1] ? s.right[2] : 0, hop: hop ? hop.vy * UNIT : null };
  }

  cycleStyle(): SaberStyle {
    this.style = STYLES[(STYLES.indexOf(this.style) + 1) % STYLES.length];
    return this.style;
  }

  holster(): void {
    this.move = 'NONE';
    this.timer = 0;
    this.duration = 0;
    this.chainCount = 0;
    this.buffered = false;
  }

  /** Advance; returns the animation to start when the move changes, else null. */
  update(dt: number, saberOn: boolean, input: SaberInput, clipDuration: (anim: string) => number | null): SaberPlay | null {
    if (!saberOn) {
      if (this.move !== 'NONE') this.holster();
      return null;
    }
    if (this.move === 'NONE') return this.set('READY', clipDuration);
    if (input.attackPressed) this.buffered = true;
    this.timer -= dt;
    const cur = this.move;
    const c = this.current;
    const force = input.force ?? 100;
    // Out of a forward roll, attack stabs (PM_WeaponLightsaber's roll case).
    if (input.rollEnding && input.attack && !c.kata && cur !== 'ROLL_STAB' && force >= ALT_ATTACK_POWER.forwardBack) {
      return this.set('ROLL_STAB', clipDuration, null, ALT_ATTACK_POWER.forwardBack);
    }
    if (this.timer > 0) return null;
    // Both buttons while standing still on the ground: the style's kata (PM_CanDoKata).
    if (input.attack && input.altAttack && input.grounded && !input.fmove && !input.smove && !input.jumpHeld && (c.kind === 'ready' || c.kind === 'start') && force >= ALT_ATTACK_POWER.kata) {
      this.buffered = false;
      return this.set(kataFor(this.style), clipDuration, null, ALT_ATTACK_POWER.kata);
    }
    // The staff's alternate attack is a kick, from the ready stance and not crouched.
    if (this.style === 'staff' && input.altAttackPressed && c.kind === 'ready' && !input.crouch) {
      let kick = kickForMovement(input);
      if (!input.grounded) {
        const above = input.aboveGround / UNIT;
        // High enough up, the kick is the in-air one; too close to the ground for either, none.
        if (above > 64 && above > -input.vy / UNIT - 64) kick = `${kick}_AIR`;
        else if (above > 128 || input.vy >= 0) kick = '';
      }
      if (kick) return this.set(kick, clipDuration);
    }
    const wantAttack = input.attack || this.buffered;
    this.buffered = false;
    let sel: Selection;
    if (c.kind === 'ready') {
      if (!wantAttack || input.inSpecialJump) return null;
      sel = attackForMovement(this.style, input, cur);
      sel.move = transitionMove(this.style, this.chainCount, cur, sel.move);
    } else if (!wantAttack) {
      sel = { move: c.chainIdle };
    } else if (c.kind === 'transition' || c.kind === 'start') {
      sel = { move: c.chainAttack };
    } else if (c.kind === 'special' && c.chainAttack !== 'READY') {
      // A special that leads into an arc or a swing.
      sel = { move: c.chainAttack };
    } else if (c.kata || input.inSpecialJump) {
      sel = { move: c.chainIdle };
    } else {
      sel = attackForMovement(this.style, input, cur);
      if (kataDone(this.style, this.chainCount, cur, sel.move)) sel = { move: c.chainIdle };
      else sel.move = transitionMove(this.style, this.chainCount, cur, sel.move);
    }
    return this.set(sel.move, clipDuration, sel.impulse ?? null, sel.forceCost ?? 0);
  }

  private set(name: string, clipDuration: (anim: string) => number | null, impulse: Impulse | null = null, forceCost = 0): SaberPlay {
    const move = MOVES.get(name) ?? MOVES.get('READY')!;
    this.move = move.name;
    if (move.kind === 'ready' || move.name === 'A_FLIP_STAB' || move.name === 'A_FLIP_SLASH') this.chainCount = 0;
    else if (move.kind === 'attack') this.chainCount = Math.min(16, this.chainCount + 1);
    if (move.kind === 'attack' || move.kind === 'special') this.attackId++;
    const anim = animForStyle(move, this.style);
    const speed = animSpeed(move, this.style);
    const loop = move.kind === 'ready';
    const natural = clipDuration(anim);
    // Without the animation, the stand-in timing keeps chains playable: swings 0.45 s, arcs 0.25 s.
    const fallback = move.kata ? 2.5 : move.kind === 'attack' || move.kind === 'special' ? 0.45 : move.kind === 'transition' ? 0.25 : move.kind === 'ready' ? 0 : 0.2;
    this.duration = loop ? 0 : (natural ?? fallback) / speed;
    this.timer = this.duration;
    return { move, anim, speed, blend: move.blend / 1000, loop, impulse, forceCost };
  }
}
