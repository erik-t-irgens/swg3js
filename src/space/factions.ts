// Who flies for whom in space, and who opens fire on whom. The game's server held all of this and
// none of it shipped: the table below is invented, after the game's own factions, and kept in this
// one file so a fight that reads wrong is one line to change.
//
// Pure: no three, no rapier; node's tests import it straight from source.
import type { Aggression, Side } from '../combat/kit.ts';

export type ShipFaction = 'player' | 'imperial' | 'rebel' | 'blacksun' | 'pirate' | 'neutral';

export const FACTION_LABEL: Record<ShipFaction, string> = { player: 'You', imperial: 'Imperial', rebel: 'Rebel', blacksun: 'Black Sun', pirate: 'Pirate', neutral: 'Neutral' };
/** CSS colours for the comms line. */
export const FACTION_COLOR: Record<ShipFaction, string> = { player: '#e8f0ff', imperial: '#9fb8d8', rebel: '#ff9a6a', blacksun: '#c08aff', pirate: '#ffd060', neutral: '#d0d0d0' };

/**
 * Who opens fire on whom unprovoked (invented). The Empire attacks everyone but the neutral; the Rebels
 * never start on the player; Black Sun and the pirates attack the player and both militaries but leave
 * each other alone, so the raiders round one anchor do not wipe each other out before the player comes.
 * The player's row is the others' rows turned round (who the player's guns should take first).
 */
const ATTACKS: Record<ShipFaction, readonly ShipFaction[]> = {
  imperial: ['player', 'rebel', 'blacksun', 'pirate'],
  rebel: ['imperial', 'blacksun', 'pirate'],
  blacksun: ['player', 'imperial', 'rebel'],
  pirate: ['player', 'imperial', 'rebel'],
  neutral: [],
  player: ['imperial', 'blacksun', 'pirate'],
};

/** Whether `me` opens fire on `them` unprovoked (invented; retaliation is the brain's, on top of this). Nobody attacks its own faction. */
export function shipHostile(me: ShipFaction, them: ShipFaction): boolean {
  if (me === them) return false;
  return ATTACKS[me]?.includes(them) ?? false;
}

/** How the player's HUD shows a faction: an enemy attacks the player on sight, a friend never does and fights the enemies, the rest are neutral. */
export function shipStanding(f: ShipFaction): 'enemy' | 'friend' | 'neutral' {
  if (shipHostile(f, 'player')) return 'enemy';
  return f === 'rebel' ? 'friend' : 'neutral';
}

/** The `Side` a ship's `Living` face shows. */
export function sideOfFaction(f: ShipFaction): Side {
  switch (f) {
    case 'imperial':
      return 'imperial';
    case 'rebel':
      return 'rebel';
    case 'blacksun':
    case 'pirate':
      return 'hostile';
    case 'player':
      return 'player';
    default:
      return 'neutral';
  }
}

export function aggressionOfFaction(f: ShipFaction): Aggression {
  switch (f) {
    case 'imperial':
    case 'blacksun':
    case 'pirate':
      return 'aggressive';
    case 'rebel':
    case 'player':
      return 'defensive';
    default:
      return 'passive';
  }
}
