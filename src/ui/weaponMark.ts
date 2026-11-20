// The weapon mark (the interface rewrite's first wave, item 6): which of our own marks stands in the body block for what
// the hands hold, and the markup a mark is drawn with. The owner's words (19 November 2026): the weapon "as a symbol,
// slightly translucent. No name"; a lightsaber shows its stance by its tilt, a double-bladed saber is a double-bladed
// mark at 45 degrees and two sabers are two marks crossed; a blaster shows its kind; every other class and empty hands
// get a mark of their own; and any other pair is two small marks set diagonally with a muted slanted line between them.
//
// Every mark is ours, drawn by hand in `src/ui/hud.svg` (the `ic-mark-*` symbols, with `ic-fists` for empty hands and
// `ic-hand` for something held that nothing here knows). A lightsaber is drawn as two parts, its hilt and its blade, so
// the display can stand it at the stance's tilt and draw the blade in and out with the real one (`hud.css`, the class
// `lit` on the mark); the tilt itself is a custom property the stylesheet turns the hilt and blade by.
//
// Pure: no page, no three. The rule is asked only when what the hands hold, the kit, the bare-hands switch, the stand-in
// blaster's kind or the stance has changed, never in a steady frame, and it writes its answer into the caller's record.
// Rule for this file (node runs it with type stripping): every value import with its `.ts` extension.
import { HUD_SIZES } from './hudMath.ts';

/**
 * Which composition a slot of the mark shows. `saber` is one lightsaber at its stance's tilt; `staff` the double-bladed
 * saber; `dual` two sabers crossed in an X (both hands in one mark); the rest one mark each. `fists` is empty hands (or
 * the bare-hands switch), `held` something in a hand whose class nothing here knows (the open hand), and '' no mark.
 */
export type MarkKey =
  | ''
  | 'saber'
  | 'staff'
  | 'dual'
  | 'pistol'
  | 'carbine'
  | 'rifle'
  | 'heavy'
  | 'sword'
  | 'knife'
  | 'sword2h'
  | 'polearm'
  | 'fist'
  | 'thrown'
  | 'instrument'
  | 'prop'
  | 'fists'
  | 'held';

/** Every mark the rule can answer with, in the order the test sheet shows them. */
export const MARK_KEYS: readonly Exclude<MarkKey, ''>[] = ['saber', 'staff', 'dual', 'pistol', 'carbine', 'rifle', 'heavy', 'sword', 'knife', 'sword2h', 'polearm', 'fist', 'thrown', 'instrument', 'prop', 'fists', 'held'];

/**
 * What the mark is read from, a record the display keeps and fills in place. `right` and `left` are the rack's classes
 * (`WeaponClass` in `src/player/weapons.ts`), '' for an empty hand. `kit` is the class in play: the Jedi's carries the
 * stand-in saber in an empty right hand and the Bounty Hunter's the stand-in blaster (`Player.updateBlades`), whose kind
 * is `gun` (the last blaster held, `Player.gunClass`). `bare` is the bare-hands switch (everything put away). `style` is
 * the saber's stance (`SaberStyle` in `src/combat/saber.ts`).
 */
export interface MarkIn {
  right: string;
  left: string;
  kit: string;
  bare: boolean;
  gun: string;
  style: string;
}

/**
 * What the mark shows: slot `a` (the right hand's, or the only one), slot `b` (the left hand's in a pair, '' otherwise),
 * each slot's tilt in degrees clockwise (a lightsaber's stance; nought for everything else), and `lights`: whether the
 * real blade can be lit with these hands at all. A blade that is not a lightsaber in the right hand puts every blade out
 * (`Player.updateBlades`: `on` wants no melee weapon on the right), so a lightsaber's mark beside it keeps its blade in.
 */
export interface MarkOut {
  a: MarkKey;
  b: MarkKey;
  tiltA: number;
  tiltB: number;
  lights: boolean;
}

export function makeMarkIn(): MarkIn {
  return { right: '', left: '', kit: '', bare: false, gun: 'rifle', style: 'medium' };
}

export function makeMarkOut(): MarkOut {
  // The tilts begin as fractions, so each field is a double from its first write (22.5 is one of the answers).
  return { a: '', b: '', tiltA: 0.5, tiltB: 0.5, lights: true };
}

/** A lightsaber of one blade (one hand or two): it shows its stance. */
function oneBlade(cls: string): boolean {
  return cls === 'lightsaber' || cls === 'lightsaber2h';
}

/** A class that fights as a blaster. */
function isGun(cls: string): boolean {
  return cls === 'pistol' || cls === 'carbine' || cls === 'rifle' || cls === 'heavy';
}

/** The mark for a class in a hand, a lightsaber of one blade apart (the caller tilts it). */
function keyOfClass(cls: string): MarkKey {
  switch (cls) {
    case 'pistol':
    case 'carbine':
    case 'rifle':
    case 'heavy':
      return cls;
    case 'sword1h':
      return 'sword';
    case 'knife':
      return 'knife';
    case 'sword2h':
      return 'sword2h';
    case 'polearm':
      return 'polearm';
    case 'fist':
      return 'fist';
    case 'thrown':
      return 'thrown';
    case 'instrument':
      return 'instrument';
    case 'entertainer':
      return 'prop';
    case 'lightsaber':
    case 'lightsaber2h':
      return 'saber';
    case 'lightsaberStaff':
      return 'staff';
    default:
      return 'held';
  }
}

/** A single blade's tilt for a stance: fast 45 to the right, medium 22.5, strong upright; the dual style's halves at 45. */
export function stanceTilt(style: string): number {
  const S = HUD_SIZES;
  return style === 'fast' ? S.markTiltFast : style === 'strong' ? S.markTiltStrong : style === 'dual' ? S.markTiltDual : S.markTiltMedium;
}

/**
 * The mark for what the hands hold (the owner's design, 19 November 2026). In order:
 *
 *   - bare hands (the switch, everything put away): the fists;
 *   - the right hand, or with nothing in it the kit's stand-in (the Jedi's saber, the Bounty Hunter's blaster, empty
 *     hands for anything else): a lightsaber of one blade at its stance's tilt; the double-bladed saber, or the stand-in
 *     fighting as the staff, the double-bladed mark at its own tilt; two sabers (the dual style with a saber or nothing in
 *     the left, which is what the game draws then) the X, both hands in one mark; anything else its class's own mark;
 *   - the left hand, unless the X holds it already: a pair, its mark the left hand's (a lightsaber at the dual style's
 *     tilt, the one each half of the X stands at).
 *
 * A blaster is never paired in play (the left hand takes blades only), but the rule does not lean on that: whatever is
 * in the left hand is shown. Allocates nothing: the answer is written into `out` and every key is a literal.
 */
export function weaponMark(m: MarkIn, out: MarkOut): MarkOut {
  const S = HUD_SIZES;
  out.a = '';
  out.b = '';
  out.tiltA = 0;
  out.tiltB = 0;
  out.lights = true;
  if (m.bare) {
    out.a = 'fists';
    out.lights = false;
    return out;
  }
  const r = m.right;
  const l = m.left;
  const standIn = r === '';
  if (r === 'lightsaberStaff' || (standIn && m.kit === 'jedi' && m.style === 'staff')) {
    out.a = 'staff';
    out.tiltA = S.markTiltStaff;
  } else if (oneBlade(r) || (standIn && m.kit === 'jedi')) {
    if (m.style === 'dual' && (l === '' || oneBlade(l))) {
      out.a = 'dual';
      out.tiltA = S.markTiltDual;
    } else {
      out.a = 'saber';
      out.tiltA = stanceTilt(m.style);
    }
  } else if (standIn) {
    out.a = m.kit === 'bounty_hunter' ? (isGun(m.gun) ? (m.gun as MarkKey) : 'rifle') : 'fists';
  } else out.a = keyOfClass(r);
  // A blade that is not a lightsaber in the right hand puts every blade out (a blaster there is the Bounty Hunter's, who
  // carries no lit blade either way).
  out.lights = standIn || oneBlade(r) || r === 'lightsaberStaff';
  if (l !== '' && out.a !== 'dual') {
    out.b = keyOfClass(l);
    out.tiltB = out.b === 'saber' ? S.markTiltDual : 0;
  }
  return out;
}

/** Whether a mark carries a blade that draws in and out (`lit` on the mark). */
export function markHasBlade(key: MarkKey): boolean {
  return key === 'saber' || key === 'staff' || key === 'dual';
}

/** The sheet's symbol for each mark that is one picture: everything but the three lightsabers, which are put together. */
const MARK_SYMBOL: Record<string, string> = {
  pistol: 'ic-mark-pistol',
  carbine: 'ic-mark-carbine',
  rifle: 'ic-mark-rifle',
  heavy: 'ic-mark-heavy',
  sword: 'ic-mark-sword',
  knife: 'ic-mark-knife',
  sword2h: 'ic-mark-sword2h',
  polearm: 'ic-mark-polearm',
  fist: 'ic-mark-fist',
  thrown: 'ic-mark-thrown',
  instrument: 'ic-mark-instrument',
  prop: 'ic-mark-prop',
  fists: 'ic-fists',
  held: 'ic-hand',
};

/** Every symbol a mark is drawn from, for the test that holds them to the sheet. */
export const MARK_SYMBOLS: readonly string[] = ['ic-mark-hilt', 'ic-mark-blade', 'ic-mark-staff-hilt', 'ic-mark-staff-blade', ...Object.values(MARK_SYMBOL)];

const use = (id: string) => `<use href="#${id}"></use>`;

/** One lightsaber, upright in its own frame: the hilt, and the blade in a group of its own the stylesheet draws in and out. */
function oneSaber(second: boolean): string {
  return `${use('ic-mark-hilt')}<g class="blade${second ? ' b2' : ''}">${use('ic-mark-blade')}</g>`;
}

/**
 * The markup for one slot of the mark, written into the slot when what it shows changes (never in a steady frame). A
 * lightsaber stands in `tilt`, which the stylesheet turns by the slot's `--mk-tilt`; its blade is `blade` (and `b2` for
 * the left hand's, which may draw at its own pace). `second` is the left hand's slot in a pair.
 */
export function markSvg(key: MarkKey, second: boolean): string {
  switch (key) {
    case '':
      return '';
    case 'saber':
      return `<g class="tilt">${oneSaber(second)}</g>`;
    case 'staff':
      // The one blade drawn upper, and a copy turned half round about the middle for the lower: each draws in toward its
      // own end of the hilt.
      return `<g class="tilt">${use('ic-mark-staff-hilt')}<g class="blade staff">${use('ic-mark-staff-blade')}</g><g transform="rotate(180 12 12)"><g class="blade staff">${use('ic-mark-staff-blade')}</g></g></g>`;
    case 'dual':
      // The right hand's saber leans to the left with its hilt at the lower right, the left hand's the other way: an X.
      return `<g class="x1">${oneSaber(false)}</g><g class="x2">${oneSaber(true)}</g>`;
    default:
      return use(MARK_SYMBOL[key] ?? 'ic-hand');
  }
}

/** The mark as words, for the console (`__debug.hud().mark`): the bars and the mark carry none on the screen. */
export function markWords(o: MarkOut, lit: boolean): string {
  const blade = (k: MarkKey) => (markHasBlade(k) ? (lit && o.lights ? ' lit' : ' in') : '');
  const one = (k: MarkKey, tilt: number) => (k === 'saber' ? `saber ${tilt}°` : k === 'staff' ? `staff ${tilt}°` : k === 'dual' ? `dual X ${tilt}°` : k);
  const a = `${one(o.a, o.tiltA)}${blade(o.a)}`;
  return o.b ? `${a} / ${one(o.b, o.tiltB)}${blade(o.b)}` : a;
}
