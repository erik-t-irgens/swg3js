// The outdoor walk grid's rules (Map-maker II, DESIGN.md §2.8): the bake's slope and water tests, its placement
// rasteriser, its margin and its pack, moved out of `tools/swg/navgrid.mjs` word for word so the bake and anything else
// that ever reads a grid's rules share one copy. The converter's bake (`buildNavGrid`) is these calls over a world's
// heights, its water and its placed objects; Map-maker II's fifth wave adds the committed edit files of a world to what
// it reads (the heights file's deltas laid over the generated poles, the water file's lakes beside the client's tables,
// and the solid permanent rows rasterised as placed objects are), and the owner's answer of 2026-10-26 (reconvert, no
// run-time patch) is why there is no patch here: the grid follows the files when it is baked again.
//
// What a cell is, and why it is two metres, and how the margin and the ranks are read, is told in `navgrid.mjs`'s head.
//
// Pure, and imports nothing: the release's own source list carries it (`tools/launcher/pack.mjs`, `SOURCE_FILES`), since
// the shipped bake names it. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** The player's own numbers, read off `src/player/player.ts` and repeated for fighters in `fighterStance.ts`. */
export const AGENT_RADIUS = 0.35;
export const AUTOSTEP = 0.5;
export const BODY_TOP = 1.6;
/**
 * The angle the grid calls climbable, and the owner's own choice rather than a fact about the game.
 *
 * Two different bodies walk this ground and they are stopped by two different angles.
 *
 * A **fighter** has the player's own character controller and its `setMaxSlopeClimbAngle(55)`, and
 * that was checked in a real physics world under node rather than taken on trust: a controller
 * driven at a ramp climbs 54 degrees and is stopped dead at 56. So for a fighter, 55 is the truth.
 *
 * A **catalogue mobile** is not a controller -- it is a dynamic body with its rotations locked,
 * driven by `setLinvel` -- and the solver decides, so its limit is not one angle at all. Driven at
 * a trimesh ramp for twenty seconds it climbs the whole of a 48-degree face at 5.2 m/s and 6.9 m/s,
 * gets 19 m up it at 3.5 and less than a metre at 1.8; at 1.8 m/s it is already down to 3.9 m at
 * 44. So its limit moves with speed, from about 45 at a walk to about 49 at a hard run, and at
 * every speed and at every size measured -- a womp rat's capsule, a person's, a bantha's -- 50
 * degrees and above stops it dead.
 *
 * That settles the thing that was in doubt, and the opposite way round from the worry: the wildlife
 * does **not** scrabble up faces a fighter refuses. It is stopped by faces a fighter walks,
 * everywhere between about 45 and 55 degrees.
 *
 * The default was 47, the run-flat-out figure above, and is now **45**, which is the owner's call
 * twice over and written down here as theirs: their words were that "even in real life 45 is
 * pretty difficult", and when the catalogue's own people and creatures were given this grid to walk
 * (the NPC pass's D8) they chose the angle that covers a mobile **at a walk**, since a patrol, a
 * wander and a body walking home all go at one and 47 promised them faces they stall on at 1.8 m/s.
 * The game reads the angle a grid was baked at (`slopeDegrees` in `nav.json`) and hands a catalogue
 * mobile no grid steeper than `MOBILE_CLIMB_DEGREES` in `src/world/nav/outdoorNav.ts`, so a world
 * still carrying a 47-degree bake paths its fighters as before and its creatures not at all until
 * `status` has asked for the re-bake and it has run.
 *
 * **What it costs, plainly.** Ground between 45 and 55 degrees is ground a *fighter* can climb and
 * this grid now refuses, so a route for a fighter may go round a face it could have walked up. That
 * is a deliberate trade and not an oversight: a grid that routes a creature up a face it cannot
 * climb leaves it leaning on the hill until its stuck watch throws the route away, while a grid
 * that walks a fighter round a slope merely takes it the long way. One failure is visible for the
 * rest of the evening and the other is a longer walk, so the grid is cut to the body that can do
 * least. `--slope=` moves it for a run: 55 is the first grid exactly, 47 the one before this.
 */
export const SLOPE_CLIMB_DEGREES = 45;
/** Chest deep: past this the game calls it swimming and there are no feet at all. */
export const SWIM_DEPTH = 1.2;

/** Fine cells to a coarse one. Eight at a two-metre cell is a sixteen-metre coarse cell. */
export const COARSE = 8;
/**
 * How much of a coarse cell must be walkable for the coarse plane to offer it. An eight-metre
 * street through a sixteen-metre cell is half of it, so a third leaves streets open while a cell
 * that is mostly wall is refused. Invented, and the one number here that shapes what the runtime's
 * first search pass can see.
 */
export const COARSE_SHARE = 1 / 3;

/**
 * How far from the nearest unwalkable cell the clearance plane still counts, in cells. Past it
 * every cell reads the same number, which is what makes the plane compress: on a real world the
 * open ground is one long run of `CLEARANCE_MAX` and deflate pays almost nothing for it.
 *
 * Seven cells is fourteen metres at the terrain's own two, which is a good deal wider than any
 * berth the runtime asks for (`OUTDOOR_TUNE.berth`) and leaves that knob room to be moved live
 * without re-baking. It also fits a nibble, so the plane is exactly the size of the region plane
 * beside it and the two are read the same way.
 */
export const CLEARANCE_MAX = 7;

/** Nibble values. 1..RANKS are the largest regions by area; RANKS+1 is anything smaller. */
export const RANKS = 13;
export const OTHER_REGION = 14;
export const INDOOR = 15;

/**
 * How far below and above the ground a portal building's own room geometry still counts as that
 * building's footprint, metres. A dungeon room two hundred metres under the desert is not a
 * footprint on it, and an upper storey is not one either -- the ground floor covers the same
 * ground. Both invented, and both are the cheapest way to say "near enough to where a body outside
 * is walking".
 */
export const INDOOR_BELOW = 3;
export const INDOOR_ABOVE = 5;

/**
 * How far a building's rooms must rise over the ground at a cell for that cell to be the building's
 * footprint, metres: the autostep, the height the grid already calls something a body walks over.
 *
 * The band above says which room geometry is **near** the ground, and on its own it was one rule too
 * few. Fort Tusken's courtyard is open sky over rooms dug into the rock, and two of those rooms have
 * their ceilings a metre or two under the sand (the ninth room's is 2.45 m down, the eleventh's 1.28),
 * so the band called the ground over them the fort's footprint. The small Tatooine house has the same
 * shape the other way round: a basement reaching out under its own yard. What tells a courtyard over
 * a cellar from a cantina's floor is not how near the ground a room comes but whether the building
 * comes **up out of it** there: a room somebody on the ground walks into has a wall, a ceiling, a roof
 * or at the least a doorway standing over the ground, while a room under the ground has nothing higher
 * than its own ceiling, and that is under the feet. So a cell is a footprint when some room comes near
 * the ground there and the highest of the building's geometry over it -- a room's or the shell's, at
 * any height -- stands more than this above the ground. A tall hall whose ceiling is past the band
 * still counts, because the rise is measured over every triangle and not only the band's; a hillside
 * that covers a room dug into it opens, which is the ground a body really walks on there.
 */
export const INDOOR_RISE = AUTOSTEP;

/**
 * The rules a grid was baked by, written into `nav.json` as `rules` so a grid baked by older ones can
 * be told from a new one: 1 (or absent) a footprint by the band alone and every blocked cell grown by
 * a whole cell; 2 a footprint by the band and the rise (`INDOOR_RISE`) and an object's cell grown only
 * across the sides its geometry hugs (`growMargin`). The game reads grids of either and never looks
 * at this; `status` and `--skip-existing` ask for a bake again under a grid older than this, since
 * nothing else about such a grid would ever say it was baked by the old rules.
 */
export const NAV_BAKE_RULES = 2;

/**
 * Whether a cell is a building's footprint: some room of the building comes near the ground there
 * (`near`, the band), and the highest of the building's geometry over the cell -- a room's or its
 * shell's -- stands more than `INDOOR_RISE` above the ground (`highestOver`, metres over the ground;
 * -Infinity for none).
 */
export function isFootprint(near: boolean, highestOver: number): boolean {
  return near && highestOver > INDOOR_RISE;
}

/**
 * Whether a placed object is a portal building, which is the one thing that decides whether its
 * rooms are read as a footprint at all. It is `def.cells`, the manifest's own record of the cells
 * the converter found in that model, and nothing else: a model with no `cells` has no rooms to
 * read, so its interior triangles are skipped as any other model's are.
 *
 * It is a function of its own, and tested, because getting it wrong is silent in exactly the wrong
 * way: a pack whose layout entries carry no `cells` bakes with not one indoor cell, every building
 * inside is as free as the open desert, and a string-pull walks a body straight through a cantina
 * -- with nothing in the file or in `status` to say so. The bake counts what this answered and says
 * when a world has buildings and no footprints, which is the other half of the same guard.
 */
export function isBuildingDef(def: { cells?: unknown } | null | undefined): boolean {
  return Array.isArray(def?.cells) && (def!.cells as unknown[]).length > 0;
}

/**
 * Whether a room triangle at height `y`, over ground at `ground`, counts as its building's
 * footprint. A dungeon room two hundred metres under the desert must not wall off the desert over
 * it, and an upper storey is not a footprint either -- the ground floor covers the same ground.
 */
export function indoorFootprint(y: number, ground: number): boolean {
  return y >= ground - INDOOR_BELOW && y <= ground + INDOOR_ABOVE;
}

const BLOCK_SLOPE = 1;
const BLOCK_OBJECT = 2;
const BLOCK_WATER = 4;
const MARK_INDOOR = 8;
/** A cell some room came near the ground at, whether or not it rose over it: what the band alone would have marked. */
const MARK_NEAR = 16;

/** A cell's reasons, as the bake keeps them one byte a cell (and returns them, for a census). */
export const NAV_FLAGS = { slope: BLOCK_SLOPE, object: BLOCK_OBJECT, water: BLOCK_WATER, indoor: MARK_INDOOR, near: MARK_NEAR };

/** The sides of a cell an object's geometry comes within a body's half-width of: -x, +x, -z, +z. */
export const EDGE = { west: 1, east: 2, north: 4, south: 8 };

/**
 * How many samples a triangle is given per cell of its length in the ground plane: a metre apart at
 * two-metre cells, as the bake has always sampled. The cap is on samples along one edge, so a vast
 * triangle costs no more than one forty-eight cells long.
 *
 * It was measured at four, half a metre apart, which would let the margin (`growMargin`) see more
 * nearly where a wall crosses a cell's side, and it was put back, because denser samples do not only
 * place geometry better, they find more of it: thin branches, a cave room's rim closed into a ring.
 * At four the rebaked worlds lost ground as well as gaining it -- 0.43 km² of Mustafar's main region
 * cut off behind its monster lairs' rooms, 0.18 km² of the Rryatt Trail's behind its trees -- where at
 * two the grid baked by `rules: 2` is the older grid with cells taken away from what it blocked and
 * called a floor and nothing added, so no place anybody could walk to before is lost. What the margin
 * then promises is a body's half-width off every **sample**; a wall between two samples can come up
 * to half a metre nearer, which is the thin geometry the bake has always under-blocked and the solver
 * slides a body along.
 */
export const SAMPLES_PER_CELL = 2;
const SAMPLE_CAP = 48 * SAMPLES_PER_CELL;

/**
 * Which sides of its cell a point at `u, v` (its place across the cell, 0 to 1 each way) stands
 * within `reach` of (`reach` too in cells), as `EDGE` bits.
 */
export function edgesNear(u: number, v: number, reach: number): number {
  return (u < reach ? EDGE.west : 0) | (1 - u < reach ? EDGE.east : 0) | (v < reach ? EDGE.north : 0) | (1 - v < reach ? EDGE.south : 0);
}

/**
 * The body's own margin: the blocked set grown by `grow` cells, four-neighbour, one byte a cell of
 * the answer non-zero for blocked. `flags` is the bake's reasons a cell (`NAV_FLAGS`) and `edgeNear`
 * which sides of an object-blocked cell its geometry hugs (`EDGE`).
 *
 * Every cell blocked by the slope or by water grows by the whole margin, as the grid always did:
 * a steep cell is steep all over, and the ground's own edges are where a body should stand off most.
 *
 * A cell blocked only by an object grows, when `byEdge`, into a neighbour only across a side its
 * geometry comes within a body's half-width of. Grown by a whole cell on every side, as it was, a
 * wall stood two metres thicker on each face than the body it stands off is wide, and every lane and
 * yard narrower than about six metres closed in the grid while a body 0.7 m wide walks down all of
 * them. Fort Tusken is where that showed: its courtyard is lanes about four metres wide between the
 * huts, and its seven doors on the ground let out onto five separate islands of one to forty-one cells,
 * so nothing standing in the courtyard could be routed to a door it was not already beside. Grown by
 * the side, five of the seven let out onto one courtyard of 154 cells. Growing across a side only where
 * something stands within the half-width of it keeps what the margin is for across every side -- no
 * open cell that shares a side with an object's cell has any of its sampled geometry nearer that side
 * than a body's half-width -- and drops the metre and a half more it was also taking. It only ever
 * blocks a subset of what the whole-cell margin blocked.
 *
 * What it does not promise, and what the runtime answers for instead: a line may run anywhere inside
 * an open cell, so a route between cell middles can pass that half-width from geometry and no more,
 * and a cell that meets an object's cell only at a corner is not grown into at all (geometry hugging
 * that corner blocks the two cells beside it, so the corner is a notch a line cannot enter, but the
 * line can come to its point). A body wider than the half-width is kept off both by the runtime's
 * string-pull, which holds its legs the body's own width less this margin off anything the grid does
 * not call open (`legInset` in `src/world/nav/outdoorGrid.ts`). It does not open the fort's gate,
 * which is a single two-metre cell between the wall's ends and is narrower than a two-metre grid can
 * be sure of. `byEdge` false is the whole-cell margin exactly, for a comparison.
 *
 * By the side only while the margin is one cell: at a cell under the half-width (`--cell=0.3`,
 * `grow` 2), geometry within the half-width of a side can reach past the next cell, and one neighbour
 * would be too little, so there every object's cell grows the whole diamond as it always did.
 */
export function growMargin(nx: number, nz: number, flags: Uint8Array, edgeNear: Uint8Array, grow: number, byEdge = true): Uint8Array {
  const solid = new Uint8Array(nx * nz);
  const whole = BLOCK_SLOPE | BLOCK_WATER | (byEdge && grow <= 1 ? 0 : BLOCK_OBJECT);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const f = flags[k];
      if (f & whole) {
        for (let dj = -grow; dj <= grow; dj++) {
          for (let di = -grow; di <= grow; di++) {
            if (Math.abs(di) + Math.abs(dj) > grow) continue;
            const jj = j + dj, ii = i + di;
            if (jj < 0 || ii < 0 || jj >= nz || ii >= nx) continue;
            solid[jj * nx + ii] = 1;
          }
        }
        continue;
      }
      if (!(f & BLOCK_OBJECT)) continue;
      solid[k] = 1;
      if (!grow) continue;
      const e = edgeNear[k];
      if (e & EDGE.west && i > 0) solid[k - 1] = 1;
      if (e & EDGE.east && i + 1 < nx) solid[k + 1] = 1;
      if (e & EDGE.north && j > 0) solid[k - nx] = 1;
      if (e & EDGE.south && j + 1 < nz) solid[k + nx] = 1;
    }
  }
  return solid;
}

/**
 * The rules one bake runs by, out of its options, and the stamp it writes for them: the margin by the
 * side (`byEdge`, false under `margin: 'cell'`) and the footprint by the band alone (`byBand`, under
 * `footprint: 'band'`). Both older ones together are the older bake byte for byte, and anything short
 * of both newer ones is stamped 1, so `status` asks for such a grid again.
 */
export function bakeRules(opts: { margin?: string; footprint?: string } = {}): { byEdge: boolean; byBand: boolean; stamp: number } {
  const byEdge = opts.margin !== 'cell';
  const byBand = opts.footprint === 'band';
  return { byEdge, byBand, stamp: byEdge && !byBand ? NAV_BAKE_RULES : 1 };
}

/** Where one placement stands in the grid's frame: its place and the nine numbers of its turn (and scale), row by row. */
export interface PlacementFrame {
  gx: number;
  y: number;
  gz: number;
  r00: number;
  r01: number;
  r02: number;
  r10: number;
  r11: number;
  r12: number;
  r20: number;
  r21: number;
  r22: number;
}

/**
 * Where one placed object stands in the grid's frame: its place (`gx`, `y`, `gz`) and the rotation of
 * the runtime's own placed quaternion, (q[1], -q[2], -q[3], q[0]), which is the X mirror, as nine
 * numbers. `cx`, `cz` are the pack's centre.
 */
export function placementFrame(o: { x: number; y: number; z: number; q: readonly number[] }, cx: number, cz: number): PlacementFrame {
  const qx = o.q[1], qy = -o.q[2], qz = -o.q[3], qw = o.q[0];
  return {
    gx: cx - o.x,
    y: o.y,
    gz: o.z - cz,
    r00: 1 - 2 * (qy * qy + qz * qz), r01: 2 * (qx * qy - qz * qw), r02: 2 * (qx * qz + qy * qw),
    r10: 2 * (qx * qy + qz * qw), r11: 1 - 2 * (qx * qx + qz * qz), r12: 2 * (qy * qz - qx * qw),
    r20: 2 * (qx * qz - qy * qw), r21: 2 * (qy * qz + qx * qw), r22: 1 - 2 * (qx * qx + qy * qy),
  };
}

/**
 * A placement frame stood at a scale along its own axes (`sx`, `sy`, `sz`, each column of the turn times its axis's
 * size), as the runtime stands a scaled permanent row: its model's point (X, Y, Z) lands at the turn of (sx X, sy Y, sz Z).
 * At 1, 1, 1 the frame handed in, the very object.
 */
export function scaledFrame(f: PlacementFrame, sx: number, sy: number, sz: number): PlacementFrame {
  if (sx === 1 && sy === 1 && sz === 1) return f;
  return {
    gx: f.gx, y: f.y, gz: f.gz,
    r00: f.r00 * sx, r01: f.r01 * sy, r02: f.r02 * sz,
    r10: f.r10 * sx, r11: f.r11 * sy, r12: f.r12 * sz,
    r20: f.r20 * sx, r21: f.r21 * sy, r22: f.r22 * sz,
  };
}

/** A placement standing at the grid's origin unturned: what a node test draws a model in. */
export const IDENTITY_FRAME: Readonly<PlacementFrame> = Object.freeze({ gx: 0, y: 0, gz: 0, r00: 1, r01: 0, r02: 0, r10: 0, r11: 1, r12: 0, r20: 0, r21: 0, r22: 1 });

/** The world's cells and the arithmetic over them, as `rasterPlacement` reads them, with its scratch. */
export interface RasterBake {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
  flags: Uint8Array;
  edgeNear: Uint8Array;
  heightAt(x: number, z: number): number;
  byBand: boolean;
  nearGround: Set<number>;
  highest: Map<number, number>;
}

/**
 * One placement of one model, rasterised into the bake's cells: the whole of what a placed object
 * does to the grid, and a function of its own so a node test can draw a building and bake it exactly
 * as a planet's are baked.
 *
 * `bake` is the world's cells and the arithmetic over them -- `nx`, `nz`, `x0`, `z0`, `cell`, the
 * `flags` a cell (`NAV_FLAGS`), the `edgeNear` sides a cell's object geometry hugs (`EDGE`), the ground
 * `heightAt(x, z)`, `byBand` (`bakeRules`), and the scratch `nearGround` set and `highest` map it
 * empties and fills for this placement. `positions` are the model's triangles, three corners of three
 * numbers each, and `cells` each triangle's portal cell (0 the shell, above it a room). `frame` is
 * `placementFrame`'s.
 *
 * What it does: the shell's geometry that stands between the autostep and the top of a body blocks
 * its cell as an object and says which of the cell's sides it comes within a body's half-width of;
 * a building's rooms and shell are gathered -- where a room comes near the ground, and how high the
 * highest of the building stands over the ground at each cell -- and once the whole placement is read
 * each cell a room came near is its footprint (`indoor`) where the building rises over it and is left
 * open ground where it does not (`isFootprint`), or is a footprint anyway under the older band rule.
 * Answers how many triangles it read and how many cells it newly marked as objects, as footprints,
 * and opened.
 */
export function rasterPlacement(bake: RasterBake, positions: ArrayLike<number>, cells: ArrayLike<number>, isBuilding: boolean, frame: PlacementFrame): { triangles: number; objectCells: number; indoorCells: number; opened: number } {
  const { nx, nz, x0, z0, cell, flags, edgeNear, heightAt, byBand, nearGround, highest } = bake;
  const { gx, y: gy, gz, r00, r01, r02, r10, r11, r12, r20, r21, r22 } = frame;
  const reach = AGENT_RADIUS / cell;
  let triangles = 0;
  let objectCells = 0;
  let indoorCells = 0;
  nearGround.clear();
  highest.clear();
  for (let t2 = 0; t2 < cells.length; t2++) {
    const inside = cells[t2] > 0;
    // The shell marks what a body outside walks into; the rooms mark where the indoor pathing
    // takes over. Nothing else in the model matters to somebody outdoors.
    if (inside && !isBuilding) continue;
    triangles++;
    const p: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const b = (t2 * 3 + k) * 3;
      const X = positions[b], Y = positions[b + 1], Z = positions[b + 2];
      p.push([
        gx + r00 * X + r01 * Y + r02 * Z,
        gy + r10 * X + r11 * Y + r12 * Z,
        gz + r20 * X + r21 * Y + r22 * Z,
      ]);
    }
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    // Sampled at no more than `SAMPLES_PER_CELL` to a cell in the ground plane, capped so that
    // one huge triangle cannot cost more than the rest of the model. It under-blocks very thin
    // or very large geometry, which errs the opposite way from taking the model's box.
    const n1 = Math.min(SAMPLE_CAP, Math.max(1, Math.ceil((Math.hypot(e1[0], e1[2]) * SAMPLES_PER_CELL) / cell)));
    const n2 = Math.min(SAMPLE_CAP, Math.max(1, Math.ceil((Math.hypot(e2[0], e2[2]) * SAMPLES_PER_CELL) / cell)));
    for (let a = 0; a <= n1; a++) {
      for (let b = 0; a / n1 + b / n2 <= 1 && b <= n2; b++) {
        const u = a / n1, v = b / n2;
        const X = p[0][0] + e1[0] * u + e2[0] * v;
        const Y = p[0][1] + e1[1] * u + e2[1] * v;
        const Z = p[0][2] + e1[2] * u + e2[2] * v;
        const i = Math.floor((X - x0) / cell);
        const j = Math.floor((Z - z0) / cell);
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const g = heightAt(X, Z);
        const k = j * nx + i;
        if (inside) {
          // A room's own geometry near the ground, where some of the building also rises over it, is
          // the building's footprint, by the rules `indoorFootprint` and `isFootprint` hold. Both are
          // gathered here and decided once the whole placement is read, since the ceiling that rises
          // over a cell may come after the floor that is near it.
          const over = Y - g;
          const had = highest.get(k);
          if (had === undefined || over > had) highest.set(k, over);
          if (indoorFootprint(Y, g)) nearGround.add(k);
          continue;
        }
        // A building's shell rises over its rooms as well: the roof over a stair down, the walls
        // round a room whose own triangles stop short of them.
        if (isBuilding) {
          const over = Y - g;
          const had = highest.get(k);
          if (had === undefined || over > had) highest.set(k, over);
        }
        if (Y < g + AUTOSTEP || Y > g + BODY_TOP) continue;
        if (!(flags[k] & BLOCK_OBJECT)) {
          flags[k] |= BLOCK_OBJECT;
          objectCells++;
        }
        // Which of the cell's sides the geometry comes within a body's half-width of, which is
        // all the margin needs to know about where in the cell it stands (`growMargin`).
        edgeNear[k] |= edgesNear((X - x0) / cell - i, (Z - z0) / cell - j, reach);
      }
    }
  }
  let opened = 0;
  for (const k of nearGround) {
    flags[k] |= MARK_NEAR;
    if (!byBand && !isFootprint(true, highest.get(k) ?? -Infinity)) {
      opened++;
      continue;
    }
    if (!(flags[k] & MARK_INDOOR)) {
      flags[k] |= MARK_INDOOR;
      indoorCells++;
    }
  }
  return { triangles, objectCells, indoorCells, opened };
}

/**
 * One collision shape of a permanent flora row in the grid's frame, read as the game's own collider part is
 * (`ColliderPart`, `floraShapes.ts`'s `rowFloraParts`): an upright cylinder (middle `x, y, z`, radius `r`, half height
 * `hy`), a ball (middle, radius), a box turned about up (middle, half extents `hx, hy, hz`, the turn's quaternion y and w)
 * or a mesh (its vertices in the world and its triangles).
 */
export interface PartShape {
  kind: 'cyl' | 'ball' | 'box' | 'mesh';
  x: number;
  y: number;
  z: number;
  r: number;
  hx: number;
  hy: number;
  hz: number;
  qy: number;
  qw: number;
  verts: ArrayLike<number> | null;
  idx: ArrayLike<number> | null;
}

/**
 * A permanent flora row's own collision shapes rasterised into the bake's cells (Map-maker II's fifth wave): the very
 * shapes the game stands it on (`rowFloraParts`: its trunk, a rock's cylinders, a log's box, nothing for a NULL extent the
 * client walked through), never its model's triangles, canopy and all, which the game never makes solid for such a row.
 * A mesh shape is rasterised as a placed object's triangles are (`rasterPlacement`, through no turn); a cylinder, a ball
 * and a box by points over their footprint on the ground -- the middle, a lattice at `SAMPLES_PER_CELL` to a cell and the
 * rim -- each counting where the shape's own span over that point reaches into the band between the autostep and the top
 * of a body, exactly as a triangle's sampled point counts, its cell marked an object's and the sides it comes within a
 * body's half-width of kept for the margin. Answers how many cells it newly marked and how many triangles it read.
 */
export function rasterParts(bake: RasterBake, parts: readonly PartShape[]): { objectCells: number; triangles: number } {
  const { nx, nz, x0, z0, cell, flags, edgeNear, heightAt } = bake;
  const reach = AGENT_RADIUS / cell;
  const step = cell / SAMPLES_PER_CELL;
  let objectCells = 0;
  let triangles = 0;
  const mark = (X: number, Z: number, lo: number, hi: number): void => {
    const i = Math.floor((X - x0) / cell);
    const j = Math.floor((Z - z0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const g = heightAt(X, Z);
    if (hi < g + AUTOSTEP || lo > g + BODY_TOP) return;
    const k = j * nx + i;
    if (!(flags[k] & BLOCK_OBJECT)) {
      flags[k] |= BLOCK_OBJECT;
      objectCells++;
    }
    edgeNear[k] |= edgesNear((X - x0) / cell - i, (Z - z0) / cell - j, reach);
  };
  for (const p of parts) {
    if (p.kind === 'mesh') {
      const v = p.verts;
      const idx = p.idx;
      if (!v || !idx || idx.length < 3) continue;
      const n = idx.length - (idx.length % 3);
      const positions = new Float64Array(n * 3);
      for (let t = 0; t < n; t++) {
        const a = idx[t] * 3;
        positions[t * 3] = v[a];
        positions[t * 3 + 1] = v[a + 1];
        positions[t * 3 + 2] = v[a + 2];
      }
      const r = rasterPlacement(bake, positions, new Uint8Array(n / 3), false, IDENTITY_FRAME);
      objectCells += r.objectCells;
      triangles += r.triangles;
      continue;
    }
    if (p.kind === 'cyl' || p.kind === 'ball') {
      const r = p.r;
      if (!(r > 0)) continue;
      const span = (d: number): number => (p.kind === 'cyl' ? p.hy : Math.sqrt(Math.max(0, r * r - d * d)));
      const at = (X: number, Z: number): void => {
        const dx = X - p.x;
        const dz = Z - p.z;
        const h = span(Math.sqrt(dx * dx + dz * dz));
        mark(X, Z, p.y - h, p.y + h);
      };
      at(p.x, p.z);
      const n = Math.min(SAMPLE_CAP, Math.max(1, Math.ceil((2 * r) / step)));
      for (let a = 0; a <= n; a++) {
        for (let b = 0; b <= n; b++) {
          const X = p.x - r + (2 * r * a) / n;
          const Z = p.z - r + (2 * r * b) / n;
          const dx = X - p.x;
          const dz = Z - p.z;
          if (dx * dx + dz * dz <= r * r) at(X, Z);
        }
      }
      const rim = Math.min(4 * SAMPLE_CAP, Math.max(8, Math.ceil((2 * Math.PI * r) / step)));
      for (let k = 0; k < rim; k++) {
        const a = (2 * Math.PI * k) / rim;
        at(p.x + r * Math.cos(a), p.z + r * Math.sin(a));
      }
      continue;
    }
    // A box turned about up by three's own sense: its local (u, v) on the ground at (u cos + v sin, -u sin + v cos).
    if (!(p.hx > 0) || !(p.hz > 0)) continue;
    const turn = 2 * Math.atan2(p.qy, p.qw);
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const nu = Math.min(SAMPLE_CAP, Math.max(1, Math.ceil((2 * p.hx) / step)));
    const nv = Math.min(SAMPLE_CAP, Math.max(1, Math.ceil((2 * p.hz) / step)));
    for (let a = 0; a <= nu; a++) {
      for (let b = 0; b <= nv; b++) {
        const u = -p.hx + (2 * p.hx * a) / nu;
        const w = -p.hz + (2 * p.hz * b) / nv;
        mark(p.x + u * c + w * s, p.z - u * s + w * c, p.y - p.hy, p.y + p.hy);
      }
    }
  }
  return { objectCells, triangles };
}

/**
 * The slope test: every cell whose ground rises past `limit` (a tangent) over one pole step -- along x, along z or along
 * the diagonal, at any of the poles it holds -- marked `slope`. `heights` is the pole lattice the bake made (`pnx` poles a
 * row, `per` poles to a cell, `pole` metres between them). Answers how many cells it marked.
 */
export function markSlope(heights: Float32Array, pnx: number, nx: number, nz: number, per: number, pole: number, limit: number, flags: Uint8Array): number {
  let slopeCells = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let steep = false;
      for (let dj = 0; dj < per && !steep; dj++) {
        for (let di = 0; di < per && !steep; di++) {
          const pi = i * per + di, pj = j * per + dj;
          const h = heights[pj * pnx + pi];
          const dx = Math.abs(heights[pj * pnx + pi + 1] - h);
          const dz = Math.abs(heights[(pj + 1) * pnx + pi] - h);
          const dd = Math.abs(heights[(pj + 1) * pnx + pi + 1] - h) / Math.SQRT2;
          if (Math.max(dx, dz, dd) / pole > limit) steep = true;
        }
      }
      if (steep) {
        flags[j * nx + i] |= BLOCK_SLOPE;
        slopeCells++;
      }
    }
  }
  return slopeCells;
}

/**
 * Whether a point is inside a water table's polygon, in the game's own SWG frame. The lake tables
 * store their points as {x, y} with y the world's z, which is why this reads `a.y` for a z.
 */
export function insidePolygon(x: number, z: number, pts: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** One of the client's water tables as the terrain file holds it (raw frame, points `{x, y}` with y the world's z), and its box. */
export interface RawWaterTable {
  w: { height: number; points: readonly { x: number; y: number }[] };
  mnx: number;
  mxx: number;
  mnz: number;
  mxz: number;
}

/**
 * The water test: every cell whose middle stands under more than `SWIM_DEPTH` of water marked `water`. The surface is the
 * client's (`global`, else -Infinity, raised by any of `tables` covering the middle, in the terrain's own frame `cx - gx`,
 * `cz + gz`) and then, where `ours` is handed (Map-maker II's fifth wave: the water file's lakes, by the very rule the
 * game asks, `ourWater.ts`), the higher of that and ours at the middle in the grid's frame. With no lake of ours and no
 * client water nothing is walked. `cellX`, `cellZ` are a cell's middle; `heightAt` the ground. Answers how many it marked.
 */
export function markWater(nx: number, nz: number, cellX: (i: number) => number, cellZ: (j: number) => number, cx: number, cz: number, global: number, tables: readonly RawWaterTable[], heightAt: (x: number, z: number) => number, flags: Uint8Array, ours: ((gx: number, gz: number) => number) | null = null): number {
  let waterCells = 0;
  if (!(global > -Infinity || tables.length || ours)) return 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gx = cellX(i), gz = cellZ(j);
      const sx = cx - gx, sz = cz + gz;
      let surface = global;
      for (const l of tables) {
        if (l.w.height <= surface || sx < l.mnx || sx > l.mxx || sz < l.mnz || sz > l.mxz) continue;
        if (insidePolygon(sx, sz, l.w.points)) surface = l.w.height;
      }
      if (ours) {
        const o = ours(gx, gz);
        if (o > surface) surface = o;
      }
      if (surface > -Infinity && surface - heightAt(gx, gz) > SWIM_DEPTH) {
        flags[j * nx + i] |= BLOCK_WATER;
        waterCells++;
      }
    }
  }
  return waterCells;
}

/**
 * The clearance plane: one nibble a cell, how far it stands from the nearest cell a body may not
 * walk on, in cells, capped at `clearMax`. An unwalkable cell is 0.
 *
 * It is a two-pass chamfer in **thirds of a cell**, the textbook 3-4 approximation of the Euclidean
 * distance (3 for an orthogonal step, 4 for a diagonal), which is within about 6% of the truth and
 * costs two sweeps of the world rather than a flood per cell. Everything starts at
 * `(clearMax + 1) * 3` and only ever falls, so nothing can overflow the byte it is held in and no
 * value under the cap is ever wrong; everything at or over the cap clamps to `clearMax`, which is
 * exactly the answer the runtime wants there.
 *
 * **Off the edge of the world counts as unwalkable**, so the map's own rim carries a berth like any
 * other edge. It costs one branch a cell and saves the runtime a rule of its own.
 */
export function clearanceNibbles(nx: number, nz: number, walkable: (k: number) => boolean, clearMax = CLEARANCE_MAX): Uint8Array {
  const cap = (clearMax + 1) * 3;
  const n = nx * nz;
  const d = new Uint8Array(n);
  for (let k = 0; k < n; k++) d[k] = walkable(k) ? cap : 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k];
      if (!v) continue;
      const up = j > 0;
      const w = (i > 0 ? d[k - 1] : 0) + 3;
      if (w < v) v = w;
      const nn = (up ? d[k - nx] : 0) + 3;
      if (nn < v) v = nn;
      const nw = (up && i > 0 ? d[k - nx - 1] : 0) + 4;
      if (nw < v) v = nw;
      const ne = (up && i + 1 < nx ? d[k - nx + 1] : 0) + 4;
      if (ne < v) v = ne;
      d[k] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k];
      if (!v) continue;
      const down = j + 1 < nz;
      const e = (i + 1 < nx ? d[k + 1] : 0) + 3;
      if (e < v) v = e;
      const s = (down ? d[k + nx] : 0) + 3;
      if (s < v) v = s;
      const se = (down && i + 1 < nx ? d[k + nx + 1] : 0) + 4;
      if (se < v) v = se;
      const sw = (down && i > 0 ? d[k + nx - 1] : 0) + 4;
      if (sw < v) v = sw;
      d[k] = v;
    }
  }
  const out = new Uint8Array(Math.ceil(n / 2));
  for (let k = 0; k < n; k++) {
    const v = d[k] ? Math.min(clearMax, Math.round(d[k] / 3)) : 0;
    const b = k >> 1;
    if (k & 1) out[b] = (out[b] & 0x0f) | (v << 4);
    else out[b] = (out[b] & 0xf0) | v;
  }
  return out;
}

/**
 * The regions, the nibbles, the coarse plane, its edges and the clearance, from a blocked mask and
 * an indoor mask.
 *
 * It is a function of its own because it is the whole of the grid's arithmetic and none of its
 * reading: a node test draws a world by hand, calls this, and checks the very bytes the converter
 * writes. `solid` is one byte a cell, non-zero for blocked; `flags` carries the indoor mark under
 * `indoorBit`.
 */
export function packGrid(nx: number, nz: number, solid: Uint8Array, flags: Uint8Array, indoorBit: number, coarseStep: number, log: (line: string) => void = () => {}, clearMax = CLEARANCE_MAX): { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array; regions: { seed: number; cells: number }[]; cnx: number; cnz: number } {
  // Two floods rather than one: the first counts the regions and keeps a seed for each, the second
  // writes the ranks. That costs a second pass and saves holding a label for every one of sixty-seven
  // million cells, which is what a single pass would need.
  const walkable = (k: number): boolean => !solid[k] && !(flags[k] & indoorBit);
  const mark = new Uint8Array(nx * nz);
  const stack = new Int32Array(nx * nz);
  const flood = (seed: number, onCell: ((k: number) => void) | null): number => {
    let n = 0;
    let top = 0;
    stack[top++] = seed;
    mark[seed] = 1;
    while (top > 0) {
      const k = stack[--top];
      n++;
      if (onCell) onCell(k);
      const j = (k / nx) | 0;
      const i = k - j * nx;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const jj = j + dj, ii = i + di;
          if (jj < 0 || ii < 0 || jj >= nz || ii >= nx) continue;
          const kk = jj * nx + ii;
          if (mark[kk] || !walkable(kk)) continue;
          // No slipping diagonally between two blocked cells: a body cannot, and a grid that lets a
          // search do it joins two regions that are not joined on the ground.
          if (di && dj && (!walkable(j * nx + ii) || !walkable(jj * nx + i))) continue;
          mark[kk] = 1;
          stack[top++] = kk;
        }
      }
    }
    return n;
  };
  const regions: { seed: number; cells: number }[] = [];
  {
    const t = Date.now();
    for (let k = 0; k < nx * nz; k++) {
      if (mark[k] || !walkable(k)) continue;
      regions.push({ seed: k, cells: flood(k, null) });
    }
    regions.sort((a, b) => b.cells - a.cells);
    log(`${regions.length} walkable regions in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  const nibbles = new Uint8Array(Math.ceil((nx * nz) / 2));
  const put = (k: number, v: number): void => {
    const b = k >> 1;
    if (k & 1) nibbles[b] = (nibbles[b] & 0x0f) | (v << 4);
    else nibbles[b] = (nibbles[b] & 0xf0) | v;
  };
  {
    mark.fill(0);
    const top = Math.min(RANKS, regions.length);
    for (let r = 0; r < top; r++) {
      const rank = r + 1;
      flood(regions[r].seed, (k) => put(k, rank));
    }
    for (let k = 0; k < nx * nz; k++) {
      if (flags[k] & indoorBit) put(k, INDOOR);
      else if (!walkable(k)) put(k, 0);
      else if (!mark[k]) put(k, OTHER_REGION);
    }
  }

  const open = (k: number): boolean => {
    const b = nibbles[k >> 1];
    const v = k & 1 ? b >> 4 : b & 0x0f;
    return v > 0 && v < INDOOR;
  };
  const cnx = Math.ceil(nx / coarseStep);
  const cnz = Math.ceil(nz / coarseStep);
  const coarse = new Uint8Array(cnx * cnz);
  const edges = new Uint8Array(cnx * cnz);
  // Which fine cells are in their own coarse cell's **largest** open piece. A coarse cell's open
  // ground is not always in one piece -- a wall runs through the middle of it -- and a coarse cell
  // taken whole then claims to join its neighbour on one side and its other neighbour on the other
  // when nothing on the ground joins the two. A route through such a cell leaves the body at a wall
  // with the coarse plane insisting there is a way. So the coarse plane offers each cell's largest
  // piece and nothing else: every edge it carries is then a way a body can really walk, and the
  // pieces it leaves out are still there for the fine search inside the corridor to use.
  const mainPiece = new Uint8Array(nx * nz);
  {
    const need = Math.max(1, Math.round(coarseStep * coarseStep * COARSE_SHARE));
    // counts[0..RANKS-1] are the ranked regions; counts[RANKS] is everything smaller.
    const counts = new Int32Array(RANKS + 1);
    const piece = new Int32Array(coarseStep * coarseStep);
    const local = new Int32Array(coarseStep * coarseStep);
    const sizes = new Int32Array(coarseStep * coarseStep);
    for (let cj = 0; cj < cnz; cj++) {
      for (let ci = 0; ci < cnx; ci++) {
        const i0 = ci * coarseStep;
        const j0 = cj * coarseStep;
        const wi = Math.min(coarseStep, nx - i0);
        const wj = Math.min(coarseStep, nz - j0);
        piece.fill(-1);
        sizes.fill(0);
        const openLocal = (li: number, lj: number): boolean => li >= 0 && lj >= 0 && li < wi && lj < wj && open((j0 + lj) * nx + (i0 + li));
        let pieces = 0;
        for (let lj = 0; lj < wj; lj++) {
          for (let li = 0; li < wi; li++) {
            const s = lj * coarseStep + li;
            if (piece[s] >= 0 || !openLocal(li, lj)) continue;
            const id = pieces++;
            let top = 0;
            local[top++] = s;
            piece[s] = id;
            while (top > 0) {
              const q = local[--top];
              sizes[id]++;
              const qj = Math.floor(q / coarseStep);
              const qi = q - qj * coarseStep;
              for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                  if (!di && !dj) continue;
                  const ni = qi + di;
                  const nj = qj + dj;
                  if (!openLocal(ni, nj)) continue;
                  if (di && dj && (!openLocal(ni, qj) || !openLocal(qi, nj))) continue;
                  const nq = nj * coarseStep + ni;
                  if (piece[nq] >= 0) continue;
                  piece[nq] = id;
                  local[top++] = nq;
                }
              }
            }
          }
        }
        if (!pieces) continue;
        let big = 0;
        for (let p = 1; p < pieces; p++) if (sizes[p] > sizes[big]) big = p;
        if (sizes[big] < need) continue;
        counts.fill(0);
        for (let lj = 0; lj < wj; lj++) {
          for (let li = 0; li < wi; li++) {
            if (piece[lj * coarseStep + li] !== big) continue;
            const k = (j0 + lj) * nx + (i0 + li);
            mainPiece[k] = 1;
            const b = nibbles[k >> 1];
            const v = k & 1 ? b >> 4 : b & 0x0f;
            counts[v <= RANKS ? v - 1 : RANKS]++;
          }
        }
        let best = 0;
        for (let r = 1; r <= RANKS; r++) if (counts[r] > counts[best]) best = r;
        coarse[cj * cnx + ci] = best < RANKS ? best + 1 : OTHER_REGION;
      }
    }
  }

  // Which of its eight neighbours each coarse cell really joins. A share test alone is a lie about
  // the ground: two coarse cells can each be a third walkable with not one pair of open fine cells
  // touching across the border between them, and a route planned through such a pair leaves the
  // body at a wall. Measured on four cross-country routes, the first such hop was between the
  // seventh and the thirtieth of the chain on every one of them. So the edge is read off the fine
  // cells of each cell's largest piece: it exists when one of them has an open fine neighbour in
  // the other cell's largest piece, by the same diagonal rule a body walks under.
  for (let j = 0; j < nz; j++) {
    const cj = Math.floor(j / coarseStep);
    for (let i = 0; i < nx; i++) {
      if (!mainPiece[j * nx + i]) continue;
      const ci = Math.floor(i / coarseStep);
      const c = cj * cnx + ci;
      if (!coarse[c]) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const jj = j + dj;
          const ii = i + di;
          if (jj < 0 || ii < 0 || jj >= nz || ii >= nx) continue;
          if (!mainPiece[jj * nx + ii]) continue;
          if (di && dj && (!open(j * nx + ii) || !open(jj * nx + i))) continue;
          const cjj = Math.floor(jj / coarseStep);
          const cii = Math.floor(ii / coarseStep);
          if (cii === ci && cjj === cj) continue;
          if (!coarse[cjj * cnx + cii]) continue;
          const idx = (cjj - cj + 1) * 3 + (cii - ci + 1);
          edges[c] |= 1 << (idx < 4 ? idx : idx - 1);
        }
      }
    }
  }
  // The clearance is measured against the very predicate the search walks under, so a building's
  // own footprint earns a berth exactly as a cliff does: a body walking past a cantina should not
  // scrape its wall either, and `walkable` is the one place that says what may be stood on.
  const clear = clearanceNibbles(nx, nz, walkable, clearMax);
  return { nibbles, coarse, edges, clear, regions, cnx, cnz };
}
