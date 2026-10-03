// God mode (`__debug.god`): nothing takes the player's health, nor the hull of what they fly or ride.
//
// One seam covers the body: every way the player loses health ends in `Player.takeDamage` -- the
// blows of creatures, fighters, people and bolts through the loop's hurt closure, a fall, a crash, a
// grenade, another player's shot, a burn, the lava and drowning -- and the flag is asked there first,
// so nothing new that hurts the player can forget it. The console's own `kill('player')` passes an
// override and still kills. Creatures and people still fight a body in god mode, unlike noclip,
// which flies it and takes it out of every fight.
//
// What the player is riding or flying is held here, a step at a time, and given back exactly as it
// was found when the player leaves the seat or the mode goes off: a hull that was already invulnerable
// (a shuttle on its rig) stays so, and a ship whose fight the console had already made unhurtable
// (`shipCombat({ god: true })`) keeps that.
//
// With a server holding the world it is the world's admin's alone. Health only ever comes off in the
// browser of whoever was hit, so a browser in god mode cannot be killed by anybody and nobody else can
// tell; that is a thing the person who runs the server may do, and nobody else.
//
// Pure: no three, so the node test runs the hold as the game does.

/** Said to anybody who is not the world's admin while a server holds it. */
export const GOD_REFUSED = 'god mode is the world’s admin’s alone while a server holds the world: health only comes off in the browser of whoever is hit, so nobody could tell';

/** Why god mode may not be on here, or '' when it may: always with no server, the admin's alone with one. */
export function godRefusal(authority: 'me' | 'server', admin: boolean): string {
  return authority === 'server' && !admin ? GOD_REFUSED : '';
}

/** The little of a fight god mode writes: the switch the ship's own fight has always had. */
export interface GodFight {
  god: boolean;
}

/** The little of a vehicle god mode reads and writes. */
export interface GodHull {
  readonly spec: { readonly ship?: boolean };
  invulnerable: boolean;
  readonly combat: GodFight | null;
}

/**
 * The hull the player flies or rides, held unhurtable while god mode is on.
 *
 * A ship with a fight is made so through its fight (`ShipCombat.god`), never through `invulnerable`:
 * a bolt on it still shows the shield's own hit and takes nothing, where `invulnerable` would burst the
 * bolt on bare metal, and a hull that is `invulnerable` is never adopted into the fight again -- which
 * a jump to another system does to the ship it carries, so a ship jumped in god mode would have come
 * out with no fight at all. Anything that is not a ship (a speeder, a walker, a mount) has no fight and
 * is held `invulnerable`, which is the switch its hits, crashes and wrecks already answer to.
 */
export class GodHold {
  private hull: GodHull | null = null;
  private wasInvulnerable = false;
  private fight: GodFight | null = null;
  private wasGod = false;

  /** What is held now, for the console. */
  get holding(): GodHull | null {
    return this.hull;
  }

  /**
   * Every step: the hull flown or ridden now while god mode is on, else null. A ship's fight is looked
   * at every step, since a hull boarded before its fight was adopted gets one a moment later.
   */
  hold(hull: GodHull | null): void {
    if (hull !== this.hull) {
      this.letGo();
      this.hull = hull;
      if (hull && !hull.spec.ship) {
        this.wasInvulnerable = hull.invulnerable;
        hull.invulnerable = true;
      }
    }
    if (!hull) return;
    const fight = hull.spec.ship ? hull.combat : null;
    if (fight !== this.fight) {
      this.dropFight();
      this.fight = fight;
      if (fight) this.wasGod = fight.god;
    }
    if (fight) fight.god = true;
  }

  /** Give back whatever is held, exactly as it was found. */
  letGo(): void {
    this.dropFight();
    const h = this.hull;
    if (h && !h.spec.ship) h.invulnerable = this.wasInvulnerable;
    this.hull = null;
  }

  private dropFight(): void {
    if (this.fight) this.fight.god = this.wasGod;
    this.fight = null;
  }
}
