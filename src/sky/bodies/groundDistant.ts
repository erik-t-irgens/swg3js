// A ground world's distant appearances (the GPU port's pass 2, wave 4b, maker B; the sky sweep's find): Mustafar's four
// distant volcano plumes, which its environment file names (`DIST`, converted into the world's `sky.json` as `distant`, each
// effect converted into the pack since this wave) and nothing drew. Stood through wave 3's way for Kessel's Maw
// (`src/space/distant.ts`'s `DistantSet`: prepared behind the loading screen, so the warm-up builds them, and placed once),
// with the plan made here from the ground file's own frame. Pure: no three, no page.
//
// The ground file's frame is small: Mustafar's four stand at (-18, 0, 60.4), (26.8, 0, 18), (-18, 0, -24.4) and (-60.4, 0,
// 18), a cross round (-18, 18), each turned to face its middle (0, 90, 180 and -90 degrees), and each effect's own emitters
// stand some tens of units apart and a few up: a scene laid out at a scale of its own, not in metres. Read so, the cross's
// middle times 160 is Mustafar's playable middle (its map's centre, -2880, 2976 in the client's frame) and its arms 6.8 km,
// past the map's edge: the volcanoes on the horizon round the mining fields. That reading is ours (nothing in the client's
// data says the scale), so it is a dial.
import type { DistantSystem } from '../../space/spaceData.ts';

/**
 * The dials (feel and reading the owner's; spent at the next loading screen, where the plumes are placed):
 *   - `scale` 160: metres a unit of the file's frame stands for, places and the effects' own size alike (above: the cross's
 *     middle on the playable middle, its arms past the map's edge).
 *   - `keepWithin` 24000 m: how far off a plume is kept running and drawn (the game's effects sleep 200 m out times their
 *     reach): the far side of the cross from the far corner of the map.
 *   - `on` true: drawn at all.
 */
export const PLUME_TUNE = { scale: 160, keepWithin: 24000, on: true };

/** A ground distant entry as the converter writes it (`exportSky`'s `distant`, the ground's `DIST`). */
export interface GroundDistantEntry {
  appearance?: unknown;
  direction?: unknown;
  orientation?: unknown;
  infinite?: unknown;
  planet?: unknown;
  file?: unknown;
}

const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * A turn of yaw, pitch and roll (degrees, `Ry Rx Rz` about the object's own axes, the order `distantBasis` in the converter
 * reads a space terrain's by) in the client's frame, mirrored once into the game's (an entry with one index on X changes
 * sign), as nine numbers by rows.
 */
export function groundBasis(yawDeg: number, pitchDeg: number, rollDeg: number): number[] {
  const r = Math.PI / 180;
  const cy = Math.cos(yawDeg * r);
  const sy = Math.sin(yawDeg * r);
  const cp = Math.cos(pitchDeg * r);
  const sp = Math.sin(pitchDeg * r);
  const cr = Math.cos(rollDeg * r);
  const sr = Math.sin(rollDeg * r);
  const a = [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ];
  const m = a.map((row) => [row[0] * cr + row[1] * sr, -row[0] * sr + row[1] * cr, row[2]]);
  const s = [-1, 1, 1];
  const out: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push(Math.round(s[i] * s[j] * m[i][j] * 1e6) / 1e6 + 0);
  return out;
}

/**
 * A world's ground distant appearances as `DistantSet` places them: each whose effect converted, standing in the world (the
 * ground file's own byte says none ride with the camera) at its place in the file's frame times `scale`, put into the game's
 * frame about the layout's centre (`centre`, the client's frame: the game's x is the centre's less the client's, its z the
 * client's less the centre's), turned by its file's yaw, pitch and roll. A sky planet (`PLAN`) is the sky's, never here.
 */
export function groundDistantOf(list: readonly GroundDistantEntry[] | null | undefined, centre: { x: number; z: number } | null, tune: typeof PLUME_TUNE = PLUME_TUNE): DistantSystem[] {
  const out: DistantSystem[] = [];
  if (!Array.isArray(list) || !centre || !tune.on) return out;
  const k = tune.scale > 0 && Number.isFinite(tune.scale) ? tune.scale : 1;
  for (const e of list) {
    if (!e || typeof e !== 'object' || e.planet === true) continue;
    const file = typeof e.file === 'string' && e.file ? e.file : null;
    if (!file || !finite3(e.direction)) continue;
    const o = finite3(e.orientation) ? e.orientation : [0, 0, 0];
    const d = e.direction;
    const r4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;
    out.push({
      appearance: typeof e.appearance === 'string' ? e.appearance : '',
      file,
      at: [r4(centre.x - d[0] * k), r4(d[1] * k), r4(d[2] * k - centre.z)],
      turn: { yaw: o[0], pitch: o[1], roll: o[2] },
      basis: groundBasis(o[0], o[1], o[2]),
      infinite: false,
      kind: 'feature',
      radius: null,
    });
  }
  return out;
}

/** The handle's reach for `keepWithin` (the game's effects sleep 200 m out times it). */
export function plumeReach(tune: typeof PLUME_TUNE = PLUME_TUNE): number {
  return Math.max(1, tune.keepWithin / 200);
}

/** What the console reads of the world's placed set (`DistantSet`'s own report and its show switch). */
export interface PlumeSet {
  report(): Record<string, unknown>;
  retune(): void;
}

/** The world's set while there is one, for the console (`installPlumeDebug`). */
let CURRENT: PlumeSet | null = null;
/** The switch `retune` reads (the space dials' `on`), handed in so this file reaches nothing of space's but its type. */
let ONSWITCH: { on: boolean } | null = null;

/** The world's placed set (null when it goes), and the switch its `retune` reads. */
export function setPlumesCurrent(set: PlumeSet | null, onSwitch: { on: boolean } | null): void {
  CURRENT = set;
  ONSWITCH = onSwitch;
}

/**
 * `__debug.plumes()`: what a ground world's distant appearances stand as (each one's place, turn and size), the dials and the
 * line that keeps them; `plumes({ show: false })` takes the placed effects out and `{ show: true }` stands them again from what
 * was prepared (the prover's A/B on one screen: nothing built); `{ scale, keepWithin, on }` move the dials, spent at the next
 * loading screen. WebGPU's alone (nothing is placed on WebGL).
 */
function plumesHook(o?: Record<string, unknown>): Record<string, unknown> {
  const said: string[] = [];
  if (o && typeof o === 'object') {
    for (const k of ['scale', 'keepWithin'] as const) {
      const v = o[k];
      if (v === undefined) continue;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        PLUME_TUNE[k] = v;
        said.push(`${k}: at the next loading screen`);
      } else said.push(`${k}: a number over nought`);
    }
    if (typeof o.on === 'boolean') {
      PLUME_TUNE.on = o.on;
      said.push('on: at the next loading screen');
    }
    if (typeof o.show === 'boolean' && CURRENT && ONSWITCH) {
      const was = ONSWITCH.on;
      ONSWITCH.on = o.show;
      CURRENT.retune();
      ONSWITCH.on = was;
    }
  }
  return {
    ...(said.length ? { said } : {}),
    ...(CURRENT ? CURRENT.report() : { systems: [], note: "no ground distant appearances here: a world whose sky names some (Mustafar's plumes), converted by the sky command since pass 2, wave 4b, on WebGPU" }),
    tune: { ...PLUME_TUNE },
    line: `__debug.plumes(${JSON.stringify(PLUME_TUNE)})`,
  };
}

/** Put the hook on `__debug` unless it is there (run at each world's load, as the space zones' `distant` hook is). */
export function installPlumeDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.plumes !== plumesHook) debug.plumes = plumesHook;
}
