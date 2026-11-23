// Which applied system a world follows and the world's own day under it (the GPU port's pass 2, wave 5, maker S; the
// owner's answer 1 of 21 November: "one steady spin per world, night as long as day"). The small half of
// `skyMotion.ts` the server reads as well (`server/clock.mjs`'s `worldDayTable`, `server/storyWorlds.mjs`'s hour), so a
// browser's sky, the server's day and the story's hour are one sum of one clock. Pure: nothing but `system.js`, which is
// pure; node and the server run it as it stands.
//
// A world's day under its system is one steady turn every `dayHours` (2 to 6 real hours), its hour `frac(now / length +
// phase)` of the shared clock with the phase its longitude and the system's epoch (`system.js`' `localHour`, the very sum),
// and no anchor: an admin's change of the game's day length while the server runs is the day of the worlds no system
// holds, never a system's. A world no applied system holds keeps the game's own day exactly.

import { cleanSystem, groundOf, EPOCH_MS } from './system.js';

/** A system as the file keeps it (plain numbers and names). */
export type SystemsRecord = Record<string, unknown>;

/** A world's own day: its length in real seconds, its place in the shared day (unwrapped), its longitude's turn and its length in real days. */
export interface WorldDay {
  lengthSeconds: number;
  phase: number;
  lonTurn: number;
  dayDays: number;
}

/**
 * Which applied system a world follows, from the bodies file's `systems` (Save to game writes the applied ones alone: a star
 * system by its id, a first-round one-world sky as `v1:<world>`): the star system of version 2 whose grounds hold the world
 * (a copied sky, Otoh Gunga's, by its world), else the world's applied first-round sky, else none (SWG's sky, today's day).
 * The viewer's `skyRuleFor` order. Answers the cleaned system and its key.
 */
export function appliedSystemOf(systems: SystemsRecord | null | undefined, world: string): { rule: 'system' | 'one-world'; id: string; sys: Record<string, unknown> } | null {
  if (!systems || typeof systems !== 'object' || !world) return null;
  for (const [id, raw] of Object.entries(systems)) {
    if (id.startsWith('v1:')) continue;
    const sys = cleanSystem(raw) as Record<string, unknown> | null;
    if (!sys || sys.version !== 2 || (sys as { future?: boolean }).future) continue;
    if ((sys.grounds as { world: string }[]).some((g) => g.world === world) && groundOf(sys, world)) return { rule: 'system', id, sys };
  }
  const one = (systems as Record<string, unknown>)['v1:' + world];
  if (one) {
    const sys = cleanSystem(one) as Record<string, unknown> | null;
    if (sys && sys.version === 1) return { rule: 'one-world', id: 'v1:' + world, sys };
  }
  return null;
}

/**
 * A world's own day under its applied star system (version 2): its length in real seconds (`dayHours` of it), its place in
 * the shared day as `DayCycle.phase` reads it (unwrapped: the day count `now / length + phase` is then the world's own count
 * since the system's epoch with its longitude, so the sky's time follows from it exactly), and the longitude's share of a
 * turn. Null for a world the system does not stand on.
 */
export function worldDayOf(sys: Record<string, unknown>, world: string): WorldDay | null {
  const g = groundOf(sys, world) as { dayHours: number; lon: number } | null;
  if (!g || !(g.dayHours > 0)) return null;
  const lengthSeconds = g.dayHours * 3600;
  const lonTurn = g.lon / 360;
  return { lengthSeconds, phase: lonTurn - EPOCH_MS / (lengthSeconds * 1000), lonTurn, dayDays: g.dayHours / 24 };
}

/**
 * The hour (0 to 24, 12 the sun's highest at the equator) of a world under its system at a shared-clock moment `nowMs`: the
 * server's and the story's hour, the very sum `DayCycle` makes of the same clock (`frac(now / length + phase)`).
 */
export function worldHourAt(day: { lengthSeconds: number; phase: number }, nowMs: number): number {
  const t = nowMs / 1000 / day.lengthSeconds + day.phase;
  return 24 * (t - Math.floor(t));
}

/**
 * The server's table of the worlds that keep their own day, as its hail gave it (`server/clock.mjs`' `WorldDays.hand`: each
 * world's length in ms and its phase), or null with no server or none told: what the console holds this browser's day to
 * (`__debug.sky({ motion: true })`'s `server`). The browser's own day is always its own file's.
 */
export const SERVER_WORLD_DAYS: { table: Record<string, { lengthSeconds: number; phase: number }> | null } = { table: null };

/** The hail's `days` taken (anything that is not a world's length and phase dropped). */
export function takeServerDays(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    SERVER_WORLD_DAYS.table = null;
    return;
  }
  const out: Record<string, { lengthSeconds: number; phase: number }> = {};
  for (const [w, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.length < 2) continue;
    const ms = Number(v[0]);
    const phase = Number(v[1]);
    if (ms > 0 && Number.isFinite(phase)) out[w] = { lengthSeconds: ms / 1000, phase };
  }
  SERVER_WORLD_DAYS.table = out;
}

/** Every ground world each applied star system stands on, with its own day (the server's table). */
export function worldDaysOf(systems: SystemsRecord | null | undefined): Record<string, WorldDay & { system: string }> {
  const out: Record<string, WorldDay & { system: string }> = {};
  if (!systems || typeof systems !== 'object') return out;
  for (const [id, raw] of Object.entries(systems)) {
    if (id.startsWith('v1:')) continue;
    const sys = cleanSystem(raw) as Record<string, unknown> | null;
    if (!sys || sys.version !== 2 || (sys as { future?: boolean }).future) continue;
    for (const g of sys.grounds as { world: string }[]) {
      if (out[g.world]) continue;
      const d = worldDayOf(sys, g.world);
      if (d) out[g.world] = { ...d, system: id };
    }
  }
  return out;
}
