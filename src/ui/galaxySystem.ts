// The galaxy map's opened system (the GPU port's pass 2, wave 5, maker M; the design's section 3, "a picked system opens"): a
// system picked on the map opens into its sun, its worlds and their moons, each where the clockwork puts it now at the System
// view's readable scale, with its orbit line and its lit side from where its star really is, so what the map shows is what
// the ground's sky shows (maker S's `skyMotion.ts` reads the very model and the very time). A system the owner has not
// applied (no star system of his Save to game holds its worlds) shows its worlds in a ring round its sun, still.
//
// Pure: no three, no page. The map's view (`galaxyView.ts`) copies the numbers written here into its meshes once a frame;
// node runs this file as it stands (`galaxySystem.test.ts`, `galaxySystemAlloc.test.ts`).
//
// **The frames.** The clockwork's system space (`system.js`: the star at its middle, its plane x-y, z out of it, in
// astronomical units) is laid into the map's frame (x east, y out of the galactic plane, z south) as (x, z, -y), a turn that
// keeps hands; the readable layout's reach is `SYSTEM_VIEW_TUNE.span` map units about the system's place in the galaxy. The
// time is the sky's (`T`, real days since `system.js`' `EPOCH_MS` for a system of version 2): the ground's own when the
// player stands under this system (`SKY_MOTION.now.T`, held hours and all), else the shared clock's real days, which is what
// the ground's count makes of the same clock to the bit (`skyMotion.ts`' head).
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension.

import { compileSystem, makeSkyState, skyAtNext, cleanSystem } from '../sky/system/system.js';
import { draftSystem } from '../sky/system/drafts.js';
import { appliedSystemOf, type SystemsRecord } from '../sky/system/worldDays.ts';
import { viewerSkyOf } from '../sky/look/lookPictures.ts';
import { PLANETS, type PlanetDef } from '../data/planets.ts';
import { worldsOf, type GalaxySystemDef } from '../data/galaxy.ts';

/**
 * The opened system's numbers (feel and look are the owner's; each start's reason beside it):
 *   - **span: 90.** How far the readable layout reaches about the system's place, in the map's units (the System view's own
 *     room, `orrery.js`' `0.42 · min(w, h)`): a grid square is 100, so an opened system fills about what its square did.
 *   - **startDistance: 230.** Where the camera stands from the system's middle as it opens: the span and its labels in the
 *     frame at the view's 50-degree lens.
 *   - **startPitch: 0.95.** How far it looks down on the system's plane as it opens, radians: the System view's 58 degrees.
 *   - **distanceMin: 8.** How near the wheel brings it: a moon's globe filling a good part of the view.
 *   - **bodyScale: 1.25.** Each globe's radius over the System view's dot for its kind: the dots are pin-heads and a look needs
 *     a few more pixels to be read as a world, while a giant's nearest moon still stands clear of it (Yavin Prime's 8 and Yavin
 *     4's 6 grown by a quarter are 17.5 of the System view's pixels, its readable orbit 18.7; at 1.6 the two globes overlap).
 *   - **discFade: 0.3.** The galaxy's disc while a system is open, as a share of its own opacity: a band behind the system,
 *     never a crowd in front of it.
 *   - **fadeSeconds: 0.5.** How long the disc takes to fade, and to come back.
 *   - **ringShare: 0.62.** A system with no applied draft: the ring its worlds stand on, as a share of the span.
 *   - **bodySize: 256.** The pictures a body of an opened system wears, texels across (its look's bake halved): a body stands
 *     a few to a couple of hundred pixels across at the opened view's start, and a 256 by 128 picture holds that; some
 *     256 KB a look with its clouds.
 *   - **starGlow: 7.** The sun's glow, as a multiple of its globe's radius.
 *   - **ambient: 0.05.** The light a globe's night side keeps, a share of the lit side's: enough to read the body as a body,
 *     not enough to read its night as day.
 *   - **light: 2.2.** The opened system's starlight on the globes (the map's own light's strength).
 *   - **markUnderPx: 12.** The galaxy's two rings (where you stand, the body picked) are drawn round a globe only while it is
 *     under so many pixels of radius on the screen: a globe brought near reads by itself and its name, and a ring three times
 *     its size would fill the view.
 *   - **labelRowPx: 16, labelSpanPx: 110** (the fixer of wave 5). Two names closer than a row's height up or down and a name's
 *     span across would overlap: the later of them (a moon after its world, the picked body and yours never) is hidden until
 *     the view is brought near enough to part them; and a name that would run past the panel's right edge stands to the left
 *     of its globe. 16 is a label's line at the map's type size; 110 the width of a moon's name of a dozen letters.
 */
export const SYSTEM_VIEW_TUNE = {
  span: 90,
  startDistance: 230,
  startPitch: 0.95,
  distanceMin: 8,
  bodyScale: 1.25,
  discFade: 0.3,
  fadeSeconds: 0.5,
  ringShare: 0.62,
  bodySize: 256,
  starGlow: 7,
  ambient: 0.05,
  light: 2.2,
  markUnderPx: 12,
  labelRowPx: 16,
  labelSpanPx: 110,
};

/** The System view's base in its own pixels at a 800-pixel view (`orrery.js`' `0.42 · min(w, h)`): its sizes are kept in it. */
export const ORRERY_BASE = 336;
/** The System view's dot for each kind, in its pixels (`orrery.js`' `KIND_PX`). */
export const KIND_PX: Readonly<Record<string, number>> = { star: 11, pair: 9, giant: 8, planet: 6, moon: 4, group: 3, station: 2, comet: 2.5, belt: 2 };
/** The System view's colour for each kind (`orrery.js`' `KIND_COLOUR`): a body with no lore colour wears it. */
export const KIND_COLOUR: Readonly<Record<string, number>> = { star: 0xffd27a, pair: 0xffd27a, giant: 0xd9a066, planet: 0x7fb0d9, moon: 0xb9bcc0, group: 0xc9c2b0, station: 0xc8d0d4, comet: 0xe8eef2, belt: 0x8c8478 };
/** At most so many globes an opened system draws (its bodies, a pair's two suns, a group's members): the view's pool. */
export const MAX_GLOBES = 64;
/** At most so many bodies an opened system labels and rings (`system.js`' `MAX_BODIES2`). */
export const MAX_SYSTEM_BODIES = 48;

/** What the readable layout reads of a model of version 2. */
export interface LayoutModel {
  n: number;
  parent: Int16Array;
  radius: Float64Array;
  sunI: number;
}

/**
 * The System view's readable orbits (`orrery.js`' `layout`, its rule to the letter): each parent's children spread out in the
 * order of their radii over its room, a child's own room half its share, never under ten of the view's pixels. `base` is the
 * sun's room in those pixels.
 */
export function readableRadii(model: LayoutModel, base: number): Float64Array {
  const n = model.n;
  const kids: number[][] = [];
  for (let i = 0; i < n; i++) kids.push([]);
  for (let i = 0; i < n; i++) if (model.parent[i] >= 0) kids[model.parent[i]].push(i);
  const r = new Float64Array(n);
  const step = new Float64Array(n);
  step[model.sunI] = base;
  const walk = (p: number, span: number): void => {
    const list = kids[p].slice().sort((a, b) => model.radius[a] - model.radius[b]);
    const c = list.length;
    list.forEach((i, k) => {
      r[i] = span * (0.32 + (0.68 * (k + 1)) / c);
      step[i] = Math.max(10, ((span * 0.68) / c) * 0.5);
    });
    for (const i of list) walk(i, step[i]);
  };
  walk(model.sunI, base);
  return r;
}

/** One body of an opened system (made once as it opens). */
export interface OpenedBody {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** Its parent's index, -1 for the sun (or a ring's middle). */
  readonly parent: number;
  /** Its lore colour as a number, else its kind's. */
  readonly colour: number;
  readonly star: boolean;
  /** Whether the sky draws it (a body not drawn is shown dim, its orbit dashed). */
  readonly drawn: boolean;
  /** Whether it has an orbit line of its own (a body that follows another has none, nor does the middle). */
  readonly orbit: boolean;
  /** Its orbit dashed: a belt's, or a body not drawn. */
  readonly dashed: boolean;
  /** The game's planet it is a ground world of (Travel), or null. */
  readonly ground: string | null;
  /** The world the view is seen from (the player's, when the player stands in this system). */
  readonly here: boolean;
  /** The sky's item it is seen as from the view's world (`items[j]`, `dir[3j]`, `lit[j]`), or -1. */
  readonly item: number;
  /** The places it stands for (the system's), for its look. */
  readonly places: readonly string[];
  /** The look the system names for it, or null (the file's `uses` may name one for a place). */
  readonly look: string | null;
  /** Its own orbit: a period in real days and a radius in astronomical units (0 for the middle). */
  readonly periodDays: number;
  readonly au: number;
  /** Its axis's lean, degrees (a ring lies in its equator). */
  readonly axialTiltDeg: number;
  /** Its readable orbit's radius, the map's units. */
  readonly readable: number;
}

/** One globe the view draws (a body's, or a pair's second sun, or a group's member). */
export interface OpenedGlobe {
  readonly body: number;
  readonly star: boolean;
  /** Its radius, the map's units. */
  readonly radius: number;
  readonly colour: number;
  /** Where it stands off its body's place (a pair's suns side by side, a group's members about it), the map's units. */
  readonly offX: number;
  readonly offZ: number;
  /** A group's member's index, or -1. */
  readonly member: number;
}

/** A kept record the frame's time is written into before `at` reads it, so no number crosses the call. */
export interface SystemClock {
  T: number;
}

type V2Model = LayoutModel & {
  version: number;
  m: number;
  order: Int16Array;
  follow: Int16Array;
  worldI: number;
  itemBody: Int16Array;
  itemMember: Uint8Array;
  sys: { bodies: { id: string; kind: string; name: string; colour?: string | null; drawn?: boolean; period?: number; radius?: number; axialTilt?: number; places?: string[]; look?: string | null; members?: unknown[] }[]; grounds: { world: string; body: string | null; copy: string | null }[] };
};
type V2State = { next: number; pos: Float64Array; unit: Float64Array; basis: Float64Array; dir: Float64Array; lit: Float64Array; light: Float64Array; R: Float64Array; T: number };

const hexOf = (v: unknown, fallback: number): number => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : fallback);

/** The game's planet a viewer's world (a sky's id: `kashyyyk_main`) stands for, or null. */
export function planetOfWorld(world: string): PlanetDef | null {
  return PLANETS.find((p) => !p.space && !p.instances && viewerSkyOf(p.id) === world) ?? null;
}

/**
 * The star system of the owner's Save to game a galaxy system opens into: the applied system of version 2 that holds one of
 * its ground worlds (by the viewer's id for each: Kashyyyk's is `kashyyyk_main`), with the world it is seen from (`here`'s
 * when the player stands on one of them, else its first); null where none is applied (the ring) or the file has none.
 */
export function appliedFor(sys: GalaxySystemDef, systems: SystemsRecord | null | undefined, here: string | null): { id: string; sys: Record<string, unknown>; world: string } | null {
  if (!systems) return null;
  const worlds = worldsOf(sys)
    .map((w) => w.planet)
    .filter((p) => !p.space)
    .map((p) => viewerSkyOf(p.id));
  const hereWorld = here ? viewerSkyOf(here) : null;
  const order = hereWorld && worlds.includes(hereWorld) ? [hereWorld, ...worlds.filter((w) => w !== hereWorld)] : worlds;
  for (const w of order) {
    const a = appliedSystemOf(systems, w);
    if (a && a.rule === 'system') return { id: a.id, sys: a.sys, world: w };
  }
  return null;
}

/**
 * A galaxy system opened: its bodies, its globes and, each frame, where each stands (`pos`, the map's units about the
 * system's middle), the way from it to its star (`light`), and each orbit's frame (`orbitM`, three's matrix order: the unit
 * circle in x-y laid on the orbit). Made once as it opens; `at` moves it, allocating nothing.
 */
export class OpenedSystem {
  /** The galaxy system's id, the file's system key (or null for a ring), its name. */
  readonly galaxyId: string;
  readonly id: string | null;
  readonly name: string;
  /** 'clockwork' (an applied system, moving) or 'ring' (its worlds in a ring, still). */
  readonly layout: 'clockwork' | 'ring';
  /** The world it is seen from (the viewer's id), or null for a ring. */
  readonly world: string | null;
  readonly bodies: readonly OpenedBody[];
  readonly globes: readonly OpenedGlobe[];
  /** The time the frame writes before `at` reads it (`T`, the sky's). */
  readonly clock: SystemClock = { T: Number.NaN };

  // ---- each frame (kept)
  /** Each body's place, the map's units about the system's middle (3 a body). */
  readonly pos: Float64Array;
  /** Each body's way to its star, unit, the map's frame (3 a body; nought for the middle). */
  readonly light: Float64Array;
  /** Each body's orbit frame in three's matrix order (16 a body; only bodies with `orbit`). */
  readonly orbitM: Float64Array;
  /** Each body's lit share as its world sees it (the sky's `lit[item]`), -1 where it is not seen from there. */
  readonly litSeen: Float64Array;
  /** The time the last `at` stood at. */
  T = Number.NaN;

  private readonly model: V2Model | null;
  private readonly state: V2State | null;
  private readonly scale: number;
  private readonly readableR: Float64Array;

  private constructor(galaxyId: string, id: string | null, name: string, world: string | null, model: V2Model | null, state: V2State | null, bodies: OpenedBody[], globes: OpenedGlobe[], scale: number, readableR: Float64Array) {
    this.galaxyId = galaxyId;
    this.id = id;
    this.name = name;
    this.layout = model ? 'clockwork' : 'ring';
    this.world = world;
    this.model = model;
    this.state = state;
    this.bodies = bodies;
    this.globes = globes;
    this.scale = scale;
    this.readableR = readableR;
    const n = bodies.length;
    this.pos = new Float64Array(3 * n);
    this.light = new Float64Array(3 * n);
    this.orbitM = new Float64Array(16 * n);
    this.litSeen = new Float64Array(n).fill(-1);
  }

  /** The model and its state (the tests' and the console's): null for a ring. */
  get clockwork(): { model: Record<string, unknown>; state: Record<string, unknown> } | null {
    return this.model && this.state ? { model: this.model as unknown as Record<string, unknown>, state: this.state as unknown as Record<string, unknown> } : null;
  }

  /**
   * A galaxy system opened from the owner's file (`systems`, the Save to game's), seen from `here` (the player's planet id, or
   * null): its applied star system's clockwork, else its worlds in a ring round its sun.
   */
  static open(sys: GalaxySystemDef, systems: SystemsRecord | null | undefined, here: string | null): OpenedSystem {
    const s = SYSTEM_VIEW_TUNE.span / ORRERY_BASE;
    const applied = appliedFor(sys, systems, here);
    if (applied) {
      const opened = OpenedSystem.clockworkOf(sys, applied, here, s);
      if (opened) return opened;
    }
    return OpenedSystem.ringOf(sys, here, s);
  }

  private static clockworkOf(g: GalaxySystemDef, a: { id: string; sys: Record<string, unknown>; world: string }, here: string | null, s: number): OpenedSystem | null {
    let model: V2Model;
    try {
      model = compileSystem(a.sys, () => null, () => false, { world: a.world }) as unknown as V2Model;
    } catch {
      return null;
    }
    if (model.version !== 2) return null;
    const state = makeSkyState(model as unknown as Record<string, unknown>) as unknown as V2State;
    const n = Math.min(model.n, MAX_SYSTEM_BODIES);
    const readable = readableRadii(model, ORRERY_BASE);
    const B = model.sys.bodies;
    const groundOf = new Map<string, string>();
    for (const gr of model.sys.grounds) if (!gr.copy && gr.body) groundOf.set(gr.body, gr.world);
    const hereWorld = here ? viewerSkyOf(here) : null;
    // A body's name: the file's, else (the Save to game keeps numbers, and a body it names by its id alone) the draft's lore name.
    const draft = draftSystem(a.id) as { bodies?: { id: string; name: string }[] } | null;
    const nameOf = (b: { id: string; name: string }): string => (b.name && b.name !== b.id ? b.name : (draft?.bodies?.find((x) => x.id === b.id)?.name ?? b.name));
    const itemOf = new Int16Array(model.n).fill(-1);
    for (let j = 0; j < model.m; j++) if (!model.itemMember[j] && itemOf[model.itemBody[j]] < 0) itemOf[model.itemBody[j]] = j;
    const bodies: OpenedBody[] = [];
    const globes: OpenedGlobe[] = [];
    for (let i = 0; i < n; i++) {
      const b = B[i];
      const world = groundOf.get(b.id) ?? null;
      const planet = world ? planetOfWorld(world) : null;
      const star = b.kind === 'star' || b.kind === 'pair';
      const parent = model.parent[i] < n ? model.parent[i] : -1;
      const follows = model.follow[i] >= 0;
      bodies.push({
        index: i,
        id: b.id,
        name: nameOf(b),
        kind: b.kind,
        parent,
        colour: hexOf(b.colour, KIND_COLOUR[b.kind] ?? 0xaaaaaa),
        star,
        drawn: b.drawn !== false,
        orbit: parent >= 0 && !follows,
        dashed: b.drawn === false || b.kind === 'belt',
        ground: planet ? planet.id : null,
        here: !!world && world === a.world && world === hereWorld,
        item: itemOf[i],
        places: Array.isArray(b.places) ? b.places.slice() : [],
        look: typeof b.look === 'string' ? b.look : null,
        periodDays: Number(b.period) || 0,
        au: parent >= 0 ? Number(b.radius) || 0 : 0,
        axialTiltDeg: Number(b.axialTilt) || 0,
        readable: readable[i] * s,
      });
      // The globes: a pair's two suns side by side (the System view's), a group's members about it, a belt none.
      const px = (i === model.worldI ? 6 : KIND_PX[b.kind] ?? 4) * s * SYSTEM_VIEW_TUNE.bodyScale;
      const colour = bodies[i].colour;
      if (globes.length >= MAX_GLOBES) continue;
      if (b.kind === 'pair') {
        const m = (b.members ?? []) as { colour?: string | null; size?: number | null }[];
        const r0 = px * 0.8;
        const r1 = px * 0.8 * Math.min(1, (Number(m[1]?.size) || 14) / (Number(m[0]?.size) || 20) + 0.15);
        globes.push({ body: i, star: true, radius: r0, colour: hexOf(m[0]?.colour, colour), offX: -px * 0.75, offZ: 0, member: -1 });
        if (globes.length < MAX_GLOBES) globes.push({ body: i, star: true, radius: r1, colour: hexOf(m[1]?.colour, colour), offX: px * 0.95, offZ: px * 0.35, member: -1 });
      } else if (b.kind === 'group') {
        const k = Math.max(1, (b.members ?? []).length);
        for (let q = 0; q < k && globes.length < MAX_GLOBES; q++) {
          const ang = (q / k) * Math.PI * 2 + 0.6;
          globes.push({ body: i, star: false, radius: px, colour, offX: Math.cos(ang) * 5 * s * SYSTEM_VIEW_TUNE.bodyScale, offZ: Math.sin(ang) * 4 * s * SYSTEM_VIEW_TUNE.bodyScale, member: q });
        }
      } else if (b.kind !== 'belt') globes.push({ body: i, star, radius: px, colour, offX: 0, offZ: 0, member: -1 });
    }
    return new OpenedSystem(g.id, a.id, String((a.sys as { name?: unknown }).name ?? g.name), a.world, model, state, bodies, globes, s, readable);
  }

  private static ringOf(g: GalaxySystemDef, here: string | null, s: number): OpenedSystem {
    const worlds = worldsOf(g).map((w) => w.planet);
    const bodies: OpenedBody[] = [];
    const globes: OpenedGlobe[] = [];
    const ringR = SYSTEM_VIEW_TUNE.span * SYSTEM_VIEW_TUNE.ringShare;
    bodies.push({ index: 0, id: 'sun', name: g.name.replace(/ system$/, ''), kind: 'star', parent: -1, colour: KIND_COLOUR.star, star: true, drawn: true, orbit: false, dashed: false, ground: null, here: false, item: -1, places: [], look: null, periodDays: 0, au: 0, axialTiltDeg: 0, readable: 0 });
    globes.push({ body: 0, star: true, radius: KIND_PX.star * s * SYSTEM_VIEW_TUNE.bodyScale, colour: KIND_COLOUR.star, offX: 0, offZ: 0, member: -1 });
    worlds.forEach((p, k) => {
      const i = bodies.length;
      bodies.push({ index: i, id: p.id, name: p.name, kind: 'planet', parent: 0, colour: p.palette?.mid ?? KIND_COLOUR.planet, star: false, drawn: true, orbit: k === 0, dashed: false, ground: p.id, here: p.id === here, item: -1, places: [], look: null, periodDays: 0, au: 0, axialTiltDeg: 0, readable: ringR });
      globes.push({ body: i, star: false, radius: KIND_PX.planet * s * SYSTEM_VIEW_TUNE.bodyScale, colour: bodies[i].colour, offX: 0, offZ: 0, member: -1 });
    });
    const opened = new OpenedSystem(g.id, null, g.name, null, null, null, bodies, globes, s, new Float64Array(bodies.length));
    // Still: laid once. Each world at its share of the ring, the first toward the view's start; each lit from the middle.
    const W = worlds.length;
    for (let k = 0; k < W; k++) {
      const i = k + 1;
      const a = (k / Math.max(1, W)) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      opened.pos[3 * i] = x;
      opened.pos[3 * i + 1] = 0;
      opened.pos[3 * i + 2] = z;
      opened.light[3 * i] = -x / ringR;
      opened.light[3 * i + 1] = 0;
      opened.light[3 * i + 2] = -z / ringR;
    }
    // The one ring line, on the first world (the others stand on it): the unit circle laid flat in the map's plane.
    const o = 16;
    opened.orbitM.set([ringR, 0, 0, 0, 0, 0, -ringR, 0, 0, 1, 0, 0, 0, 0, 0, 1], o);
    opened.T = 0;
    return opened;
  }

  /**
   * The system at the clock's time (`clock.T`, written by the frame before the call): the clockwork moved there
   * (`skyAtNext`, the very call the ground's sky makes), then each body laid at its readable place along the clockwork's own
   * way round its parent, its way to its star from where both truly stand, its orbit's frame, and its lit share as its world
   * sees it. A ring stands still. Allocates nothing.
   */
  at(): void {
    const M = this.model;
    const st = this.state;
    if (!M || !st) return;
    const T = this.clock.T;
    if (!(T === T)) return;
    st.next = T;
    skyAtNext(M as unknown as Record<string, unknown>, st as unknown as Record<string, unknown>);
    this.T = T;
    const n = this.bodies.length;
    const s = this.scale;
    const pos = this.pos;
    const unit = st.unit;
    const tp = st.pos;
    const order = M.order;
    const R = this.readableR;
    // Each body at its parent's place and its readable radius along the clockwork's way: parents first (the model's order).
    for (let q = 0; q < M.n; q++) {
      const i = order[q];
      if (i >= n) continue;
      const p = this.bodies[i].parent;
      const i3 = 3 * i;
      if (p < 0) {
        pos[i3] = 0;
        pos[i3 + 1] = 0;
        pos[i3 + 2] = 0;
        continue;
      }
      const r = R[i] * s;
      const p3 = 3 * p;
      // System space (x, y, z) into the map's frame (x, z, -y).
      pos[i3] = pos[p3] + r * unit[i3];
      pos[i3 + 1] = pos[p3 + 1] + r * unit[i3 + 2];
      pos[i3 + 2] = pos[p3 + 2] - r * unit[i3 + 1];
    }
    // The way to the star from where each truly stands, and each orbit's frame.
    const sun3 = 3 * M.sunI;
    const basis = st.basis;
    const om = this.orbitM;
    for (let i = 0; i < n; i++) {
      const i3 = 3 * i;
      let lx = tp[sun3] - tp[i3];
      let ly = tp[sun3 + 1] - tp[i3 + 1];
      let lz = tp[sun3 + 2] - tp[i3 + 2];
      const l = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (l > 1e-12) {
        lx /= l;
        ly /= l;
        lz /= l;
      } else {
        lx = 0;
        ly = 0;
        lz = 0;
      }
      this.light[i3] = lx;
      this.light[i3 + 1] = lz;
      this.light[i3 + 2] = -ly;
      const b = this.bodies[i];
      if (!b.orbit) continue;
      const r = R[i] * s;
      const o = 9 * i;
      const k = 16 * i;
      const p3 = 3 * b.parent;
      // u, v (the orbit's plane) and their cross, each into the map's frame.
      const ux = basis[o];
      const uy = basis[o + 2];
      const uz = -basis[o + 1];
      const vx = basis[o + 3];
      const vy = basis[o + 5];
      const vz = -basis[o + 4];
      om[k] = ux * r;
      om[k + 1] = uy * r;
      om[k + 2] = uz * r;
      om[k + 3] = 0;
      om[k + 4] = vx * r;
      om[k + 5] = vy * r;
      om[k + 6] = vz * r;
      om[k + 7] = 0;
      om[k + 8] = uy * vz - uz * vy;
      om[k + 9] = uz * vx - ux * vz;
      om[k + 10] = ux * vy - uy * vx;
      om[k + 11] = 0;
      om[k + 12] = pos[p3];
      om[k + 13] = pos[p3 + 1];
      om[k + 14] = pos[p3 + 2];
      om[k + 15] = 1;
    }
    // Each body's lit share as the world it is seen from sees it (the sky's own `lit`).
    const lit = st.lit;
    for (let i = 0; i < n; i++) {
      const j = this.bodies[i].item;
      this.litSeen[i] = j >= 0 ? lit[j] : -1;
    }
  }

  /** What the console and the prover read: the system, the time and each body as the map has it now (plain numbers). */
  report(): Record<string, unknown> {
    const r4 = (v: number): number => Number(v.toFixed(4));
    const st = this.state;
    return {
      galaxy: this.galaxyId,
      system: this.id,
      name: this.name,
      layout: this.layout,
      world: this.world,
      T: Number.isFinite(this.T) ? this.T : null,
      bodies: this.bodies.map((b, i) => ({
        name: b.name,
        kind: b.kind,
        ground: b.ground,
        here: b.here || undefined,
        item: b.item,
        at: [r4(this.pos[3 * i]), r4(this.pos[3 * i + 1]), r4(this.pos[3 * i + 2])],
        light: [r4(this.light[3 * i]), r4(this.light[3 * i + 1]), r4(this.light[3 * i + 2])],
        // Its lit share as its world sees it, and the sky's direction of it from that world (sky frame), both to the last bit so a
        // prover can hold them against the ground's (`SKY_MOTION.now`); the clockwork's own way round its parent (system space).
        lit: this.litSeen[i] >= 0 ? this.litSeen[i] : null,
        unit: st ? [r4(st.unit[3 * i]), r4(st.unit[3 * i + 1]), r4(st.unit[3 * i + 2])] : null,
        dir: st && b.item >= 0 ? [st.dir[3 * b.item], st.dir[3 * b.item + 1], st.dir[3 * b.item + 2]] : null,
      })),
    };
  }
}

/** A system of the file cleaned (`system.js`' own), or null: the console's. */
export function cleanedSystem(raw: unknown): Record<string, unknown> | null {
  return cleanSystem(raw) as Record<string, unknown> | null;
}
