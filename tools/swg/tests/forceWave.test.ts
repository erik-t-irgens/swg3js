// The Force's knock that travels (src/combat/forceWave.ts, forceWaveKnock.ts, forceWaveTune.ts; the volumetrics pass's
// third wave, the owner's answer of 2026-10-24 to the design's Q16: "Let's make it both, and we can dial the speed of
// them"), driven through the real `WaveKnock.step` the jedi kit calls every frame a wave runs, over stand-in bodies,
// vehicles and a player: a body 12 m out is knocked once, as the air's own front reaches it, alike at 30, 60 and 144
// frames a second, one near at hand first; one that steps out of the cone before the front arrives is missed, and one
// behind the player is missed by a push and reached by a repulse; a body past a power's reach is never reached; a pull
// reaches from its far end in and closes on whoever it never crossed; the player, a dead body and the vehicle ridden are
// never knocked; the knock's arithmetic is the instant knock's, measured from the wave's own origin at the moment it
// lands; the speed dial both the knock and the air's front read moves them together; the switch off is the instant knock
// of the commit before the wave, to the line (read out of git); and nothing of it reads a graphics setting, so the knock
// is the same with the volumetrics master off or on. **This changes how the Force plays for everyone**; the Gameplay
// page's switch puts it back.
//
// Plain type stripping; it reads the commit before the wave out of git for jedi.ts as it stood.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ForceWaves, WAVE_MOST } from '../../../src/combat/forceWave.ts';
import { WaveKnock, type WaveContext, type WaveVehicle } from '../../../src/combat/forceWaveKnock.ts';
import { FORCE_WAVE, FORCE_WAVE_SPEED, setForceWave } from '../../../src/combat/forceWaveTune.ts';
import { STRIKE, type StrikeKind } from '../../../src/combat/strikeTag.ts';
import type { Living } from '../../../src/combat/kit.ts';
import { FRONT_KIND, frontRadiusIn, frontTime, newFrontAt } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { VOL_TUNE } from '../../../src/world/volumetrics/volSettings.ts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.ts';
import { GAMEPLAY } from '../../../src/ui/gameplayPage.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const src = (p: string): string => readFileSync(join(REPO, 'src', p), 'utf8').replace(/\r\n/g, '\n');
/** The wave before this one (wave 2b's commit): what the switch off must still be. */
const PRE_WAVE = 'caad313';
const showAt = (rev: string, path: string): string => execFileSync('git', ['-C', REPO, 'show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\r\n/g, '\n');
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** When the air's own front stands at `d` metres (outward) or comes in to it (a pull), stepped finely: the truth. */
function frontArrives(kind: number, reach: number, d: number): number {
  const fa = newFrontAt();
  fa.kind = kind;
  fa.reach = reach;
  const T = frontTime(kind);
  const n = 200_000;
  for (let i = 0; i <= n; i++) {
    fa.age = (i / n) * T;
    frontRadiusIn(fa);
    if (kind === FRONT_KIND.pull ? fa.r <= d : fa.r >= d) return fa.age;
  }
  return T;
}

/** The step's clock, which the stand-ins stamp what reaches them with. */
let now = 0;

/** A body the knock can reach: every blow and every knock it takes recorded, with the moment and the kind of blow. */
interface Body extends Living {
  knocks: { t: number; power: number; dir: [number, number, number] }[];
  hurt: { t: number; amount: number; kind: StrikeKind | null; from: [number, number, number] | null }[];
}
function body(x: number, y: number, z: number): Body {
  const b: Body = {
    key: 9,
    label: 'a stand-in',
    side: 'wild',
    aggression: 'passive',
    pos: new THREE.Vector3(x, y, z),
    halfHeight: 0.9,
    dead: false,
    radiusToward: () => 0.4,
    knocks: [],
    hurt: [],
    damage(amount: number, from?: THREE.Vector3): void {
      b.hurt.push({ t: now, amount, kind: STRIKE.kind, from: from ? [from.x, from.y, from.z] : null });
    },
    knock(dir: THREE.Vector3, power: number): void {
      b.knocks.push({ t: now, power, dir: [dir.x, dir.y, dir.z] });
    },
  };
  return b;
}

/** A vehicle the knock can reach: its impulses recorded. */
interface Veh extends WaveVehicle {
  impulses: { t: number; x: number; y: number; z: number }[];
}
function vehicle(x: number, y: number, z: number, mass = 200): Veh {
  const v: Veh = {
    pos: new THREE.Vector3(x, y, z),
    impulses: [],
    body: {
      mass: () => mass,
      applyImpulse(i: { x: number; y: number; z: number }): void {
        v.impulses.push({ t: now, x: i.x, y: i.y, z: i.z });
      },
    },
  };
  return v;
}

interface Scene {
  bodies?: Body[];
  vehicles?: Veh[];
  /** The vehicle the player rides (never knocked). */
  mounted?: Veh | null;
  /** Where the wave begins (the player's place), and the way it is aimed. */
  origin?: [number, number, number];
  aim?: [number, number, number];
  reach?: number;
  /** Moves the bodies at the frame's moment, before the step. */
  move?: (t: number) => void;
}

/**
 * A wave of `kind` begun at the scene's origin and stepped through the real `WaveKnock.step` at `fps`, as the jedi kit
 * steps it (only while a wave runs), the player's own record among the targets as the world lists it. Answers the player.
 */
function run(kind: number, fps: number, s: Scene): Body {
  now = 0;
  const knock = new WaveKnock(new ForceWaves());
  const o = s.origin ?? [0, 0, 0];
  const a = s.aim ?? [1, 0, 0];
  const reach = s.reach ?? (kind === FRONT_KIND.repulse ? 10 : 16);
  knock.waves.begin(kind, o[0], o[1], o[2], o[0], o[1], o[2], a[0], a[1], a[2], reach);
  const player = body(o[0], o[1], o[2]);
  const bodies = s.bodies ?? [];
  const vehicles = [...(s.vehicles ?? []), ...(s.mounted ? [s.mounted] : [])];
  const dt = 1 / fps;
  const ctx: WaveContext = {
    dt,
    world: { targets: () => [player, ...bodies], playerTarget: player, vehicles },
    player: { mounted: s.mounted ?? null, aboard: null },
  };
  for (let f = 1; f <= fps * 6 && knock.waves.waves.length > 0; f++) {
    now = f * dt;
    s.move?.(now);
    knock.step(ctx);
  }
  return player;
}

/** When `b` was first knocked, or null. */
const firstKnock = (b: Body): number | null => (b.knocks.length ? b.knocks[0].t : null);

// --- the defaults: the knock travels, at the air's own speed ---
ok(DEFAULT_SETTINGS.forceKnockTravels === true && DEFAULT_SETTINGS.forceWaveSpeed === 1 && FORCE_WAVE.travels === true && FORCE_WAVE.speed === 1, 'the knock travels by default, at the air\'s own speed (1)');
{
  const fighting = GAMEPLAY.find((g) => g.title === 'Fighting')!;
  const sw = fighting.knobs.find((k) => k.key === 'forceKnockTravels');
  const sp = fighting.knobs.find((k) => k.key === 'forceWaveSpeed');
  ok(!!sw && sw.kind === 'toggle' && !!sp && sp.kind === 'range' && sp.min === FORCE_WAVE_SPEED.min && sp.max === FORCE_WAVE_SPEED.max && !!sp.requires?.includes('forceKnockTravels'), "the Gameplay page has the switch and the speed, the speed's ends the console's and greyed under the switch");
}

// --- a body 12 m out is knocked once, as the front reaches it, alike at 30, 60 and 144 frames a second ---
for (const [name, kind, reach] of [
  ['push', FRONT_KIND.push, 16],
  ['repulse', FRONT_KIND.repulse, 10],
] as const) {
  const d = kind === FRONT_KIND.repulse ? 8 : 12;
  const truth = frontArrives(kind, reach, d);
  const near0 = frontArrives(kind, reach, 2.5);
  for (const fps of [30, 60, 144]) {
    const far = body(d, 0, 0);
    const close = body(2.5, 0, 0);
    const player = run(kind, fps, { bodies: [far, close] });
    const t = firstKnock(far);
    const t2 = firstKnock(close);
    ok(t !== null && t >= truth - 1e-9 && t - truth <= 1 / fps + 1e-9, `${name} at ${fps} fps: a body ${d} m out is knocked at ${t?.toFixed(3)} s, the frame the air's front reaches it (${truth.toFixed(3)} s)`);
    ok(t2 !== null && t !== null && t2 < t && t2 - near0 <= 1 / fps + 1e-9, `${name} at ${fps} fps: and one at 2.5 m first (${t2?.toFixed(3)} s)`);
    ok(far.knocks.length === 1 && far.hurt.length === 1 && close.knocks.length === 1 && close.hurt.length === 1, `${name} at ${fps} fps: each knocked and struck once, however many steps it stands in the front's band`);
    ok(player.knocks.length === 0 && player.hurt.length === 0, `${name} at ${fps} fps: the player's own record is never knocked`);
  }
}

// --- the knock's own arithmetic, at the moment it lands, from the wave's own origin ---
{
  const origin: [number, number, number] = [5, 0, -3];
  for (const [name, kind] of [
    ['push', FRONT_KIND.push],
    ['pull', FRONT_KIND.pull],
    ['repulse', FRONT_KIND.repulse],
  ] as const) {
    const b = body(origin[0] + 6, origin[1], origin[2] + 2);
    const v = vehicle(origin[0] + 7, origin[1], origin[2] - 1, 300);
    run(kind, 60, { bodies: [b], vehicles: [v], origin });
    const d = Math.hypot(6, 2);
    const dv = Math.hypot(7, 1);
    const k = b.knocks[0];
    const h = b.hurt[0];
    const sign = kind === FRONT_KIND.pull ? -1 : 1;
    const wantPower = kind === FRONT_KIND.repulse ? 26 * (1 - d / 12) + 8 : sign > 0 ? 22 * (1 - d / 18) + 6 : 4 + d * 1.1;
    const wantDamage = kind === FRONT_KIND.repulse ? 25 * (1 - d / 12) + 5 : sign > 0 ? 10 : 4;
    const dir = [(6 / d) * sign, 0, (2 / d) * sign];
    ok(!!k && near(k.power, wantPower, 1e-9) && near(k.dir[0], dir[0], 1e-9) && near(k.dir[2], dir[2], 1e-9) && k.dir[1] === 0, `${name}: the knock is the instant knock's speed by the distance (${k?.power.toFixed(3)} m/s at ${d.toFixed(2)} m) along the way from the wave's own origin`);
    ok(!!h && near(h.amount, wantDamage, 1e-9) && h.kind === 'force' && h.from !== null && h.from[0] === origin[0] && h.from[2] === origin[2], `${name}: and the blow the instant one's (${h?.amount.toFixed(3)}), struck as the Force, from where the wave began`);
    const im = v.impulses[0];
    const m = 300;
    const want = kind === FRONT_KIND.repulse ? { x: (7 / dv) * m * 10 * (1 - dv / 12), y: m * 5 } : { x: (7 / dv) * sign * m * 9 * (1 - dv / 14), y: m * 4 };
    ok(v.impulses.length === 1 && !!im && near(im.x, want.x, 1e-6) && near(im.y, want.y, 1e-9), `${name}: a vehicle in reach shoved once by the instant knock's impulse (${im?.x.toFixed(1)}, ${im?.y.toFixed(1)})`);
  }
}

// --- the cone, the reach, the dead and the vehicle ridden ---
{
  for (const fps of [30, 60, 144]) {
    const behind = body(-8, 0, 0);
    const past = body(17, 0, 0);
    const dead = body(6, 0, 0);
    dead.dead = true;
    const vPast = vehicle(13, 0, 0);
    const ridden = vehicle(1, 0, 0);
    run(FRONT_KIND.push, fps, { bodies: [behind, past, dead], vehicles: [vPast], mounted: ridden });
    ok(behind.knocks.length === 0 && past.knocks.length === 0 && dead.knocks.length === 0 && dead.hurt.length === 0, `push at ${fps} fps: a body behind the player, one past its 16 m reach and a dead one are never knocked`);
    ok(vPast.impulses.length === 0 && ridden.impulses.length === 0, `push at ${fps} fps: nor a vehicle past its 12 m, nor the one the player rides`);
    const behindR = body(-8, 0, 0);
    run(FRONT_KIND.repulse, fps, { bodies: [behindR] });
    ok(behindR.knocks.length === 1, `repulse at ${fps} fps: the ring reaches all round, behind the player too`);
  }
}

// --- one that steps out of the cone before the front arrives is missed; one that steps in after it has passed too ---
{
  const truth = frontArrives(FRONT_KIND.push, 16, 12);
  for (const fps of [30, 60, 144]) {
    // At 12 m straight ahead, then sidestepping out of the cone (a dot under 0.35) a third of the way to the front's arrival.
    const missed = body(12, 0, 0);
    run(FRONT_KIND.push, fps, {
      bodies: [missed],
      move: (t) => {
        if (t > truth / 3) missed.pos.set(4, 0, 11.5);
      },
    });
    ok(missed.knocks.length === 0, `${fps} fps: a body that steps out of the push's cone before its front arrives is never knocked`);
    const stays = body(12, 0, 0);
    run(FRONT_KIND.push, fps, { bodies: [stays] });
    ok(stays.knocks.length === 1, `${fps} fps: and the same body standing still is`);
    // One that steps into the cone after the front has passed its place is not knocked by the wave gone by.
    const late = body(-12, 0, 0);
    run(FRONT_KIND.push, fps, {
      bodies: [late],
      move: (t) => {
        if (t > truth + 0.2) late.pos.x = 12;
      },
    });
    ok(late.knocks.length === 0, `${fps} fps: and one that steps into the cone after the front has passed its place is not knocked by the wave gone by`);
  }
}

// --- a pull comes in from its far end and closes on whoever it never crossed inside its stop ---
{
  const truth = frontArrives(FRONT_KIND.pull, 16, 12);
  for (const fps of [30, 60, 144]) {
    const far = body(12, 0, 0);
    const inside = body(0.5, 0, 0);
    run(FRONT_KIND.pull, fps, { bodies: [far, inside] });
    const t = firstKnock(far);
    const ti = firstKnock(inside);
    ok(t !== null && t >= truth - 1e-9 && t - truth <= 1 / fps + 1e-9, `pull at ${fps} fps: a body 12 m out is drawn as the front comes in to it (${t?.toFixed(3)} s, the front at ${truth.toFixed(3)} s)`);
    ok(ti !== null && ti >= frontTime(FRONT_KIND.pull) - 1e-9 && ti - frontTime(FRONT_KIND.pull) <= 1 / fps + 1e-9 && inside.knocks.length === 1, `pull at ${fps} fps: one inside its stop is reached once, at its closing step (${ti?.toFixed(3)} s)`);
  }
}

// --- the speed dial: the knock and the air's front together ---
{
  const at = (): number => {
    const b = body(12, 0, 0);
    run(FRONT_KIND.push, 144, { bodies: [b] });
    return firstKnock(b)!;
  };
  const at1 = at();
  setForceWave(true, 2);
  const at2 = at();
  const truth2 = frontArrives(FRONT_KIND.push, 16, 12);
  setForceWave(true, 1);
  ok(Math.abs(at2 - at1 / 2) <= 1 / 144 + 1e-9 && at2 - truth2 <= 1 / 144 + 1e-9 && at2 >= truth2 - 1e-9, `twice the speed knocks in half the time (${at1.toFixed(3)} s to ${at2.toFixed(3)} s), and still as the air's front at that speed arrives`);
  ok(frontTime(FRONT_KIND.push) === AIR_TUNE.force.pushTime / FORCE_WAVE.speed, "the air's front reads the one speed (`frontTime`)");
  setForceWave('no', Number.NaN);
  ok(FORCE_WAVE.travels === true && FORCE_WAVE.speed === 1, 'a setting that is not a switch or a number leaves the record as it was');
  setForceWave(true, 99);
  ok(FORCE_WAVE.speed === FORCE_WAVE_SPEED.max, "a speed past the slider's end is held to it");
  setForceWave(true, 1);
}

// --- gameplay, never graphics: the volumetrics master off or on knocks alike ---
{
  const was = VOL_TUNE.on;
  const at = (): number | null => {
    const b = body(12, 0, 0);
    run(FRONT_KIND.push, 60, { bodies: [b] });
    return firstKnock(b);
  };
  VOL_TUNE.on = false;
  const off = at();
  VOL_TUNE.on = true;
  const on = at();
  VOL_TUNE.on = was;
  ok(off !== null && off === on, `with the volumetrics master off and on the real step knocks alike (${off?.toFixed(3)} s): the switch and the speed are read, never a graphics setting`);
  const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const graphics = /VOL_TUNE|volSettings|fxRegistry|FX_DEFAULTS|airVolume|settings\.vol|\.effects\b/;
  ok(!graphics.test(code(src('combat/forceWave.ts'))) && !graphics.test(code(src('combat/forceWaveKnock.ts'))) && !/import/.test(code(src('combat/forceWaveTune.ts'))), "the knock's modules import no graphics setting (the tune none at all)");
}

// --- the kit runs this very step, and the switch off is the instant knock of the commit before this wave, to the line ---
{
  const body0 = (s: string, head: string): string => {
    const a = s.indexOf(head);
    const b = s.indexOf('\n  }\n', a);
    return a < 0 ? '' : s.slice(a, b);
  };
  const jediNow = src('combat/jedi.ts');
  const jediWas = showAt(PRE_WAVE, 'src/combat/jedi.ts');
  ok(jediNow.includes('readonly waves = new ForceWaves();\n  private readonly knock = new WaveKnock(this.waves);') && jediNow.includes('if (this.waves.waves.length > 0) this.knock.step(ctx);') && (jediNow.match(/this\.knock\.step\(/g) ?? []).length === 1, "the jedi kit steps the waves through this very WaveKnock every frame one runs, and in no other way");
  ok(/if \(this\.wavePlanet !== planet\) \{\n\s+this\.waves\.clear\(\);\n\s+this\.wavePlanet = planet;\n\s+\}\n\s+if \(this\.waves\.waves\.length > 0\) this\.knock\.step\(ctx\);/.test(jediNow), 'a world left lets every wave go before the step');
  for (const head of ['  private shove(ctx: KitContext, sign: number): void {', '  private repulse(ctx: KitContext): void {']) {
    const was = body0(jediWas, head);
    const now0 = body0(jediNow, head);
    ok(was.length > 200 && was === now0, `with the switch off the power is the instant knock as it stood before the wave, line for line (${head.trim().split('(')[0]})`);
  }
  ok(jediNow.includes('if (FORCE_WAVE.travels) this.shoveWave(ctx, 1);\n            else this.shove(ctx, 1);') && jediNow.includes('if (FORCE_WAVE.travels) this.shoveWave(ctx, -1);\n            else this.shove(ctx, -1);') && jediNow.includes('if (FORCE_WAVE.travels) this.repulseWave(ctx);\n            else this.repulse(ctx);'), 'and the press takes it whenever the switch is off');
  // Only when, never how hard: the travelling knock's arithmetic is the instant knock's own.
  const was = body0(jediWas, '  private shove(ctx: KitContext, sign: number): void {') + body0(jediWas, '  private repulse(ctx: KitContext): void {');
  const steps = body0(src('combat/forceWaveKnock.ts'), '  step(ctx: WaveContext): void {');
  for (const line of ["strikeAs('force', c, 25 * (1 - d / 12) + 5,", 'c.knock?.(tmp2, 26 * (1 - d / 12) + 8);', "strikeAs('force', c, sign > 0 ? 10 : 4,", 'c.knock?.(tmp2, sign > 0 ? 22 * (1 - d / 18) + 6 : 4 + d * 1.1);', 'm * 10 * (1 - d / 12)', 'm * 9 * (1 - d / 14)']) {
    ok(was.includes(line) && steps.includes(line), `the travelling knock's "${line}" is the instant one's own`);
  }
}

// --- the list, and the console ---
{
  const W = new ForceWaves();
  for (let i = 0; i < WAVE_MOST + 2; i++) W.begin(FRONT_KIND.push, 0, 0, 0, 0, 0, 0, 1, 0, 0, 16);
  ok(W.waves.length === WAVE_MOST && W.dropped === 2, `at most ${WAVE_MOST} waves run at once, the rest counted`);
  W.clear();
  ok(W.waves.length === 0, 'and a new world lets every one go');
  const main = src('main.ts');
  ok(main.includes('forceWave: (o?: { travels?: boolean; speed?: number }) => {') && main.includes('setForceWave(S.forceKnockTravels, S.forceWaveSpeed);'), '`__debug.forceWave` and the settings write the one record');
}

console.log(`\n${checks} checks passed`);
