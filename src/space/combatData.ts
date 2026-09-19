// The ships pack's combat.json, as the ships command writes it: the NPC ship types and the garage hull
// each flies, their tier chassis and fits, the game's formations, taunts, hit effects and target
// effects, and each hull's damage and destruction effects. Fetched once for the page's life; a pack
// without it (converted before) is "no NPC ships".
//
// Pure: no three, no DOM beyond fetch; node's tests import it straight from source.
import type { FitDef } from '../vehicles/shipFit.ts';

export type CombatLayer = 'shield' | 'armor' | 'component' | 'chassis';
export type FormationName = 'arrow' | 'claw' | 'wall';
export type NpcFaction = 'imperial' | 'rebel' | 'blacksun' | 'pirate' | 'neutral';
export type TauntLines = Record<'entercombat' | 'gothit' | 'hityou' | 'death', string[]>;

export interface NpcTypeDef {
  /** The template's base name (`hutt_light_s01_tier1`). */
  id: string;
  /** The game's name for the type ("Scyk M3-A Light Fighter"). */
  name: string;
  family: string;
  base: string;
  style: string | null;
  tier: number;
  /** The garage hull (ship id) that draws it. */
  hull: string;
  /** Its ship_chassis.iff row, a key of `chassis`. */
  chassis: string;
  faction: NpcFaction;
  /** The taunt table it reads (a key of `taunts`, or one the pack lacks: none). */
  taunts: string;
  template?: string;
}

export interface CombatChassis {
  slots: Record<string, { compat?: string[]; hitweight: number; targetable: boolean }>;
  hitSounds?: string;
  /** A tier chassis's fit (the shape of a player hull's); absent on a player row or when it could not be built. */
  fit?: FitDef;
}

export interface HullFx {
  destroyed: string | null;
  damage: { from: number; to: number; hardpoint: string | null; position: [number, number, number] | null; particle: string }[];
}

export interface CombatFile {
  version: 1;
  /** Slots in metres in the leader's frame (X mirrored), in row order; slot 0 the leader. `flat` is X2D, 0, Z2D. */
  formations: Partial<Record<FormationName, { space: [number, number, number][]; flat: [number, number, number][] }>>;
  taunts: Record<string, TauntLines>;
  /** Per layer, the hit effect by weight [light, medium, heavy] and the event effect; particle files relative to the ships pack, or null. */
  hitEffects: Partial<Record<CombatLayer, { hit: (string | null)[]; event: (string | null)[] }>>;
  hitSounds: Record<string, Record<CombatLayer, string>>;
  target: {
    friendly: string | null;
    enemy: string | null;
    activate: string | null;
    activateEnemy: string | null;
    deactivate: string | null;
    scale: number;
    hardpoint?: string;
    sounds: { activate: string; deactivate: string; acquiring: string; acquired: string };
    overrides: Record<string, { friendly?: string | null; enemy?: string | null; scale?: number }>;
  };
  chassis: Record<string, CombatChassis>;
  types: NpcTypeDef[];
  hulls: Record<string, HullFx>;
  skipped: { id: string; why: string }[];
  counts?: { types: number; families: number; hulls: number; skipped: number; fits: number; formations: number; taunts: number; hitLayers: number; target: boolean };
}

/** A family as the NPC tab lists it: its name, faction and the tiers it has. */
export interface NpcFamily {
  family: string;
  base: string;
  style: string | null;
  faction: NpcFaction;
  /** The type's name at its lowest tier. */
  name: string;
  hull: string;
  tiers: number[];
}

/** The order the factions are listed in. */
const FACTION_ORDER: readonly NpcFaction[] = ['imperial', 'rebel', 'blacksun', 'pirate', 'neutral'];
const NONE: readonly [number, number, number][] = [];

/** Whether a parsed file has the shape this reader relies on. */
function looksRight(f: unknown): f is CombatFile {
  const x = f as Partial<CombatFile> | null;
  return !!x && x.version === 1 && Array.isArray(x.types) && typeof x.chassis === 'object' && x.chassis !== null;
}

export class CombatData {
  readonly file: CombatFile;
  private readonly byId = new Map<string, NpcTypeDef>();
  private familyList: NpcFamily[] | null = null;

  constructor(file: CombatFile) {
    // Every table a reader walks is there, even when the converter could not read it.
    file.formations ??= {};
    file.taunts ??= {};
    file.hitEffects ??= {};
    file.hitSounds ??= {};
    file.hulls ??= {};
    file.skipped ??= [];
    this.file = file;
    for (const t of file.types) this.byId.set(t.id, t);
  }

  /**
   * One fetch of `assets-private/ships/combat.json`; null when it is missing (Vite answers a missing file
   * with index.html and a 200, so the content type is checked), not JSON, or not version 1.
   */
  static async load(baseUrl: string): Promise<CombatData | null> {
    try {
      const res = await fetch(`${baseUrl}assets-private/ships/combat.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const file = (await res.json()) as unknown;
      if (!looksRight(file)) {
        console.warn('combat.json: not a version 1 file; no NPC ships');
        return null;
      }
      return new CombatData(file);
    } catch (err) {
      console.warn('combat.json did not read; no NPC ships', err);
      return null;
    }
  }

  typeById(id: string): NpcTypeDef | null {
    return this.byId.get(id) ?? null;
  }

  /** The types of a family (`hutt_light_s01`) or of a base (`hutt_light`, every style), by tier then family. */
  typesOfFamily(family: string): NpcTypeDef[] {
    return this.file.types.filter((t) => t.family === family || t.base === family).sort((a, b) => a.tier - b.tier || a.family.localeCompare(b.family));
  }

  /** Every family, sorted by faction then name (made once). */
  families(): NpcFamily[] {
    if (this.familyList) return this.familyList;
    const by = new Map<string, NpcFamily>();
    const lowest = new Map<string, number>();
    for (const t of this.file.types) {
      let f = by.get(t.family);
      if (!f) {
        f = { family: t.family, base: t.base, style: t.style, faction: t.faction, name: t.name, hull: t.hull, tiers: [] };
        by.set(t.family, f);
      }
      if (!f.tiers.includes(t.tier)) f.tiers.push(t.tier);
      if (t.tier < (lowest.get(t.family) ?? Infinity)) {
        lowest.set(t.family, t.tier);
        f.name = t.name;
        f.hull = t.hull;
      }
    }
    const list = [...by.values()];
    for (const f of list) f.tiers.sort((a, b) => a - b);
    list.sort((a, b) => FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction) || a.name.localeCompare(b.name) || a.family.localeCompare(b.family));
    this.familyList = list;
    return list;
  }

  chassis(name: string): CombatChassis | null {
    return Object.prototype.hasOwnProperty.call(this.file.chassis, name) ? this.file.chassis[name] : null;
  }

  hullFx(id: string): HullFx | null {
    return Object.prototype.hasOwnProperty.call(this.file.hulls, id) ? this.file.hulls[id] : null;
  }

  /** A formation's slots (in space, or the flat ones on a planet); an empty list when the pack lacks it. */
  formation(name: FormationName, flat: boolean): readonly [number, number, number][] {
    const f = this.file.formations[name];
    return (flat ? f?.flat : f?.space) ?? NONE;
  }

  taunts(table: string): TauntLines | null {
    return Object.prototype.hasOwnProperty.call(this.file.taunts, table) ? this.file.taunts[table] : null;
  }

  /** Every particle file the combat model places (hits, events, target, damage bands, explosions), once each. */
  effectFiles(): string[] {
    const out = new Set<string>();
    const add = (f: string | null | undefined) => {
      if (f) out.add(f);
    };
    for (const layer of Object.values(this.file.hitEffects)) {
      for (const f of layer?.hit ?? []) add(f);
      for (const f of layer?.event ?? []) add(f);
    }
    const t = this.file.target;
    if (t) {
      add(t.friendly);
      add(t.enemy);
      add(t.activate);
      add(t.activateEnemy);
      for (const o of Object.values(t.overrides ?? {})) {
        add(o.friendly);
        add(o.enemy);
      }
    }
    for (const h of Object.values(this.file.hulls)) {
      add(h.destroyed);
      for (const d of h.damage ?? []) add(d.particle);
    }
    return [...out];
  }
}
