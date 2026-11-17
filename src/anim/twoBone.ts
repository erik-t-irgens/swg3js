// The two-bone solve (wave 3 of the animations): a limb of two bones (a hip, a knee, an ankle; a shoulder, an elbow, a
// wrist) bent so its end meets a target. The feet's placement uses it now (src/player/footIk.ts) and the hands' bracing
// will (wave 4); both import this file, and the bones are turned by src/player/limbIk.ts, which the two share as well.
//
// The rules, each held by tools/swg/tests/twoBone.test.ts:
//  - the end meets the target wherever the limb can reach it (within a millimetre: the arithmetic is exact to the
//    float), and where it cannot, it stops short along the line to it: a limb is never stretched past its own length
//    (the two bones' lengths are kept to the float), nor folded past where its two bones overlap;
//  - the middle joint bends the way the pose had it bend: its pole is the posed middle joint's offset from the posed
//    limb's own line (root to posed end), less what of it lies along the new reach, so it stays on the pose's side and in
//    the pose's own plane (as near as a target off that plane allows) wherever the target moves, and a knee never bends
//    backward; where the posed limb is straight (no side to read), the caller's pole says the side;
//  - asked for the posed end itself, it hands back the posed middle joint.
//
// Pure: numbers in a kept record and numbers out in another, nothing made (a number handed across a call the compiler
// does not build in is boxed, so nothing crosses one: wave 2a's lesson).

/** What is solved: the posed root, middle and end, the target, and a pole for a posed limb that is straight. (Declared as fractions.) */
export class TwoBoneAsk {
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  bx = 0.5;
  by = 0.5;
  bz = 0.5;
  cx = 0.5;
  cy = 0.5;
  cz = 0.5;
  tx = 0.5;
  ty = 0.5;
  tz = 0.5;
  /** The way the middle joint bends where the posed limb is straight (a knee forward, an elbow back): need not be unit. */
  px = 0.5;
  py = 0.5;
  pz = 0.5;
}

/** What the solve hands back: the middle joint's new place and the end's (the target, or as near as the limb reaches). */
export class TwoBoneOut {
  kx = 0.5;
  ky = 0.5;
  kz = 0.5;
  ex = 0.5;
  ey = 0.5;
  ez = 0.5;
  /** The target was within the limb's reach (the end stands on it). */
  reached = false;
  /** How far the end stands from the target, metres (nought where it reached). */
  short = 0.5;
}

/** How far short of its whole length the limb is ever held, as a share of the shorter bone: a limb dead straight has no side to bend to. */
export const STRAIGHT_MARGIN = 1e-4;
/**
 * A posed limb bent less than this (the sine of the angle between its two bones: about a degree) has no side of its own
 * to read, and bends to the caller's pole (a knee forward).
 */
export const POSED_BENT = 0.02;

/**
 * Solve one limb (`TwoBoneAsk` in, `TwoBoneOut` out). True where it solved (false only for a degenerate limb: a bone of
 * no length, or a target on the root itself, where the posed limb is handed back as it stands).
 */
export function solveTwoBone(q: TwoBoneAsk, o: TwoBoneOut): boolean {
  const abx = q.bx - q.ax;
  const aby = q.by - q.ay;
  const abz = q.bz - q.az;
  const bcx = q.cx - q.bx;
  const bcy = q.cy - q.by;
  const bcz = q.cz - q.bz;
  const l1 = Math.sqrt(abx * abx + aby * aby + abz * abz);
  const l2 = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
  let dx = q.tx - q.ax;
  let dy = q.ty - q.ay;
  let dz = q.tz - q.az;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(l1 > 1e-9) || !(l2 > 1e-9) || !(dl > 1e-9)) {
    o.kx = q.bx;
    o.ky = q.by;
    o.kz = q.bz;
    o.ex = q.cx;
    o.ey = q.cy;
    o.ez = q.cz;
    o.reached = false;
    o.short = dl;
    return false;
  }
  dx /= dl;
  dy /= dl;
  dz /= dl;
  // The reach: never straighter than the margin short of whole, never folded past the bones' difference.
  const margin = STRAIGHT_MARGIN * (l1 < l2 ? l1 : l2);
  const most = l1 + l2 - margin;
  const diff = l1 > l2 ? l1 - l2 : l2 - l1;
  const least = diff + margin;
  let d = dl;
  if (d > most) d = most;
  else if (d < least) d = least;
  // The pole: the posed middle joint's offset from the posed limb's own line, root to posed END (the pose's own bend: its
  // side and its plane), with what of it lies along the new reach taken out (Gram-Schmidt), so a target moved off the
  // posed line, forward, back, up or aside, never turns the bend over or swings it out of the pose's plane. (Read off the
  // line root to TARGET instead, a nearly straight knee whose target moved forward of it found itself behind that line
  // and bent backward.) A pose bent less than `POSED_BENT` (no side of its own to read) takes the caller's.
  const sx = aby * bcz - abz * bcy;
  const sy = abz * bcx - abx * bcz;
  const sz = abx * bcy - aby * bcx;
  const bent = Math.sqrt(sx * sx + sy * sy + sz * sz) / (l1 * l2) >= POSED_BENT;
  const acx = q.cx - q.ax;
  const acy = q.cy - q.ay;
  const acz = q.cz - q.az;
  const acl = Math.sqrt(acx * acx + acy * acy + acz * acz);
  let wx = 0;
  let wy = 0;
  let wz = 0;
  if (acl > 1e-9) {
    const ux = acx / acl;
    const uy = acy / acl;
    const uz = acz / acl;
    const au = abx * ux + aby * uy + abz * uz;
    wx = abx - ux * au;
    wy = aby - uy * au;
    wz = abz - uz * au;
    const wd = wx * dx + wy * dy + wz * dz;
    wx -= dx * wd;
    wy -= dy * wd;
    wz -= dz * wd;
  }
  let wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (!bent || wl < 1e-6 * l1) {
    const pd = q.px * dx + q.py * dy + q.pz * dz;
    wx = q.px - dx * pd;
    wy = q.py - dy * pd;
    wz = q.pz - dz * pd;
    wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (wl < 1e-9) {
      // No pole at all: any line across the reach (the least of the axes the reach leans from).
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      const az = dz < 0 ? -dz : dz;
      const ex = ax <= ay && ax <= az ? 1 : 0;
      const ey = ex === 0 && ay <= az ? 1 : 0;
      const ez = ex === 0 && ey === 0 ? 1 : 0;
      const ed = ex * dx + ey * dy + ez * dz;
      wx = ex - dx * ed;
      wy = ey - dy * ed;
      wz = ez - dz * ed;
      wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
    }
  }
  wx /= wl;
  wy /= wl;
  wz /= wl;
  // The middle joint along the reach by x and off it by h (the two circles' meeting).
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = l1 * l1 - x * x;
  const h = hh > 0 ? Math.sqrt(hh) : 0;
  o.kx = q.ax + dx * x + wx * h;
  o.ky = q.ay + dy * x + wy * h;
  o.kz = q.az + dz * x + wz * h;
  o.ex = q.ax + dx * d;
  o.ey = q.ay + dy * d;
  o.ez = q.az + dz * d;
  o.short = dl - d < 0 ? d - dl : dl - d;
  o.reached = o.short < 1e-6;
  return true;
}
