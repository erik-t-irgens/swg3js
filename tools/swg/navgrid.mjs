// The outdoor walkability bake: one grid a world, at the terrain's own two metres, written beside
// the planet's manifest so a body sent across a planet can be handed corners instead of a goal.
//
// It reads nothing from the archives. Everything it needs is already in the converted pack --
// `terrain.trn` and its bitmaps, the building terrain layers `layout.json` names, the placements,
// and the models' own triangles -- which is why this command takes a pack and not a mount, and why
// it can be re-run on a world without re-reading a single `.tre`.
//
// What a cell is, and why it is two metres. `CHUNK_SIZE 64 / CHUNK_RES 32` in `src/world/terrain.ts`
// makes the heightfield a body really walks on a two-metre lattice, which is also the generator's
// own pole step (`TerrainSampler.poleStep`). A finer grid therefore measures nothing new about the
// ground; it only sharpens the edges of buildings, and it costs four times as much.
//
// A cell is blocked when any of three things is true of it, and each is recorded separately so the
// census can say which:
//
//   slope    the ground rises past `SLOPE_CLIMB_DEGREES` over one pole step, which is the real
//            triangle. The number and the whole of the owner's reasoning about it are there.
//   objects  a placed object's own triangles stand between 0.5 m (the autostep) and 1.6 m (the top
//            of the capsule) above the ground there. A building's interior rooms are left out:
//            somebody outside walks into the shell, not into the furniture.
//   water    standing water is deeper than 1.2 m, which is where the game calls it swimming.
//
// Then the blocked set is grown by one four-neighbour step, which is the body's own 0.35 m
// half-width rounded up to the cell: the slope's and the water's cells on every side, and an
// object's only across the sides its geometry comes within that half-width of (`growMargin`), so a
// four-metre lane between two walls is still a lane. It still over-blocks, a little, and in the safe
// direction: a route round a gap the body could have squeezed through still arrives, and a route
// through a gap it could not would not.
//
// **A building's floor is not walkable ground.** The rasteriser deliberately skips interior cells,
// so a building's inside would otherwise be as free as the open desert and a string-pull would walk
// a body straight through a cantina. Every portal building's interior footprint is therefore marked
// `indoor` rather than blocked, which is the better of the two answers: the outdoor search refuses
// to cross it and stops at the door, and the indoor pathing that pass 6 built -- which has the
// client's own authored floor for that very room -- takes the body from there. A footprint is where
// the building's rooms come near the ground **and** the building rises out of it (`INDOOR_RISE`),
// so a courtyard over a cellar is ground and not a floor.
//
// What comes out is one nibble a cell: 0 blocked, 1..13 the rank of the walkable region the cell is
// in (1 the largest on the world), 14 some other, smaller region, 15 indoor. The ranks are the one
// thing only a bake can carry: a world has a hundred thousand separate walkable regions and 97% of
// the ground is one of them, so with the ranks a body can be told a place cannot be walked to, and
// without them it walks at a wall all evening.
//
// Beside the nibbles goes a coarse plane, one byte per `COARSE` fine cells, carrying the same rank
// where enough of the fine cells under it are walkable. It exists so the runtime's search has a
// cheap first pass: a whole world is a million coarse cells, which a search can cross in a few
// milliseconds, where the fine grid is sixty-seven million and could not be.
//
// And beside both goes a second nibble a cell, the **clearance**: how far that cell stands from the
// nearest thing a body cannot walk on, in cells, capped at `CLEARANCE_MAX`. It is what lets the
// runtime's search buy a wider berth round a mountain or a wall -- a cell near something costs more
// to walk than one in the open -- and it is baked rather than worked out at search time for a
// measured reason: a field that is one value over nearly all of a world deflates to almost nothing
// (the numbers are in `tools/swg/README.md`), while deriving it would mean reading a square of the
// bitmap round every cell the search ever opens, tens of millions of reads inside a frame's budget.
// A cap of `CLEARANCE_MAX` cells is what makes it compress: past that the whole open desert is one
// number, and the runtime never needs to tell twenty metres of room from thirty.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

/**
 * The shape of the files this writes; a pack that says anything else is passed over by the game.
 *
 * 2 added the clearance plane. A version 1 grid is simply not read: it has no clearance in it, and
 * the game would have to carry a second search that knew nothing of berths to use one. Re-baking a
 * world is one command that opens no archive, so the cheap answer is to re-bake.
 */
export const NAV_GRID_VERSION = 2;

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
 * How far round a named town's own centre counts as that town's ground, metres, and how far out
 * the check then looks for the world's largest walkable region.
 *
 * Both invented. The ring has to be wide enough that the answer is the town's streets and not
 * whichever cell the POI's own point happens to land in -- a town centre lands in a walled yard
 * often enough that one snapped point is no measurement at all, which is exactly how a bake that
 * cut two towns off a world was first reported as cutting none.
 */
export const TOWN_RING = 120;
export const TOWN_LOOK = 400;

/**
 * `OUTDOOR_TUNE.goalSnap` in `src/world/nav/outdoorGrid.ts`, repeated here because the converter
 * does not import the runtime. It is the distance that decides whether a town standing off the
 * main region still matters: a goal within it is pulled onto the body's own ground and a real
 * route is planned to the town's edge, and a goal past it is answered 'unreachable' and the body
 * steers the whole way, which is the game with no grid at all. A node test fails if the two
 * numbers ever disagree.
 */
export const GOAL_SNAP = 40;

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
export function isFootprint(near, highestOver) {
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
export function isBuildingDef(def) {
  return Array.isArray(def?.cells) && def.cells.length > 0;
}

/**
 * Whether a room triangle at height `y`, over ground at `ground`, counts as its building's
 * footprint. A dungeon room two hundred metres under the desert must not wall off the desert over
 * it, and an upper storey is not a footprint either -- the ground floor covers the same ground.
 */
export function indoorFootprint(y, ground) {
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
export function edgesNear(u, v, reach) {
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
export function growMargin(nx, nz, flags, edgeNear, grow, byEdge = true) {
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
export function bakeRules(opts = {}) {
  const byEdge = opts.margin !== 'cell';
  const byBand = opts.footprint === 'band';
  return { byEdge, byBand, stamp: byEdge && !byBand ? NAV_BAKE_RULES : 1 };
}

/**
 * Where one placed object stands in the grid's frame: its place (`gx`, `y`, `gz`) and the rotation of
 * the runtime's own placed quaternion, (q[1], -q[2], -q[3], q[0]), which is the X mirror, as nine
 * numbers. `cx`, `cz` are the pack's centre.
 */
export function placementFrame(o, cx, cz) {
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

/** A placement standing at the grid's origin unturned: what a node test draws a model in. */
export const IDENTITY_FRAME = Object.freeze({ gx: 0, y: 0, gz: 0, r00: 1, r01: 0, r02: 0, r10: 0, r11: 1, r12: 0, r20: 0, r21: 0, r22: 1 });

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
export function rasterPlacement(bake, positions, cells, isBuilding, frame) {
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
    const p = [];
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

/** Yaw (rotation about Y) of a w,x,y,z quaternion, as the rest of the converter reads one. */
function yawOf(q) {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

// ---- a very small GLB reader ------------------------------------------------------------------
// Only what a footprint needs: every triangle's three corners in model space, and the portal cell
// its node names, so the shell and the rooms can be told apart. The converter's own `glb.mjs`
// writes these files and does not read them.

function accessorOf(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const size = sizes[a.componentType];
  const elem = size * comps;
  const stride = bv.byteStride ?? elem;
  const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); break;
        case 5121: v = dv.getUint8(o); break;
        case 5122: v = dv.getInt16(o, true); break;
        default: v = dv.getInt8(o);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mulMatrix(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/**
 * One GLB's triangles in model space: `positions` nine floats a triangle, `cells` the portal cell
 * index each stands in (0 the exterior shell, -1 a plain model with no cells at all).
 */
export function readGlbTriangles(file) {
  const buf = readFileSync(file);
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a glb: ${file}`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error(`no json chunk: ${file}`);
  const tris = [];
  const cells = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  // GLTFLoader strips the colon from a node's name, so the converter's own `cell:<n>:<name>` may
  // arrive either way round; both spellings are read, as the runtime's `cellIndexOf` does.
  const cellOf = (name) => {
    const m = /^cell[:_]?(\d+)/.exec(name ?? '');
    return m ? Number(m[1]) : -1;
  };
  const walk = (idx, parent, cell) => {
    const node = json.nodes[idx];
    if (!node) return;
    const m = mulMatrix(parent, nodeMatrix(node));
    const own = cellOf(node.name);
    const c = own >= 0 ? own : cell;
    if (node.mesh !== undefined && bin) {
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) continue;
        const pos = accessorOf(json, bin, posIdx);
        const idxs = prim.indices !== undefined ? accessorOf(json, bin, prim.indices) : null;
        const count = idxs ? idxs.length : pos.length / 3;
        for (let t = 0; t + 2 < count; t += 3) {
          for (let k = 0; k < 3; k++) {
            const v = idxs ? idxs[t + k] : t + k;
            const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
            tris.push(m[0] * x + m[4] * y + m[8] * z + m[12]);
            tris.push(m[1] * x + m[5] * y + m[9] * z + m[13]);
            tris.push(m[2] * x + m[6] * y + m[10] * z + m[14]);
          }
          cells.push(c);
        }
      }
    }
    for (const kid of node.children ?? []) walk(kid, m, c);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) walk(r, I, -1);
  return { positions: Float32Array.from(tris), cells: Int32Array.from(cells) };
}

// ---- the bake ---------------------------------------------------------------------------------

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
export function clearanceNibbles(nx, nz, walkable, clearMax = CLEARANCE_MAX) {
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
export function packGrid(nx, nz, solid, flags, indoorBit, coarseStep, log = () => {}, clearMax = CLEARANCE_MAX) {
  // Two floods rather than one: the first counts the regions and keeps a seed for each, the second
  // writes the ranks. That costs a second pass and saves holding a label for every one of sixty-seven
  // million cells, which is what a single pass would need.
  const walkable = (k) => !solid[k] && !(flags[k] & indoorBit);
  const mark = new Uint8Array(nx * nz);
  const stack = new Int32Array(nx * nz);
  const flood = (seed, onCell) => {
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
  const regions = [];
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
  const put = (k, v) => {
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

  const open = (k) => {
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
        const openLocal = (li, lj) => li >= 0 && lj >= 0 && li < wi && lj < wj && open((j0 + lj) * nx + (i0 + li));
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

/**
 * Where one named town stands on a finished grid: the region most of the open ground within
 * `TOWN_RING` of its centre belongs to, and how far the world's largest walkable region (rank 1)
 * reaches toward it, in metres.
 *
 * It exists because a slope angle can take a town off the main region and **nothing else in the
 * pipeline would say so**. The check that was tried first took one point per town -- the nearest
 * open cell to the POI's own centre -- and compared region ids; on the two Corellian towns a
 * rebake really did cut off, that point landed in a walled yard at every angle, so both read
 * "already apart" and the severance was invisible. One snapped point is not a measurement of a
 * town: the ground round it is.
 *
 * `nibble(k)` reads the finished region plane, which is why this takes an accessor rather than the
 * packed bytes -- a node test hands it a world drawn by hand.
 */
export function townStanding(nibble, nx, nz, i0, j0, ringCells, lookCells) {
  const tally = new Map();
  let open = 0;
  for (let dj = -ringCells; dj <= ringCells; dj++) {
    for (let di = -ringCells; di <= ringCells; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const v = nibble(j * nx + i);
      if (!(v > 0 && v < INDOOR)) continue;
      open++;
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }
  }
  let region = -1;
  let best = 0;
  for (const [v, n] of tally) if (n > best) { best = n; region = v; }
  // Ring by ring outward. The rings are square and the answer is a **distance**, so stopping at the
  // first ring that holds a rank-1 cell is not enough: that cell may be in the ring's corner, at
  // `r * sqrt(2)`, while a nearer one sits in the middle of an edge two rings further out. Every
  // cell of ring r is at least r away, so the search may stop once r passes the best distance
  // found, and no sooner -- which costs about four tenths more rings and makes the number exact
  // rather than up to 41% over.
  let rank1 = Infinity;
  if (i0 >= 0 && j0 >= 0 && i0 < nx && j0 < nz && nibble(j0 * nx + i0) === 1) rank1 = 0;
  for (let r = 1; r <= lookCells && r <= rank1; r++) {
    for (let d = -r; d <= r; d++) {
      for (const [i, j] of [[i0 + d, j0 - r], [i0 + d, j0 + r], [i0 - r, j0 + d], [i0 + r, j0 + d]]) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (nibble(j * nx + i) !== 1) continue;
        const dd = Math.hypot(i - i0, j - j0);
        if (dd < rank1) rank1 = dd;
      }
    }
  }
  return { region, share: open ? best / open : 0, open, rank1Cells: rank1 };
}

/**
 * Whether a point is inside a water table's polygon, in the game's own SWG frame. The lake tables
 * store their points as {x, y} with y the world's z, which is why this reads `a.y` for a z.
 */
function insidePolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Build one world's grid. `dir` is a converted planet pack. Returns the header, the packed nibbles
 * and the coarse plane; nothing is written here, so a test can build a small world and read it.
 *
 * `log` is called with one line at a time, so the command prints its working and a test does not.
 */
export async function buildNavGrid(dir, opts = {}) {
  const log = opts.log ?? (() => {});
  const trn = await import('../../src/swg/terrain/trn.ts');
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const trnPath = join(dir, layout.terrain ?? 'terrain.trn');
  if (!existsSync(trnPath)) throw new Error(`${trnPath} missing; run the snapshot (or terrain) command for this world first`);
  const template = trn.parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
  for (const b of trn.bitmapFiles(template)) {
    const f = join(dir, b.file);
    if (existsSync(f)) trn.attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
  }
  const sampler = new trn.TerrainSampler(template);
  // The buildings' own terrain layers flatten the ground under them; without these a town stands on
  // whatever the fractals made and every doorstep is a cliff.
  let layerCount = 0;
  for (const o of layout.objects) {
    if (!o.layer) continue;
    const f = join(dir, o.layer);
    if (!existsSync(f)) continue;
    const L = trn.parseLayerFile(new Uint8Array(readFileSync(f)), template.generator);
    if (!L) continue;
    sampler.addBuildingLayer(L, o.x, o.z, yawOf(o.q));
    layerCount++;
  }

  const width = template.mapWidthInMeters;
  const pole = sampler.poleStep;
  const cell = Number(opts.cell ?? pole);
  if (!(cell > 0) || Math.abs(cell / pole - Math.round(cell / pole)) > 1e-9) {
    throw new Error(`cell ${cell} is not a whole number of ${pole} m pole steps`);
  }
  const cx = layout.center.x;
  const cz = layout.center.z;
  // Game coordinates: gx = centerX - swgX, gz = swgZ - centerZ (src/world/swgTerrain.ts). The map
  // runs over [-width/2, width/2] in the game's own SWG frame, so in the game's frame it runs from
  // these two corners -- which is not centred on the origin, because the pack's centre is not the
  // map's.
  const x0 = cx - width / 2;
  const z0 = -width / 2 - cz;
  const nx = Math.round(width / cell);
  const nz = Math.round(width / cell);
  log(`${layout.planet}: ${width} m across at ${cell} m cells -> ${nx} x ${nz} (${((nx * nz) / 1e6).toFixed(1)} M cells), ${layerCount} building terrain layers`);

  // ---- the heights, on the generator's own pole lattice ---------------------------------------
  const started = Date.now();
  const pnx = nx * (cell / pole) + 2;
  const pnz = nz * (cell / pole) + 2;
  const heights = new Float32Array(pnx * pnz);
  {
    const t = Date.now();
    const STRIP = 256;
    for (let j0 = 0; j0 < pnz; j0 += STRIP) {
      const jn = Math.min(STRIP, pnz - j0);
      for (let i0 = 0; i0 < pnx; i0 += STRIP) {
        const iN = Math.min(STRIP, pnx - i0);
        const n = Math.max(iN, jn);
        // SWG x runs opposite to the game's, so the strip is generated from its far column back.
        const g = sampler.generate(cx - (x0 + (i0 + iN - 1) * pole), cz + (z0 + j0 * pole), n, pole);
        for (let j = 0; j < jn; j++) {
          for (let i = 0; i < iN; i++) heights[(j0 + j) * pnx + (i0 + i)] = g.heights[j * n + (iN - 1 - i)];
        }
      }
    }
    log(`  heights: ${pnx} x ${pnz} poles at ${pole} m in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
  /** The ground at a game-frame point, bilinear between the four poles round it. */
  const heightAt = (gx, gz) => {
    const fx = (gx - x0) / pole, fz = (gz - z0) / pole;
    const i = Math.max(0, Math.min(pnx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(pnz - 2, Math.floor(fz)));
    const u = fx - i, v = fz - j;
    const a = heights[j * pnx + i], b = heights[j * pnx + i + 1];
    const c = heights[(j + 1) * pnx + i], d = heights[(j + 1) * pnx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // One check that the lattice really is the generator's, kept on every run rather than done once
  // by hand: the same twenty poles asked of the sampler itself.
  let worstHeight = 0;
  for (let k = 0; k < 20; k++) {
    const i = 1 + ((k * 3557) % (pnx - 2));
    const j = 1 + ((k * 7919) % (pnz - 2));
    const gx = x0 + i * pole, gz = z0 + j * pole;
    worstHeight = Math.max(worstHeight, Math.abs(sampler.heightAt(cx - gx, cz + gz) - heights[j * pnx + i]));
  }

  const flags = new Uint8Array(nx * nz);
  // Which sides of an object-blocked cell its geometry hugs (`EDGE`), for the margin.
  const edgeNear = new Uint8Array(nx * nz);
  const cellCenterX = (i) => x0 + (i + 0.5) * cell;
  const cellCenterZ = (j) => z0 + (j + 0.5) * cell;

  // ---- slope ----------------------------------------------------------------------------------
  let slopeCells = 0;
  {
    const limit = Math.tan((Number(opts.slope ?? SLOPE_CLIMB_DEGREES) * Math.PI) / 180);
    const per = cell / pole;
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
  }

  // ---- water ----------------------------------------------------------------------------------
  let waterCells = 0;
  {
    const tables = trn.waterTables(template.generator).map((w) => {
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const p of w.points) {
        mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
        mnz = Math.min(mnz, p.y); mxz = Math.max(mxz, p.y);
      }
      return { w, mnx, mxx, mnz, mxz };
    });
    const global = template.useGlobalWaterTable ? template.globalWaterTableHeight : -Infinity;
    if (global > -Infinity || tables.length) {
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const gx = cellCenterX(i), gz = cellCenterZ(j);
          const sx = cx - gx, sz = cz + gz;
          let surface = global;
          for (const l of tables) {
            if (l.w.height <= surface || sx < l.mnx || sx > l.mxx || sz < l.mnz || sz > l.mxz) continue;
            if (insidePolygon(sx, sz, l.w.points)) surface = l.w.height;
          }
          if (surface > -Infinity && surface - heightAt(gx, gz) > SWIM_DEPTH) {
            flags[j * nx + i] |= BLOCK_WATER;
            waterCells++;
          }
        }
      }
    }
  }

  // ---- the placed objects ----------------------------------------------------------------------
  // Grouped by model, so each GLB is read once, rasterised into every one of its placements, and
  // dropped again: a world's models together are more triangles than a bake wants to hold at once.
  const defs = new Map();
  for (const list of Object.values(manifest.categories ?? {})) for (const e of list) defs.set(e.id, e);
  const byModel = new Map();
  for (const o of layout.objects) {
    if (o.contained) continue;
    const list = byModel.get(o.model);
    if (list) list.push(o);
    else byModel.set(o.model, [o]);
  }
  let objectCells = 0;
  let indoorCells = 0;
  // Cells a building's rooms came near the ground at without the building rising over them, by the
  // model that did it, for the log: the census of what the rise opened, so a bake says which buildings
  // it read as standing over their rooms rather than leaving that to be found in play. A cell another
  // building covers is still counted against this one, so the sum can pass the world's `opened`.
  const openedBy = new Map();
  // The bake before `rules: 2`, for a comparison run and nothing else: `margin: 'cell'` grows every
  // blocked cell a whole cell, and `footprint: 'band'` calls every cell a room comes near the ground
  // at a footprint, as it did. Both together write the grid the older rules wrote, byte for byte.
  const rules = bakeRules(opts);
  // The world's cells and the arithmetic over them, as `rasterPlacement` reads them; its scratch -- a
  // building's rooms at the cells one placement of it touches, which come near the ground and how
  // high the highest stands over it -- is made once and emptied per placement.
  const bake = { nx, nz, x0, z0, cell, flags, edgeNear, heightAt, byBand: rules.byBand, nearGround: new Set(), highest: new Map() };
  let placed = 0;
  let missing = 0;
  let triangles = 0;
  let buildings = 0;
  {
    const t = Date.now();
    for (const [model, list] of byModel) {
      const def = defs.get(model);
      if (!def || !def.file || !def.file.endsWith('.glb')) {
        missing += list.length;
        continue;
      }
      const file = join(dir, def.file);
      if (!existsSync(file)) {
        missing += list.length;
        continue;
      }
      let tri;
      try {
        tri = readGlbTriangles(file);
      } catch {
        missing += list.length;
        continue;
      }
      const isBuilding = isBuildingDef(def);
      const positions = tri.positions;
      const cells = tri.cells;
      for (const o of list) {
        placed++;
        if (isBuilding) buildings++;
        const r = rasterPlacement(bake, positions, cells, isBuilding, placementFrame(o, cx, cz));
        triangles += r.triangles;
        objectCells += r.objectCells;
        indoorCells += r.indoorCells;
        if (r.opened) openedBy.set(model, (openedBy.get(model) ?? 0) + r.opened);
      }
    }
    log(`  ${placed} placed objects (${buildings} of them portal buildings, ${missing} without a model), ${triangles} triangles, in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (openedBy.size) {
      const top = [...openedBy].sort((a, b) => b[1] - a[1]);
      const cells = top.reduce((n, [, c]) => n + c, 0);
      log(`  ${cells} cells near a building's rooms left open, since nothing of the building rises over the ground there, in ${top.length} models: ${top.slice(0, 8).map(([m, c]) => `${m} ${c}`).join(', ')}${top.length > 8 ? ', ...' : ''}`);
    }
    // A world with buildings and not one indoor cell is the silent failure this bake can have: the
    // manifest entries carried no `cells`, every building inside is open ground, and a string-pull
    // would walk a body through a cantina with nothing anywhere saying so. Say it here, and again
    // in `status`, which reads the same two numbers back out of nav.json.
    if (buildings > 0 && indoorCells === 0) {
      log(`  WARNING: ${buildings} portal buildings and not one indoor cell -- their manifest entries carry no cells, so their insides are baked as open ground and a route may cut straight through one`);
    }
  }

  // ---- the body's own margin --------------------------------------------------------------------
  const grow = Math.max(0, Math.ceil(AGENT_RADIUS / cell));
  const solid = growMargin(nx, nz, flags, edgeNear, grow, rules.byEdge);
  let blockedCells = 0;
  for (let k = 0; k < solid.length; k++) if (solid[k]) blockedCells++;
  // What the rise opened on this world: cells the band alone would have called a footprint and no
  // building rises over. The census the rule is judged by, kept in the header beside `indoor`.
  let openedCells = 0;
  for (let k = 0; k < flags.length; k++) if ((flags[k] & MARK_NEAR) && !(flags[k] & MARK_INDOOR)) openedCells++;


  // The regions, the nibbles, the coarse plane and its edges. It is one call because a node test
  // drives the very same code over a world drawn by hand: everything below this line is arithmetic
  // over the blocked and indoor masks, and nothing in it has ever seen an archive.
  const clearMax = Math.max(1, Math.min(15, Math.round(Number(opts.clearMax ?? CLEARANCE_MAX))));
  const packed = packGrid(nx, nz, solid, flags, MARK_INDOOR, COARSE, (line) => log(`  ${line}`), clearMax);
  const { nibbles, coarse, edges, clear, regions } = packed;
  const cnx = packed.cnx;
  const cnz = packed.cnz;
  // What the clearance plane came to, which is the one number that says whether a berth can be
  // bought on this world at all: a world whose open ground is all at 1 or 2 has no room to stand
  // off anything, and the runtime's cost curve would then only ever be a surcharge.
  const clearHistogram = new Array(clearMax + 1).fill(0);
  for (let k = 0; k < nx * nz; k++) {
    const b = clear[k >> 1];
    clearHistogram[k & 1 ? b >> 4 : b & 0x0f]++;
  }

  // ---- where the named towns ended up ----------------------------------------------------------
  // The one thing a change to `SLOPE_CLIMB_DEGREES` can do that nothing else in the pipeline would
  // notice: take a town off the world's main walkable region, so every body in it is on an island
  // and every errand to it is answered 'unreachable'. It costs one pass over a few hundred-metre
  // squares and it is the difference between that shipping and that being read off the bake's own
  // output. A pack with no `pois.json` is simply not checked, as one with no floors is not.
  const towns = [];
  {
    const poiFile = join(dir, 'pois.json');
    let list = [];
    if (existsSync(poiFile)) {
      try {
        list = (JSON.parse(readFileSync(poiFile, 'utf8')).pois ?? []).filter((p) => p.kind === 'city' && Number.isFinite(p.x) && Number.isFinite(p.z));
      } catch { list = []; }
    }
    const nibble = (k) => {
      const b = nibbles[k >> 1];
      return k & 1 ? b >> 4 : b & 0x0f;
    };
    const ringCells = Math.max(1, Math.round(TOWN_RING / cell));
    const lookCells = Math.max(1, Math.round(TOWN_LOOK / cell));
    for (const p of list) {
      // The same frame conversion the placements take: gx = centerX - swgX, gz = swgZ - centerZ.
      const gx = cx - p.x;
      const gz = p.z - cz;
      const i0 = Math.floor((gx - x0) / cell);
      const j0 = Math.floor((gz - z0) / cell);
      const s = townStanding(nibble, nx, nz, i0, j0, ringCells, lookCells);
      towns.push({
        name: p.name,
        region: s.region,
        share: Number(s.share.toFixed(3)),
        open: s.open,
        rank1: Number.isFinite(s.rank1Cells) ? Number((s.rank1Cells * cell).toFixed(1)) : null,
      });
    }
    // A town is cut off when its own ground is not the main region **and** the main region does not
    // reach within the distance a goal is pulled over. Inside that distance the game still plans a
    // real route to the town's edge and the body steers the last few metres, which is what several
    // coastal towns have always done; past it there are no corners at all.
    const cut = towns.filter((t) => t.region !== 1 && (t.rank1 === null || t.rank1 > GOAL_SNAP));
    if (cut.length) {
      log(`  WARNING: ${cut.length} of ${towns.length} named town${cut.length === 1 ? ' stands' : 's stand'} on ground the largest walkable region does not reach within ${GOAL_SNAP} m, so a body sent to one is answered 'unreachable' and steers the whole way: ${cut.map((t) => `${t.name} (region ${t.region}, rank 1 ${t.rank1 === null ? `over ${TOWN_LOOK}` : t.rank1} m off)`).join(', ')}`);
      log(`  if that is new, it is the slope: re-bake this world with --slope=<higher> and compare, since the angle is the only thing that moves it`);
    } else if (towns.length) {
      log(`  all ${towns.length} named towns stand on or within ${GOAL_SNAP} m of the largest walkable region`);
    }
  }

  const seconds = (Date.now() - started) / 1000;
  const header = {
    version: NAV_GRID_VERSION,
    planet: layout.planet,
    cell,
    coarse: COARSE,
    nx,
    nz,
    cnx,
    cnz,
    x0,
    z0,
    // The pack's own centre, which `x0` and `z0` are derived from. It is written down so that a
    // world re-snapshotted around a different centre can be caught: the grid would still load, its
    // cells would still be the right size, and every one of them would stand the difference away
    // from the ground it was baked for, with `status` cheerfully reporting a nav grid. Two numbers
    // beside the two they made is the whole of the check.
    center: { x: cx, z: cz },
    ranks: RANKS,
    clearMax,
    regions: regions.slice(0, RANKS).map((r, i) => ({ rank: i + 1, cells: r.cells, km2: Number(((r.cells * cell * cell) / 1e6).toFixed(3)) })),
    otherRegions: Math.max(0, regions.length - RANKS),
    slopeDegrees: Number(opts.slope ?? SLOPE_CLIMB_DEGREES),
    // The rules it was baked by (`NAV_BAKE_RULES`), which nothing in the grid itself would otherwise
    // show: a grid baked by the older ones loads and routes exactly as a new one does, and only walks
    // at the wall of a courtyard. A comparison bake by the older rules says so.
    rules: rules.stamp,
    // Where each named town ended up, so `status` can say it tomorrow and two bakes at two angles
    // can be held against each other without re-measuring either. `rank1` is metres to the nearest
    // cell of the largest walkable region, or null when it is further off than `TOWN_LOOK`.
    towns,
    stats: {
      // Cells at each clearance, 0 (unwalkable) first: how much room this world really has to
      // stand off anything. It is written down because the runtime's berth is only worth its
      // arithmetic where there are cells to buy it with.
      clearance: clearHistogram,
      slope: slopeCells,
      objects: objectCells,
      water: waterCells,
      indoor: indoorCells,
      // Cells a building's rooms come near the ground at and the building nowhere rises over, which the
      // band alone would have called its footprint: courtyards and yards over cellars (`INDOOR_RISE`).
      opened: openedCells,
      blocked: blockedCells,
      margin: grow * cell,
      placed,
      buildings,
      missing,
      triangles,
      layers: layerCount,
      heightCheck: Number(worstHeight.toFixed(4)),
      seconds: Number(seconds.toFixed(1)),
    },
  };
  // `flags` is every cell's reasons before the margin and the regions -- blocked by slope (1), by an
  // object (2), by water (4), a footprint (8), a room near the ground (16) -- which nothing writes,
  // for a census that wants to know why a cell came out as it did rather than only what.
  return { header, nibbles, coarse, edges, clear, regions, flags };
}

/**
 * Write one world's grid into its pack: `nav.json` beside the manifest and `nav.bin` beside it, the
 * region nibbles, the coarse plane, its edges and the clearance nibbles in one raw-deflate stream
 * so the browser can inflate them in one go.
 *
 * The planes go in that order and the header says how long each is, so a reader takes four
 * subarrays of one buffer and copies nothing.
 */
export function writeNavGrid(dir, built) {
  const { header, nibbles, coarse, edges, clear } = built;
  const joined = new Uint8Array(nibbles.length + coarse.length + edges.length + clear.length);
  joined.set(nibbles, 0);
  joined.set(coarse, nibbles.length);
  joined.set(edges, nibbles.length + coarse.length);
  joined.set(clear, nibbles.length + coarse.length + edges.length);
  const packed = deflateRawSync(joined, { level: 9 });
  const out = { ...header, file: 'nav.bin', fineBytes: nibbles.length, coarseBytes: coarse.length, edgeBytes: edges.length, clearBytes: clear.length, packedBytes: packed.length };
  mkdirSync(dirname(join(dir, 'nav.json')), { recursive: true });
  writeFileSync(join(dir, 'nav.json'), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(join(dir, 'nav.bin'), packed);
  return out;
}
