// The room pool's lights, worked out apart from the pool (`World.updateInteriorLights` hands them out), so a node test runs the
// very rule a room is lit by (Map-maker II's eleventh wave, whose imported houses are lit by it): which cells' lights light
// the room someone stands in and in what order (the room's own first, then each room its doorways open on, in its doorways'
// order, a room two doorways open on twice), the ambient (a floor of the world's, and every room's own fill added to it in
// that order), the first parallel light, and each point light's brightness at 3 m and its range by the game's own rule.
//
// The rule is the game's, read off the client's lights' Direct3D constants (`1 / (c + l d + q d^2)`): a light's value at 3 m,
// and its range, the first whole metre past which it falls under a twentieth of that, held to 40. Nothing here is ours but
// the cap (`INTERIOR_LIGHT_CAP`, the pool's size) and the floor the caller hands in.
//
// **The owner's edits** (Map-maker II's wave of the rooms' lights): `planRoomLights` is the same rule with the lights files'
// edits laid on it (`roomLightEdits.ts` answers what a cell's are) and the pool's whole shape cut by type -- the plain point
// slots, the point slots that cast, the spot slots and those that cast, and the one parallel light (which never casts) -- the
// game's lights as edited and the lights added, in the same order of preference. With no edits and the default shape (no
// spot and no shadow slot) it answers what `roomLightPlan` answers to the bit, which a node test holds over every converted
// building's rooms; the global dials that light a plan (`ROOM_LIGHT_TUNE`) start at the numbers the world held fixed.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no
// constructor parameter properties, nothing that touches the page at load.
import type { CellLight } from './assetPack.ts';
import { DEFAULT_REACH, coneOf, type LightSpec } from '../story/lightSpec.ts';
import { FLICKER_CODE, flickerSeed } from './lightFlicker.ts';

/** How many point lights the room pool lights at once: the pool's own lights, made once and never added to. */
export const INTERIOR_LIGHT_CAP = 8;

/**
 * How a room is lit, the world's numbers made live dials (Map-maker II's wave of the rooms' lights): what were the fixed
 * `INTERIOR_LIGHT_SCALE`, `INTERIOR_AMBIENT_SCALE` and `INTERIOR_AMBIENT_FLOOR` in `world.ts`, the parallel light's fixed 1.2
 * and how far back along its way it was hung, each at the number it always held. Feel, the owner's: moved through
 * `__debug.roomLights({ tune })` and the debug menu's sliders, every move planning the lit room again (uniforms only).
 */
export const ROOM_LIGHT_TUNE = {
  /** A lamp's intensity is nine times its value at 3 m times this: three's inverse square against the game's falloff, brightened (the world's 3). */
  lightScale: 3,
  /** The ambient's intensity over its summed colour (the world's 1.2). */
  ambientScale: 1.2,
  /** Where the ambient starts, under every room's own fill: rooms are never pitch black (the world's 0.18). */
  ambientFloor: 0.18,
  /** The room's parallel light's intensity (the world's 1.2). */
  parallel: 1.2,
  /** Metres back along its way the parallel light is hung from its own place (the world's 20). */
  parallelBack: 20,
  /** Bumped by every move of the tune, so the world plans the lit room again. */
  version: 0,
};

/** The pool's shape: how many of each slot the session built (the Graphics page's settings, `World.setRoomLightPool`). */
export interface PoolShape {
  /** Plain point slots: always the pool's eight. */
  points: number;
  /** Point slots that cast, and spot slots plain and casting. The room's parallel light never casts (`roomLightPool.ts` says why). */
  pointShadows: number;
  spots: number;
  spotShadows: number;
}

/** Today's shape: eight plain points and nothing else, every program the base commit's. */
export const DEFAULT_POOL: Readonly<PoolShape> = { points: INTERIOR_LIGHT_CAP, pointShadows: 0, spots: 0, spotShadows: 0 };

/** What an edit row does to one light (`lightsFile.ts`'s `edit`): switched off, its brightness scaled, its colour or reach put in place, a shadow asked for. */
export interface LightEditLike {
  off?: true;
  scale?: number;
  color?: readonly [number, number, number];
  reach?: number;
  shadow?: boolean;
}

/** What a fill row does to a room's own fill: its colour put in place of the cell's, then scaled. */
export interface FillEditLike {
  scale?: number;
  color?: readonly [number, number, number];
}

/** A light added to a room: its key (its row's id, or its attachment's), its light, its place and turn in the building's frame. */
export interface AddedLightLike {
  key: string;
  spec: LightSpec;
  pos: readonly [number, number, number];
  /** `[w, x, y, z]`; absent shines straight down. */
  q?: readonly [number, number, number, number];
  /** The copy it lights in (its flicker's seed takes it, so two copies of a template flicker apart). */
  where: string;
}

/** What the plan asks of a room's edits, cell by cell (`RoomLightEdits.forRoom` answers it). */
export interface RoomEditsFor {
  edit(cell: number, of: number | string): LightEditLike | null;
  fill(cell: number): FillEditLike | null;
  /** The lights added to a cell, narrowest scope first, each in its file's order. */
  added(cell: number): readonly AddedLightLike[];
}

/** One lamp the pool lights: what it is, where, how bright, how it shines and flickers, all in the building's own frame. */
export interface PlannedLamp {
  cell: number;
  /** `g:<cell>:<index>` for one of the game's own, else the added light's key. */
  key: string;
  /** Its index in its cell's own list, or -1 for a light added. */
  game: number;
  color: [number, number, number];
  /** Its value at 3 m (the pool lights it at nine times this times the rooms' scale). */
  at3: number;
  range: number;
  decay: number;
  pos: [number, number, number];
  /** The way it shines (a spot), unit. */
  dir: [number, number, number];
  /** A spot's outer half-angle (radians, three's `angle`) and its penumbra (three's share). */
  angle: number;
  penumbra: number;
  /** Whether it took a casting slot, and whether it asked for one. */
  shadow: boolean;
  asked: boolean;
  /** Its flicker (`FLICKER_CODE`), rate, depth and seed. */
  flicker: number;
  rate: number;
  depth: number;
  seed: number;
}

/** The room's one parallel light: one of the game's (its index) or a directional added, its colour, its share of the rooms' parallel, its place and way. */
export interface PlannedParallel {
  cell: number;
  key: string;
  game: number;
  color: [number, number, number];
  scale: number;
  pos: [number, number, number];
  /** The way its light travels, unit (the game's own `direction`). */
  dir: [number, number, number];
  shadow: boolean;
  asked: boolean;
  flicker: number;
  rate: number;
  depth: number;
  seed: number;
}

/** What lights a room under the owner's edits, slot by slot, and what was left out and why. */
export interface RoomLightsPlanned {
  ambient: [number, number, number];
  parallel: PlannedParallel | null;
  points: PlannedLamp[];
  pointShadows: PlannedLamp[];
  spots: PlannedLamp[];
  spotShadows: PlannedLamp[];
  /** Points past every slot; spots with no spot slot built or past them; shadows asked for and lit without one. */
  left: { points: number; spots: number; shadowsRefused: number };
}

/** A turn (`[w, x, y, z]`, absent none) of straight down: the way a spot or a directional of ours shines. */
export function shineOf(q: readonly [number, number, number, number] | undefined, out: [number, number, number]): [number, number, number] {
  if (!q) {
    out[0] = 0;
    out[1] = -1;
    out[2] = 0;
    return out;
  }
  // The quaternion's third column, negated: q * (0, -1, 0).
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  out[0] = -2 * (x * y - w * z);
  out[1] = -(1 - 2 * (x * x + z * z));
  out[2] = -2 * (y * z + w * x);
  return out;
}

/** No edits at all: what the plan asks with no lights file. */
export const NO_ROOM_EDITS: RoomEditsFor = { edit: () => null, fill: () => null, added: () => [] };

/**
 * The lights of room `cell` under the owner's edits (`edits`), cut at the pool's `shape`, in the pool's order (`roomLightPlan`
 * above); null for a room the building has not got. Per cell, in that order: its own fill (each type-0 light edited by its
 * index, the cell's fill row's colour in place of them and its scale over them), its parallel candidate (a directional added
 * to it, narrowest first, else its first type-1 light not switched off), and its points (the game's own as edited, then the
 * lights added, narrowest first), each taking a casting slot of its type where it asks for a shadow and one is free, else a
 * plain one (and counted where it asked), else left and counted. With no edits and the default shape it answers what
 * `roomLightPlan` answers.
 */
export function planRoomLights(cells: readonly RoomLightCell[], cell: number, ambientFloor: number, shape: Readonly<PoolShape> = DEFAULT_POOL, edits: RoomEditsFor = NO_ROOM_EDITS): RoomLightsPlanned | null {
  const current = cells.find((c) => c.index === cell);
  if (!current) return null;
  const order = [cell, ...(current.portals ?? []).map((p) => p.target).filter((t) => t > 0 && t !== cell)];
  const ambient: [number, number, number] = [ambientFloor, ambientFloor, ambientFloor];
  const out: RoomLightsPlanned = { ambient, parallel: null, points: [], pointShadows: [], spots: [], spotShadows: [], left: { points: 0, spots: 0, shadowsRefused: 0 } };
  const lamp = (cellIndex: number, key: string, game: number, color: readonly [number, number, number], at3: number, range: number, decay: number, pos: readonly number[], asked: boolean, spec: LightSpec | null): PlannedLamp => {
    const fl = spec?.flicker;
    return {
      cell: cellIndex,
      key,
      game,
      color: [color[0], color[1], color[2]],
      at3,
      range,
      decay,
      pos: [pos[0], pos[1], pos[2]],
      dir: [0, -1, 0],
      angle: 0,
      penumbra: 0,
      shadow: false,
      asked,
      flicker: fl ? (FLICKER_CODE[fl.shape] ?? 0) : 0,
      rate: fl ? fl.rate : 0,
      depth: fl ? fl.depth : 0,
      seed: 0,
    };
  };
  const takePoint = (p: PlannedLamp): void => {
    if (p.asked && out.pointShadows.length < shape.pointShadows) {
      p.shadow = true;
      out.pointShadows.push(p);
      return;
    }
    if (out.points.length < shape.points) {
      if (p.asked) out.left.shadowsRefused++;
      out.points.push(p);
      return;
    }
    out.left.points++;
  };
  const takeSpot = (p: PlannedLamp): void => {
    if (p.asked && out.spotShadows.length < shape.spotShadows) {
      p.shadow = true;
      out.spotShadows.push(p);
      return;
    }
    if (out.spots.length < shape.spots) {
      if (p.asked) out.left.shadowsRefused++;
      out.spots.push(p);
      return;
    }
    out.left.spots++;
  };
  for (const index of order) {
    const c = cells.find((x) => x.index === index);
    const fill = edits.fill(index);
    const added = edits.added(index);
    // The cell's directional added, narrowest first: the room's parallel in place of its own (one switched off is none).
    let ownParallel: AddedLightLike | null = null;
    for (const a of added) {
      if (a.spec.type === 'directional' && !edits.edit(index, a.key)?.off) {
        ownParallel = a;
        break;
      }
    }
    const lights = c?.lights ?? [];
    // Its fill: each light's own colour added as it is met (the order the pool always added them in, so a room with no edit
    // sums to the bit what it summed), or the fill row's colour in place of them all.
    if (fill?.color) {
      const s = fill.scale ?? 1;
      ambient[0] += fill.color[0] * s;
      ambient[1] += fill.color[1] * s;
      ambient[2] += fill.color[2] * s;
    }
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const e = edits.edit(index, i);
      if (l.type === 0) {
        if (fill?.color || e?.off) continue;
        if (!e && fill?.scale === undefined) {
          ambient[0] += l.color[0];
          ambient[1] += l.color[1];
          ambient[2] += l.color[2];
          continue;
        }
        const s = (e?.scale ?? 1) * (fill?.scale ?? 1);
        const col = e?.color ?? l.color;
        ambient[0] += col[0] * s;
        ambient[1] += col[1] * s;
        ambient[2] += col[2] * s;
        continue;
      }
      if (l.type === 1) {
        if (out.parallel || ownParallel || e?.off) continue;
        const col = e?.color ?? l.color;
        out.parallel = {
          cell: index,
          key: `g:${index}:${i}`,
          game: i,
          color: [col[0], col[1], col[2]],
          scale: e?.scale ?? 1,
          pos: [l.position[0], l.position[1], l.position[2]],
          dir: [l.direction[0], l.direction[1], l.direction[2]],
          shadow: false,
          asked: !!e?.shadow,
          flicker: 0,
          rate: 0,
          depth: 0,
          seed: 0,
        };
        continue;
      }
      if (e?.off) continue;
      // A game lamp as the pool always lit it, its edits laid on: its brightness scaled, its colour and reach in place.
      const at3 = e?.scale !== undefined ? pointLightAt3(l.attenuation) * e.scale : pointLightAt3(l.attenuation);
      const range = e?.reach ?? pointLightRange(l.attenuation);
      takePoint(lamp(index, `g:${index}:${i}`, i, e?.color ?? (l.color as unknown as [number, number, number]), at3, range, 2, l.position, !!e?.shadow, null));
    }
    if (ownParallel && !out.parallel) {
      const a = ownParallel;
      const e = edits.edit(index, a.key);
      {
        const col = e?.color ?? a.spec.color;
        const dir: [number, number, number] = [0, -1, 0];
        shineOf(a.q, dir);
        const fl = a.spec.flicker;
        out.parallel = {
          cell: index,
          key: a.key,
          game: -1,
          color: [col[0], col[1], col[2]],
          scale: a.spec.brightness * (e?.scale ?? 1),
          pos: [a.pos[0], a.pos[1], a.pos[2]],
          dir,
          shadow: false,
          asked: e?.shadow ?? !!a.spec.shadow,
          flicker: fl ? (FLICKER_CODE[fl.shape] ?? 0) : 0,
          rate: fl ? fl.rate : 0,
          depth: fl ? fl.depth : 0,
          seed: flickerSeed(`${a.key}@${a.where}`),
        };
      }
    }
    for (const a of added) {
      if (a.spec.type === 'directional') continue;
      const e = edits.edit(index, a.key);
      if (e?.off) continue;
      const col = e?.color ?? a.spec.color;
      const at3 = a.spec.brightness * (e?.scale ?? 1);
      const range = e?.reach ?? a.spec.reach ?? DEFAULT_REACH;
      const p = lamp(index, a.key, -1, col, at3, range, a.spec.falloff ?? 2, a.pos, e?.shadow ?? !!a.spec.shadow, a.spec);
      p.seed = flickerSeed(`${a.key}@${a.where}`);
      if (a.spec.type === 'spot') {
        shineOf(a.q, p.dir);
        const cone = coneOf(a.spec);
        const outer = Math.min(89, Math.max(1, cone[1]));
        p.angle = (outer * Math.PI) / 180;
        p.penumbra = outer > 0 ? Math.min(1, Math.max(0, 1 - cone[0] / outer)) : 0;
        takeSpot(p);
      } else takePoint(p);
    }
  }
  // The room's parallel light never casts (three's cascades would read a casting directional as one of the sun's and light it
  // only within the near cascade's band): its shadow is kept in the file, lit without one and counted.
  if (out.parallel && out.parallel.asked) out.left.shadowsRefused++;
  return out;
}

/** A point light's value at 3 m by its constants, held at a twentieth (`1 / max(0.05, c + 3 l + 9 q)`). */
export function pointLightAt3(att: readonly number[]): number {
  const c = att[0];
  const li = att[1];
  const q = att[2];
  return 1 / Math.max(0.05, c + 3 * li + 9 * q);
}

/**
 * A point light's range by the game's rule: Direct3D falloff `1 / (c + l d + q d^2)` matched at 3 m to three's `I / d^2`,
 * cut at the first whole metre where it fades below 5% of that, and 40 where it never does.
 */
export function pointLightRange(att: readonly number[]): number {
  const c = att[0];
  const li = att[1];
  const q = att[2];
  const at3 = 1 / Math.max(0.05, c + 3 * li + 9 * q);
  for (let d = 1; d <= 40; d++) {
    if (1 / (c + li * d + q * d * d) < at3 * 0.05) return d;
  }
  return 40;
}

/** A cell as the room pool reads it: its index, the rooms its doorways open on, its own lights. */
export interface RoomLightCell {
  index: number;
  portals?: readonly { target: number }[];
  lights?: readonly CellLight[];
}

/** One point light the pool lights: the cell it is of, the light, its value at 3 m and its range. */
export interface RoomPoint {
  cell: number;
  light: CellLight;
  at3: number;
  range: number;
}

/** What lights a room: the ambient, the one parallel light (the first met), and the point lights, at most the pool's. */
export interface RoomLightPlan {
  ambient: [number, number, number];
  parallel: CellLight | null;
  points: RoomPoint[];
}

/**
 * The lights of the room `cell` of a building's `cells` and the rooms its doorways open on, in the pool's order; null for a
 * room the building has not got. `ambientFloor` is where the ambient starts (rooms are never pitch black), every room's own
 * fill (a type-0 light) added to it in the order met; the first parallel light (type 1) is the room's; every other light is a
 * point, up to `cap`.
 */
export function roomLightPlan(cells: readonly RoomLightCell[], cell: number, ambientFloor: number, cap = INTERIOR_LIGHT_CAP): RoomLightPlan | null {
  const current = cells.find((c) => c.index === cell);
  if (!current) return null;
  const order = [cell, ...(current.portals ?? []).map((p) => p.target).filter((t) => t > 0 && t !== cell)];
  const ambient: [number, number, number] = [ambientFloor, ambientFloor, ambientFloor];
  let parallel: CellLight | null = null;
  const points: RoomPoint[] = [];
  for (const index of order) {
    const c = cells.find((x) => x.index === index);
    for (const l of c?.lights ?? []) {
      if (l.type === 0) {
        ambient[0] += l.color[0];
        ambient[1] += l.color[1];
        ambient[2] += l.color[2];
        continue;
      }
      if (l.type === 1) {
        if (!parallel) parallel = l;
        continue;
      }
      if (points.length >= cap) continue;
      points.push({ cell: index, light: l, at3: pointLightAt3(l.attenuation), range: pointLightRange(l.attenuation) });
    }
  }
  return { ambient, parallel, points };
}
