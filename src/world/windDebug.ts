// `__debug.wind` (the volumetrics' wave 7a, the design's §14b): the unified wind where the player stands, its profile and
// its world, the phases, the read-outs, the sky's sheets and the devils; the hold the owner asked to use now (with the
// master on or off); a point now or at a shared second (what two tabs compare); the tune; a devil of this browser's own;
// and the self test through the game's own programs. It never saves anything. The game hands it what it needs
// (`WindDebugContext`), so this file reads nothing of the page.
import { DEVIL_W, WIND_KINDS, type WindProfile } from './windMath.ts';
import {
  WIND_DAY,
  WIND_FRAME,
  WIND_HOLD,
  WIND_LOCAL_DEVIL,
  WIND_STATE,
  WIND_TUNE,
  holdWind,
  releaseWind,
  remakeWindTableNow,
  standLocalDevil,
  tuneWind,
  windAtPoint,
  windBlendNow,
  windHeld,
  windObserver,
  windPattern,
  windReadouts,
  windTableState,
  windWorldId,
  windWorldOf,
  windWorldTable,
  worldKindsAt,
} from './wind.ts';

export interface WindDebugOptions {
  /** Hold the wind at this speed, m/s (null or below nought lets go of the speed). */
  speed?: number | null;
  /** Hold its heading, degrees (0 = +Z turning toward +X; null lets go). */
  heading?: number | null;
  /** Hold its gusts: 0 steady, 1 as the weather says, 2 twice (null lets go). */
  gust?: number | null;
  /** `false` lets go of all three. */
  hold?: boolean;
  /** The wind at a point now, or at shared second `t` from a pack built afresh for that moment. */
  at?: [number, number];
  t?: number;
  /** Moves `WIND_TUNE` (by group), `WIND_PROFILES` (`profiles`) and `WIND_WORLDS` (`worlds`). */
  tune?: Record<string, unknown>;
  /** With a moved `soft` or `octave2`, make the gusts' table whole now rather than over a few frames. */
  now?: boolean;
  /** A devil of this browser's own at the crosshair for 60 s (local: nobody else sees it). */
  devil?: boolean;
  /** Draw the gust function through the game's own programs against its processor copy, and a planting through the plain sway and the trees' form at art nought. */
  selfTest?: boolean;
}

/** What the game hands the console. */
export interface WindDebugContext {
  weather(): { windHeading: number; windSpeed: number; windMean: number; windVeer: number; level: number; scheduled: number; enabled: boolean; reason: string | null };
  sheets(): { bottom: number | null; top: number | null; veer: number } | null;
  player(): { x: number; z: number } | null;
  crosshair(): { x: number; z: number } | null;
  /** The air's devils handed this frame, and why the air takes none (null when it can). */
  air(): { handed: number; why: string | null };
  /** The trees' form in force (chosen at the last arrival), and its counts. */
  trees(): Record<string, unknown>;
  /** The self test's run, or null where there is no renderer. */
  selfTest(): Promise<Record<string, unknown>> | Record<string, unknown> | null;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const deg = (rad: number): number => Math.round(((((rad * 180) / Math.PI) % 360) + 360) % 360);

function profileWords(p: WindProfile): Record<string, number> {
  return { floor: r3(p.floor), scale: r3(p.scale), gust: r3(p.gust), cover: r3(p.cover), size: r3(p.size), stretch: r3(p.stretch), veer: r3(p.veer), wander: r3(p.wander), devils: r3(p.devils), trees: r3(p.trees) };
}

/** `__debug.wind(o)`: `null` or `{ hold: false }` lets go; anything else as its fields say; with none, the report. */
export function windDebug(o: WindDebugOptions | null | undefined, ctx: WindDebugContext): Record<string, unknown> | Promise<Record<string, unknown>> {
  const notes: string[] = [];
  if (o === null || o?.hold === false) {
    const had = windHeld();
    releaseWind();
    if (had) notes.push(WIND_STATE.on ? "the wind given back to the weather: the gusts snap back to the shared pattern every player sees" : "the wind given back to the weather");
    return { ...report(ctx), notes };
  }
  if (o) {
    if (o.speed !== undefined || o.heading !== undefined || o.gust !== undefined) {
      const sp = o.speed === undefined ? undefined : o.speed === null || !(o.speed >= 0) ? null : o.speed;
      const hd = o.heading === undefined ? undefined : o.heading === null || !Number.isFinite(o.heading) ? null : (o.heading * Math.PI) / 180;
      const gu = o.gust === undefined ? undefined : o.gust === null || !(o.gust >= 0) ? null : o.gust;
      notes.push(...holdWind({ speed: sp, heading: hd, gust: gu }));
      if (windHeld()) notes.push('held in this browser alone; wind(null) gives it back to the weather');
    }
    if (o.tune) {
      notes.push(...tuneWind(o.tune).notes);
      if (o.now) remakeWindTableNow();
    }
    if (o.devil) {
      const at = ctx.crosshair() ?? ctx.player();
      if (!at) notes.push('no devil: nowhere to stand it');
      else {
        standLocalDevil(at.x, at.z, WIND_FRAME.t, 60);
        notes.push(`a devil of this browser's own at (${Math.round(at.x)}, ${Math.round(at.z)}) for 60 s: local, nobody else sees it${WIND_STATE.on ? '' : ' (the unified wind is off, so nothing draws it: ' + WIND_STATE.why + ')'}`);
      }
    }
    if (o.at) {
      const [x, z] = o.at;
      const t = o.t ?? WIND_FRAME.t;
      const p = windAtPoint(x, z, t);
      if (!p) return { notes: ['no world: the wind comes with one'] };
      return { at: [x, z], t, k: p.k, veer: p.veer, patch: p.patch, mean: p.mean, speed: p.speed, heading: p.heading, notes: ["a pack built afresh for that moment from the world, the shared clock and the weather level held (a force, or the Weather setting off), never this browser's own hold: two tabs at the same t, place and level give the same numbers"] };
    }
    if (o.selfTest) {
      const run = ctx.selfTest();
      if (!run) return { notes: ['no renderer'] };
      return Promise.resolve(run).then((r) => ({ ...r, notes }));
    }
  }
  return { ...report(ctx), notes };
}

function report(ctx: WindDebugContext): Record<string, unknown> {
  const w = ctx.weather();
  const p = windPattern();
  const id = windWorldId();
  const table = windWorldTable();
  const pl = ctx.player();
  const out: Record<string, unknown> = {
    on: WIND_STATE.on,
    why: WIND_STATE.on ? null : WIND_STATE.why,
    hold: { speed: WIND_HOLD.speed, heading: WIND_HOLD.heading === null ? null : deg(WIND_HOLD.heading), gust: WIND_HOLD.gust, held: windHeld() },
    here: { heading: deg(w.windHeading), speed: r3(w.windSpeed), mean: r3(w.windMean), veer: r3(w.windVeer), k: WIND_STATE.on ? r3(WIND_FRAME.k) : 1, patch: WIND_STATE.on ? r3(WIND_FRAME.p) : 0 },
    weather: { level: r3(w.level), scheduled: w.scheduled, enabled: w.enabled, reason: w.reason },
    sheets: ctx.sheets(),
    world: id,
  };
  if (!WIND_STATE.on) {
    out.notes2 = ["with the unified wind off the wind is today's one wind for the whole world; the hold works either way"];
  }
  if (p) {
    const obs = windObserver();
    // The shared heading's parts at this frame's moment: the slow walk and, under the arm, the weather's wobble about it.
    p.headingAtIn(WIND_FRAME.t);
    out.travel = { speed: r3(p.travelSpeed), heading: deg(p.heading), walk: deg(p.hw), wobble: r3(p.hd - p.hw) };
    out.blend = windBlendNow();
    out.profile = profileWords(obs);
    out.worldProfile = profileWords(p.worldProfileAt(w.level));
    out.phases = [0, 1].map((ph) => ({ age: r3(p.ages[ph]), cover: r3(p.covers[ph]) }));
    out.strengths = { mean: r3(p.mean), gust: r3(p.gustStrength), veer: r3(p.veer), trees: r3(p.trees) };
    out.stepsWorked = p.stepsWorked;
    p.stepsWorked = 0;
    const devils: Record<string, unknown>[] = [];
    for (let i = 0; i < p.devilCount; i++) {
      const o = i * DEVIL_W;
      devils.push({ x: Math.round(p.devils[o]), z: Math.round(p.devils[o + 1]), age: r3(p.devils[o + 12]), core: r3(p.devils[o + 4]), swirl: r3(p.devils[o + 5]), from: pl ? Math.round(Math.hypot(p.devils[o] - pl.x, p.devils[o + 1] - pl.z)) : null });
    }
    out.devils = { near: devils, rate: r3(p.devilRate), tests: p.devilTests, day: WIND_DAY.shared ? "the shared day's (a server)" : 'the visible day (no server)', dayNow: r3(WIND_DAY.now), local: WIND_LOCAL_DEVIL.until > WIND_FRAME.t ? { x: Math.round(WIND_LOCAL_DEVIL.x), z: Math.round(WIND_LOCAL_DEVIL.z) } : null, air: ctx.air() };
    if (pl) out.readouts = windReadouts(pl.x, pl.z);
  }
  if (id) {
    const e = windWorldOf(id.planetId);
    out.worldMultipliers = { floor: e.floor, gust: e.gust, cover: e.cover, size: e.size, wander: e.wander, devils: e.devils, atLevel: e.byLevel[Math.max(0, Math.min(4, Math.round(w.level)))] };
  }
  if (table) {
    out.worldLevels = Array.from(table.speeds).map((s, l) => ({ level: l, speed: s, kinds: worldKindsAt(l) }));
  }
  out.table = windTableState();
  out.trees = ctx.trees();
  out.kinds = WIND_KINDS;
  out.aloft = { ...WIND_TUNE.aloft };
  return out;
}
