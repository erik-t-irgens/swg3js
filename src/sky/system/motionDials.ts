// The skies in motion's dials and console (the GPU port's pass 2, wave 5, maker S): `skyMotion.ts`' `MOTION_TUNE` on sliders
// in the debug menu when `sky` is picked (the sky's own set, `SKY_DIAL_GROUPS`), each set through `tuneMotion`, exactly as
// `__debug.sky({ motion: { giantshine, tint, eclipse } })` sets it, so the menu's copied line is that helper's own argument;
// `__debug.sky({ motion: true })` says the followed system now (its day, every body's place, phase and cover, the night
// light), and `__debug.sky('dawn' | 'noon' | 'dusk' | 'night')` under a system's own day puts the hour where its sun really
// stands (`motionHourTime`). Feel and look are the owner's: each dial starts where `skyMotion.ts` says, with its reason.
//
// Pure: no three, no DOM; a node test moves every dial through the real table.
import type { DialGroup, NumberDial } from '../../ui/dials.ts';
import { SKY_DIAL_GROUPS } from '../skyDials.ts';
import { MOTION_RANGE, MOTION_TUNE, type SkyMotion } from './skyMotion.ts';
import { worldHourAt } from './worldDays.ts';

type Key = keyof typeof MOTION_TUNE;

/** Set the motion's dials from the console's argument (`{ giantshine, tint, eclipse }`): each held to its range, words for what was held or refused. */
export function tuneMotion(o: unknown): string[] {
  const said: string[] = [];
  if (!o || typeof o !== 'object') return said;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const r = (MOTION_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`motion.${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`motion.${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`motion.${k}: held to ${held}`);
    MOTION_TUNE[k as Key] = held;
  }
  return said;
}

function dial(k: Key, label: string, step: number, note: string): NumberDial {
  const r = MOTION_RANGE[k];
  return { kind: 'number', key: `motion.${k}`, label, note, min: r[0], max: r[1], step, unit: '', get: () => MOTION_TUNE[k], set: (v) => tuneMotion({ [k]: v }) };
}

/** The motion's group of the sky's dials. */
export function motionDialGroup(): DialGroup {
  return {
    title: 'Skies in motion (an applied star system)',
    note: "Only a world whose star system the viewer's Apply and Save to game applied: its bodies' night light and its eclipses.",
    dials: [
      dial('giantshine', 'Giantshine', 0.05, "A giant's light at night (Yavin Prime over Yavin 4) as a share of what its lit area against the world's own moon gives: 1 lights it by the very rule a moon's light follows; 0 leaves the night to the moons."),
      dial('tint', 'Night light in the bodies\' colour', 0.05, "How much of a body's own colour its night light takes: 0 white, as SWG's moon is; 1 its colour at full (Yavin Prime's orange)."),
      dial('eclipse', 'Eclipses', 0.05, "How much of a covered sun's light an eclipse takes: 1 all of the covered share, as it is drawn; 0 none."),
    ],
  };
}

SKY_DIAL_GROUPS.push(motionDialGroup);

/** The four hours of `__debug.sky` under a system's own day. */
export type MotionHour = 'dawn' | 'noon' | 'dusk' | 'night';

/**
 * The day's time (0 midnight, 0.5 noon) at which an hour stands under a system's own day (version 2): noon and midnight at
 * the meridian (the hours 12 and 0, the sun's highest and lowest), dawn and dusk where the casting sun stands `lowDeg` over the
 * horizon rising and setting, found by halving over the motion itself in the day whose count is `count`. NaN for a motion
 * that keeps the game's day (version 1), whose hours are the game's path's. Moves the motion (a console's call, never a
 * frame's): its next `at` puts it back.
 */
export function motionHourTime(m: SkyMotion, hour: MotionHour, count: number, lowDeg: number): number {
  if (!m.ownsDay) return Number.NaN;
  if (hour === 'noon') return 0.5;
  if (hour === 'night') return 0;
  const target = Math.sin((lowDeg * Math.PI) / 180);
  const base = Math.floor(count);
  const rec = { count: base };
  const up = (t: number): number => {
    rec.count = base + t;
    m.at(rec);
    return m.sun.y;
  };
  const rising = hour === 'dawn';
  let lo = rising ? 0 : 0.5;
  let hi = rising ? 0.5 : 1;
  // A sun that never climbs so high, or never sinks so low, this day: the quarter day stands for it.
  if (rising ? up(hi) < target : up(lo) < target) return rising ? 0.25 : 0.75;
  if (rising ? up(lo) >= target : up(hi) >= target) return rising ? 0.25 : 0.75;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    const y = up(mid);
    if (y < target === rising) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * What the server's day says of this world against this browser's (the hail's table, `SERVER_WORLD_DAYS`): the server's hour of
 * it at the shared clock's `nowMs`, this browser's (`dayTime`, the day's time), and whether the two days are one (the same
 * length and phase). Null with no server's table.
 */
export function serverDayWord(m: SkyMotion | null, world: string, table: Record<string, { lengthSeconds: number; phase: number }> | null, nowMs: number, dayTime: number): Record<string, unknown> | null {
  if (!table) return null;
  const s = table[world] ?? null;
  const hour = Number((dayTime * 24).toFixed(4));
  if (!s) return { world, keeps: "the game's own day", ours: m && m.ownsDay ? 'its own (the server has no word of it: another bodies file?)' : "the game's own", hour };
  const same = !!m && m.ownsDay && m.lengthSeconds === s.lengthSeconds && m.phase === s.phase;
  return { world, keeps: `its own of ${(s.lengthSeconds / 3600).toFixed(3)} h`, serverHour: Number(worldHourAt(s, nowMs).toFixed(4)), hour, sameDay: same };
}

/** `__debug.sky({ motion })`: `true` says the motion now; a record moves its dials first. */
export function motionConsole(arg: unknown, m: SkyMotion | null): Record<string, unknown> {
  const said = arg && typeof arg === 'object' ? tuneMotion(arg) : [];
  return {
    ...(said.length ? { said } : {}),
    motion: m ? m.report() : 'none: this world follows no applied star system (SWG\'s sky, the game\'s own day), or the renderer is WebGL',
    tune: { ...MOTION_TUNE },
  };
}
