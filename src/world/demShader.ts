// Which ground texture goes where, on a planet whose heights are real-world elevation.
//
// A converted world answers this from its terrain template: shader layers whose height, slope and
// fractal filters were authored against that world's own generated ground. A DEM planet has no
// template, so the question is asked here instead, of rules written in the planet entry and
// evaluated against the raster. The families themselves are borrowed from an installed pack --
// Lok's canyon rock, Tatooine's sand -- because the textures are the part worth reusing and the
// placement is the part that has to be ours.
//
// Rules are written in metres above sea level, not in game height. Geology is documented that way
// (the Redwall Limestone is at 1400 m, not at "870 above whatever the lowest point turned out to
// be"), and a rule set then survives re-cutting the same place at a different extent or lift.
import type { DemPatch } from './demTerrain';
// A type alone (the shipped paint, which the release carries beside this file).
import type { GroundPaint } from '../swg/terrain/groundPaint.ts';

/** One band of ground. The first rule that matches a point wins, so order them narrowest first. */
export interface GroundRule {
  /** The family's name in the borrowed pack, as `__debug.families(pack)` lists it. */
  family: string;
  /**
   * Degrees. Measured on the ground as built, which is gentler than the real place: resampling a
   * survey flattens every wall, so a 60 degree cliff may arrive as 25. `__debug.slopes()` reports
   * what this planet actually has and suggests thresholds from it; tuning by eye from geology
   * produces rules that never fire.
   */
  aboveSlope?: number;
  belowSlope?: number;
  /**
   * Metres a point sits below the mean of its neighbours: positive in a hollow, negative on a
   * nose or a ridge, near zero on an even face. This is the signal that stops a hillside being
   * one flat colour -- gullies collect what washes down them and ridges are scoured bare, at the
   * same height and the same angle. Values are small; a tenth of a metre is already a gully.
   */
  aboveHollow?: number;
  belowHollow?: number;
  /** Metres above sea level, as the survey gives them: the lift is added back before testing. */
  aboveElevation?: number;
  belowElevation?: number;
  /**
   * Metres the band's edges wander, so a boundary is a ragged line rather than a contour drawn
   * with a ruler. Strata really are near-horizontal, so keep this small on a canyon and large
   * anywhere the banding is a convenience rather than a fact.
   */
  fuzz?: number;
}

export interface GroundRules {
  /** Pack to take the families from. Its terrain is read for the table and nothing else. */
  pack: string;
  /** Family for anything no rule claims. */
  fallback: string;
  rules: GroundRule[];
}

/** Resolves a world position to one of the borrowed pack's family ids. */
export class DemShader {
  /** Names the pack did not have, reported once rather than per sample. */
  readonly missing: string[] = [];
  private readonly ids: number[];
  private readonly fallbackId: number;
  // Written out rather than as parameter properties: node's type stripping, which runs the tests, refuses those,
  // and `planets.ts` brings this file into every test that reads the planet list.
  private readonly spec: GroundRules;
  /** Game height to metres above sea level: the DEM's own lift, subtracted back out. */
  private readonly lift: number;
  /** Metres between height samples, for the slope. One tile is about right. */
  private readonly step: number;

  constructor(
    spec: GroundRules,
    /** The borrowed pack's families, by name. */
    families: ReadonlyMap<string, number>,
    lift: number,
    step = 4,
  ) {
    this.spec = spec;
    this.lift = lift;
    this.step = step;
    const find = (name: string): number => {
      const id = families.get(name) ?? families.get(name.toLowerCase());
      if (id === undefined) {
        if (!this.missing.includes(name)) this.missing.push(name);
        return -1;
      }
      return id;
    };
    this.ids = spec.rules.map((r) => find(r.family));
    this.fallbackId = find(spec.fallback);
    if (this.fallbackId < 0) {
      // Without somewhere to fall back to there is no ground at all, so take the first that exists.
      const first = families.values().next();
      this.fallbackId = first.done ? 0 : first.value;
    }
  }

  /**
   * The ground's paint (Map-maker II, `groundPaint.ts`), asked before any rule: a painted cell keeps its paint whatever the
   * rules say of the ground under it. In the raw frame about (0, 0), a real-elevation world's (`x` mirrored). Null asks none.
   */
  paint: GroundPaint | null = null;
  /** The world row's base family (Map-maker II), what no rule claims in place of the rules' own fallback; -1 for none. */
  baseId = -1;

  /**
   * The family at a world point: the paint's where it painted one, else the first rule that matches, else the world row's
   * base, else the rules' own fallback. `heightAt` is the terrain's own, so this sees exactly the ground the mesh and the
   * collider were built from, including the fractal detail added under the raster.
   */
  familyAt(x: number, z: number, heightAt: (x: number, z: number) => number): number {
    const p = this.paint;
    if (p !== null) {
      const painted = p.familyAtRaw(-x, z);
      if (painted !== 0) return painted;
    }
    if (!this.spec.rules.length) return this.baseId >= 0 ? this.baseId : this.fallbackId;
    const h = heightAt(x, z);
    const e = this.step;
    const hl = heightAt(x - e, z);
    const hr = heightAt(x + e, z);
    const hd = heightAt(x, z - e);
    const hu = heightAt(x, z + e);
    // Central differences, the same shape the shore gradient uses.
    const slope = Math.atan(Math.hypot((hr - hl) / (2 * e), (hu - hd) / (2 * e))) * 57.29577951308232;
    // Whether the ground curves away or into itself here, in metres, from the same four samples.
    const hollow = (hl + hr + hd + hu) / 4 - h;
    const elevation = h - this.lift;

    for (let i = 0; i < this.spec.rules.length; i++) {
      const id = this.ids[i];
      if (id < 0) continue;
      const r = this.spec.rules[i];
      // A band edge that wanders. Hashed from the position so it is stable frame to frame: a
      // boundary that shimmered as the ground rebuilt would be worse than a ruled line.
      const wobble = r.fuzz ? (hash2(x * 0.021, z * 0.021) - 0.5) * 2 * r.fuzz : 0;
      if (r.aboveSlope !== undefined && slope < r.aboveSlope) continue;
      if (r.belowSlope !== undefined && slope > r.belowSlope) continue;
      if (r.aboveHollow !== undefined && hollow < r.aboveHollow) continue;
      if (r.belowHollow !== undefined && hollow > r.belowHollow) continue;
      if (r.aboveElevation !== undefined && elevation + wobble < r.aboveElevation) continue;
      if (r.belowElevation !== undefined && elevation + wobble > r.belowElevation) continue;
      return id;
    }
    return this.baseId >= 0 ? this.baseId : this.fallbackId;
  }
}

/** What the rules see at a point, for tuning thresholds against real ground rather than geology. */
export function groundAt(x: number, z: number, heightAt: (x: number, z: number) => number, lift = 0, step = 4): { elevation: number; slope: number; hollow: number } {
  const h = heightAt(x, z);
  const hl = heightAt(x - step, z);
  const hr = heightAt(x + step, z);
  const hd = heightAt(x, z - step);
  const hu = heightAt(x, z + step);
  return {
    elevation: h - lift,
    slope: Math.atan(Math.hypot((hr - hl) / (2 * step), (hu - hd) / (2 * step))) * 57.29577951308232,
    hollow: (hl + hr + hd + hu) / 4 - h,
  };
}

/** A stable value in [0, 1) from a position. Not noise, just something that does not repeat. */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * The Grand Canyon against Lok's families, on three signals at once.
 *
 * Elevation alone gives horizontal stripes, which is almost right for stratified rock and wrong
 * for everything else about a landscape. Slope says whether a point is a face or a shelf, and
 * hollow says whether it is a gully or a nose -- and those two vary enormously *within* a band,
 * which is what stops a hillside being one colour.
 *
 * So the shape is: steep ground takes the band's cliff rock, hollows take what washes into them,
 * flats take what settles on them, and the band's own rock fills the rest. Elevation chooses
 * which cliff and which rock; slope and hollow choose where each goes.
 *
 * The slope numbers are deliberately low. Run `__debug.slopes()` on your own conversion and move
 * them to its suggestions: a 10 m survey flattens a 60 degree wall to 25, and a rule written for
 * the real angle never fires. Elevations are metres above sea level, so they survive a re-cut.
 */
export const GRAND_CANYON_LOK: GroundRules = {
  pack: 'lok',
  fallback: 'dirt_redsandy',
  rules: [
    // --- the river and its flats -------------------------------------------------------------
    { family: 'dirt_dath_desertcanyonfloor', belowElevation: 820, belowSlope: 4 },

    // --- anything steep, by which band it is in ------------------------------------------------
    // Taken first and over the whole height, because a face reads as rock whatever is around it.
    { family: 'rock_dath_desertcanyon', belowElevation: 1120, aboveSlope: 29, fuzz: 25 },
    { family: 'rock_cliffbrowngray', belowElevation: 1400, aboveSlope: 16, fuzz: 30 },
    { family: 'rock_rusted_orange', belowElevation: 1700, aboveSlope: 16, fuzz: 30 },
    { family: 'rock_dath_cliffred', belowElevation: 1950, aboveSlope: 16, fuzz: 35 },
    { family: 'rock_lok_whitecliff', belowElevation: 2060, aboveSlope: 16, fuzz: 20 },
    { family: 'rock_dath_desertdirty', aboveSlope: 29 },

    // --- gullies: what washes down collects in them, at any height ----------------------------
    { family: 'sand_clumpy', aboveHollow: 0.4, belowElevation: 1400 },
    { family: 'dirt_lok_smallrock', aboveHollow: 0.4 },

    // --- noses and spurs: scoured, so bare rock even where it is not steep --------------------
    { family: 'rock_dath_desertcanyon', belowHollow: -0.45, belowElevation: 1400 },
    { family: 'rock_dath_cliffred', belowHollow: -0.45, belowElevation: 1950 },

    // --- flats: what settles, by height -------------------------------------------------------
    { family: 'grss_dsrt_dry_trans', aboveElevation: 2050, belowSlope: 4 },
    { family: 'dirt_grasslands', aboveElevation: 1950, belowSlope: 4 },
    { family: 'sand_bumpy', belowElevation: 1200, belowSlope: 4 },

    // --- the even slopes between: the band's own rock, worn rather than cut -------------------
    { family: 'rock_dath_desertcanyon', belowElevation: 1120, fuzz: 25 },
    { family: 'rock_cliffbrowngray', belowElevation: 1400, fuzz: 30 },
    { family: 'rock_rusted_orange', belowElevation: 1700, fuzz: 30 },
    { family: 'rock_dath_cliffred', belowElevation: 1950, fuzz: 35 },
    { family: 'rock_lok_whitecliff', belowElevation: 2060, fuzz: 20 },
    { family: 'dirt_redsandy' },
  ],
};