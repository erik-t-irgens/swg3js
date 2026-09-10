// Jedi Academy's lightsaber move system, translated from OpenJK's codemp/game/bg_saber.c and
// bg_pmove.c: the saberMoveData table (attacks, starts, returns and the arcs between quadrants),
// transitionMove, PM_SaberAttackForMovement, PM_SaberAnimTransitionAnim, PM_SaberKataDone and
// the style speed rules of BG_SaberStartTransAnim. A swing is a quadrant-to-quadrant move; the
// direction keys pick the swing, holding attack chains the next one through a transition arc, and
// each style (fast, medium, strong) has its own animations, speed and chain length.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).

export type Quad = 'BR' | 'R' | 'TR' | 'T' | 'TL' | 'L' | 'BL' | 'B';
export type MoveKind = 'none' | 'ready' | 'attack' | 'start' | 'return' | 'transition' | 'special';
export type SaberStyle = 'fast' | 'medium' | 'strong';

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
// Special attacks, one animation whatever the style.
def({ name: 'A_BACKSTAB', anim: 'BOTH_A2_STABBACK1', start: 'R', end: 'R', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'READY' });
def({ name: 'A_BACK', anim: 'BOTH_ATTACK_BACK', start: 'R', end: 'R', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'READY' });
def({ name: 'A_LUNGE', anim: 'BOTH_LUNGE2_B__T_', start: 'B', end: 'T', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'READY' });
def({ name: 'A_JUMP_T2B', anim: 'BOTH_FORCELEAP2_T__B_', start: 'T', end: 'B', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'READY' });
def({ name: 'A_FLIP_STAB', anim: 'BOTH_JUMPFLIPSTABDOWN', start: 'R', end: 'T', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'T_T_R' });
def({ name: 'A_FLIP_SLASH', anim: 'BOTH_JUMPFLIPSLASHDOWN1', start: 'L', end: 'R', kind: 'special', blend: 100, chainIdle: 'READY', chainAttack: 'T_R_T' });

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
}

/** PM_SaberAttackForMovement: which swing the direction keys ask for. */
export function attackForMovement(style: SaberStyle, ctx: AttackContext): string {
  if (ctx.smove > 0) return ctx.fmove > 0 ? 'A_TL2BR' : ctx.fmove < 0 ? 'A_BL2TR' : 'A_L2R';
  if (ctx.smove < 0) return ctx.fmove > 0 ? 'A_TR2BL' : ctx.fmove < 0 ? 'A_BR2TL' : 'A_R2L';
  if (ctx.fmove > 0) {
    // Rising just off the ground: medium flips over and stabs down, strong leaps into an overhead.
    if (!ctx.grounded && ctx.vy > 100 * 0.0254 && ctx.aboveGround < 32 * 0.0254) {
      if (style === 'medium') return 'A_FLIP_STAB';
      if (style === 'strong') return 'A_JUMP_T2B';
    }
    return 'A_T2B';
  }
  if (ctx.fmove < 0) return style === 'fast' ? 'A_BACKSTAB' : 'A_BACK';
  return 'A_T2B';
}

/** Animation name for a move in a style: the style digit replaces the 1 of the fast style's names. */
export function animForStyle(move: SaberMove, style: SaberStyle): string {
  const d = style === 'fast' ? '1' : style === 'medium' ? '2' : '3';
  if (move.kind === 'special' || move.kind === 'none') return move.anim;
  if (move.kind === 'ready') return style === 'fast' ? 'BOTH_SABERFAST_STANCE' : style === 'strong' ? 'BOTH_SABERSLOW_STANCE' : 'BOTH_STAND2';
  return move.anim.replace(/^BOTH_([ASRTB])1_/, `BOTH_$1${d}_`).replace(/_S1_/, `_S${d}_`).replace(/_S1$/, `_S${d}`);
}

/** BG_SaberStartTransAnim: the arcs play quicker in the fast style and slower in the strong one. */
export function animSpeed(move: SaberMove, style: SaberStyle): number {
  if (move.kind !== 'transition') return 1;
  return style === 'fast' ? 1.5 : style === 'strong' ? 0.75 : 1;
}

export const STYLE_DAMAGE: Record<SaberStyle, number> = { fast: 30, medium: 45, strong: 75 };
export const STYLES: SaberStyle[] = ['fast', 'medium', 'strong'];

export interface SaberInput extends AttackContext {
  attack: boolean;
  attackPressed: boolean;
}

export interface SaberPlay {
  move: SaberMove;
  anim: string;
  speed: number;
  /** Seconds of blend into the animation. */
  blend: number;
  loop: boolean;
}

/**
 * The saber state machine. `clipDuration` answers the length in seconds of an animation the rig
 * has, or null; a missing animation plays for a stand-in time so the chain still works.
 */
export class SaberCombat {
  style: SaberStyle = 'medium';
  move = 'NONE';
  /** Seconds left in the current move. */
  timer = 0;
  chainCount = 0;
  /** Counts up on every attack move, so a hit test can tell one swing from the next. */
  attackId = 0;
  private buffered = false;

  get current(): SaberMove {
    return MOVES.get(this.move) ?? MOVES.get('NONE')!;
  }

  /** True while a swing that can hurt is playing. */
  get attacking(): boolean {
    const k = this.current.kind;
    return k === 'attack' || k === 'special';
  }

  /** True while any move other than the ready stance plays. */
  get busy(): boolean {
    const k = this.current.kind;
    return k !== 'ready' && k !== 'none';
  }

  cycleStyle(): SaberStyle {
    this.style = STYLES[(STYLES.indexOf(this.style) + 1) % STYLES.length];
    return this.style;
  }

  holster(): void {
    this.move = 'NONE';
    this.timer = 0;
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
    if (this.timer > 0) return null;
    const cur = this.move;
    const c = this.current;
    const wantAttack = input.attack || this.buffered;
    this.buffered = false;
    let next: string;
    if (c.kind === 'ready') {
      if (!wantAttack) return null;
      next = transitionMove(this.style, this.chainCount, cur, attackForMovement(this.style, input));
    } else if (!wantAttack) {
      next = c.chainIdle;
    } else if (c.kind === 'transition' || c.kind === 'start') {
      next = c.chainAttack;
    } else {
      next = attackForMovement(this.style, input);
      if (kataDone(this.style, this.chainCount, cur, next)) next = c.chainIdle;
      else next = transitionMove(this.style, this.chainCount, cur, next);
    }
    return this.set(next, clipDuration);
  }

  private set(name: string, clipDuration: (anim: string) => number | null): SaberPlay {
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
    const fallback = move.kind === 'attack' || move.kind === 'special' ? 0.45 : move.kind === 'transition' ? 0.25 : move.kind === 'ready' ? 0 : 0.2;
    this.timer = loop ? 0 : (natural ?? fallback) / speed;
    return { move, anim, speed, blend: move.blend / 1000, loop };
  }
}
