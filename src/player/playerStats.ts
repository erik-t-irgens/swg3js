// The player's stats as their progress makes them, kept: what the game reads every frame and every shot, worked
// out only when what grants them changes and never in a frame (`src/progress/stats.ts` is the arithmetic).
//
// **Nothing changes until something is earned.** With an empty record nothing has an entry, so every kept field
// is its catalogue base -- today's literal at its read site, the very number -- and `gun()` and `grenade()` hand
// back `GUNS[type]` and the gadget's own spec themselves. The Bounty Hunter's kit resets a charge, a held stream
// and a beam whenever the gun profile it is handed is another object (`gun !== this.lastProfile`), so a gun is
// handed a copy of its own only once a gun stat first has an entry, and from then on that one copy is rewritten
// in place whenever the grants change -- a respec writes the bases back into it -- and is never replaced: a
// payout landing while the next foe is in the sights must not cost the shot its charge. Grenades the same.
//
// **The grant key.** `update` first builds the key the grants depend on -- the rules' stamp, the owned nodes
// sorted, each built core skill's whole rating -- and does nothing at all when it is the key it has: an
// encounter's payout that crosses no whole rating moves no stat, makes no object and bumps no version.

import { GUNS, type FireMode, type GunProfile, type GunType } from '../combat/guns.ts';
import type { GrenadeSpec } from '../combat/gadgets.ts';
import { ratingsOf } from '../progress/core.ts';
import type { ProgressRecord } from '../progress/record.ts';
import { baseOf, resolveStats, type Resolved, type StatId } from '../progress/stats.ts';
import { PROGRESS_RULES, PROGRESS_STAMP } from '../progress/tune.ts';

/** The stats a gun's kept copy is worked out through. Until one of them has an entry, every gun is the table's own. */
const GUN_STATS: readonly StatId[] = ['gun.spread', 'gun.aimSpread', 'gun.damage', 'gun.refire', 'launcher.refire'];
/** And a grenade's. */
const GRENADE_STATS: readonly StatId[] = ['throw.speed', 'blast.radius'];

/** What the grants depend on, as one line. */
export function grantKey(rec: ProgressRecord | null): string {
  const nodes = Object.keys(rec?.nodes ?? {}).sort().join(',');
  return `${PROGRESS_STAMP.rules}|${nodes}|${ratingsOf(rec, PROGRESS_RULES).join(',')}`;
}

export class PlayerStats {
  private resolved: Resolved = resolveStats(null, PROGRESS_RULES);
  private key = grantKey(null);
  /** Rises every time the grants change and the kept fields are written again. */
  version = 0;
  /** Whether a gun stat, or a grenade stat, has ever had an entry: from then on the kept copies are handed out. */
  private gunsLive = false;
  private grenadesLive = false;
  private readonly guns = new Map<GunType, GunProfile>();
  private readonly grenades = new Map<GrenadeSpec, GrenadeSpec>();

  // The kept fields, each its catalogue base until something grants it. The bases are the catalogue's, which are
  // the literals their read sites held.
  healthMax = baseOf('health.max');
  healthRegen = baseOf('health.regen');
  burnScale = baseOf('resist.burn');
  /** Metres, handed to the movement in its own units. */
  fallSafeExtra = baseOf('fall.safeExtra');
  rollDivisor = baseOf('fall.rollDivisor');
  /** Metres. */
  rollFree = baseOf('fall.rollFree');
  rollIframes = baseOf('roll.iframes');
  airAccel = baseOf('move.airAccel');
  aimRate = baseOf('gun.aimRate');
  steady = baseOf('gun.steady');
  saberDamage = baseOf('saber.damage');
  saberSwing = baseOf('saber.swing');
  saberDefense = baseOf('saber.defense');
  meleePush = baseOf('melee.push');
  blastSelf = baseOf('blast.self');
  chainReach = baseOf('chain.reach');
  grenadeCooldown = baseOf('grenade.cooldown');
  grenadeStock = baseOf('grenade.stock');
  grenadeCount = baseOf('grenade.count');
  throwLift = baseOf('throw.lift');
  packs = baseOf('charge.packs');
  pickCos = baseOf('launcher.pickCos');

  /**
   * The record's grants worked out again, when they changed: answers whether they did. A record that grants the
   * same as the last does nothing at all.
   */
  update(rec: ProgressRecord | null): boolean {
    const key = grantKey(rec);
    if (key === this.key) return false;
    this.key = key;
    this.resolved = resolveStats(rec, PROGRESS_RULES);
    this.version++;
    this.refresh();
    return true;
  }

  /** A stat worked out from a base the read site hands in (an item's own field): the very base while nothing grants to it. Allocates nothing. */
  apply(id: StatId, base: number): number {
    return this.resolved.apply(id, base);
  }

  /** What grants each stat, for the console. */
  get grants(): Resolved {
    return this.resolved;
  }

  /** A gun's profile: the table's own until a gun stat has an entry, then this gun's one kept copy. */
  gun(type: GunType): GunProfile {
    if (!this.gunsLive) return GUNS[type];
    let c = this.guns.get(type);
    if (!c) {
      const base = GUNS[type];
      c = { ...base, primary: { ...base.primary }, alt: base.alt ? { ...base.alt } : null };
      this.writeGun(type, c);
      this.guns.set(type, c);
    }
    return c;
  }

  /** A grenade's spec: the gadget's own until a grenade stat has an entry, then that spec's one kept copy. */
  grenade(spec: GrenadeSpec): GrenadeSpec {
    if (!this.grenadesLive) return spec;
    let c = this.grenades.get(spec);
    if (!c) {
      c = { ...spec };
      this.writeGrenade(spec, c);
      this.grenades.set(spec, c);
    }
    return c;
  }

  /** Every kept field and every kept copy written again from the grants, in place. */
  private refresh(): void {
    const r = this.resolved;
    this.healthMax = r.apply('health.max', baseOf('health.max'));
    this.healthRegen = r.apply('health.regen', baseOf('health.regen'));
    this.burnScale = r.apply('resist.burn', baseOf('resist.burn'));
    this.fallSafeExtra = r.apply('fall.safeExtra', baseOf('fall.safeExtra'));
    this.rollDivisor = r.apply('fall.rollDivisor', baseOf('fall.rollDivisor'));
    this.rollFree = r.apply('fall.rollFree', baseOf('fall.rollFree'));
    this.rollIframes = r.apply('roll.iframes', baseOf('roll.iframes'));
    this.airAccel = r.apply('move.airAccel', baseOf('move.airAccel'));
    this.aimRate = r.apply('gun.aimRate', baseOf('gun.aimRate'));
    this.steady = r.apply('gun.steady', baseOf('gun.steady'));
    this.saberDamage = r.apply('saber.damage', baseOf('saber.damage'));
    this.saberSwing = r.apply('saber.swing', baseOf('saber.swing'));
    this.saberDefense = r.apply('saber.defense', baseOf('saber.defense'));
    this.meleePush = r.apply('melee.push', baseOf('melee.push'));
    this.blastSelf = r.apply('blast.self', baseOf('blast.self'));
    this.chainReach = r.apply('chain.reach', baseOf('chain.reach'));
    this.grenadeCooldown = r.apply('grenade.cooldown', baseOf('grenade.cooldown'));
    this.grenadeStock = r.apply('grenade.stock', baseOf('grenade.stock'));
    this.grenadeCount = r.apply('grenade.count', baseOf('grenade.count'));
    this.throwLift = r.apply('throw.lift', baseOf('throw.lift'));
    this.packs = r.apply('charge.packs', baseOf('charge.packs'));
    this.pickCos = r.apply('launcher.pickCos', baseOf('launcher.pickCos'));
    if (!this.gunsLive && GUN_STATS.some((id) => r.has(id))) this.gunsLive = true;
    if (!this.grenadesLive && GRENADE_STATS.some((id) => r.has(id))) this.grenadesLive = true;
    for (const [type, c] of this.guns) this.writeGun(type, c);
    for (const [spec, c] of this.grenades) this.writeGrenade(spec, c);
  }

  private writeGun(type: GunType, c: GunProfile): void {
    const base = GUNS[type];
    this.writeMode(c.primary, base.primary, type);
    if (c.alt && base.alt) this.writeMode(c.alt, base.alt, type);
  }

  private writeMode(m: FireMode, b: FireMode, type: GunType): void {
    const r = this.resolved;
    m.spread = r.apply('gun.spread', b.spread);
    m.aimSpread = r.apply('gun.aimSpread', b.aimSpread);
    m.damage = r.apply('gun.damage', b.damage);
    const refire = r.apply('gun.refire', b.fireTime);
    m.fireTime = type === 'rocket' ? r.apply('launcher.refire', refire) : refire;
  }

  private writeGrenade(spec: GrenadeSpec, c: GrenadeSpec): void {
    const r = this.resolved;
    c.speed = r.apply('throw.speed', spec.speed);
    c.radius = r.apply('blast.radius', spec.radius);
  }
}
