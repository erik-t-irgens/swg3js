// Wave 3 of the animations, day one: with the feet, the stairs and the crease at 'before', what the speed classes, the
// peers' legs and the pack's fitted clips give is 23d7898's own to the bit, that commit's modules read out of git (a
// recorded digest where git cannot answer):
//  - the player's record (`BodyLoco`) and another player's (`PeerLoco`) over every way, class, gun and speed sweep at 30,
//    60 and 144 frames a second, handed stairs under the body (up and down) with `stairs.rule` at 'before', and handed none
//    under the rule as shipped;
//  - the pack's fitted clips (`MixamoPack.clipsFor`) for the human male (or the tests' own skeleton): every clip the pack
//    fitted at 23d7898, track by track, value by value; the stair clips are new and their own;
//  - and the stairs under the body under the shipped rule do change the legs (the clip the stairs take), so the check
//    above is not blind.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BodyLoco, newLocoIn, type LocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';
import { STAIR_IDS, moreClips } from '../../../src/anim/locoTable.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { loadOldMany } from './oldModules.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const PRE_WAVE = '23d7898';
/** The digests of the day-one traces under 23d7898's own modules (what a checkout with no history is held to). */
const LOCO_TRACE = '025e3d5fdc635713';
const PACK_TRACE = 'af4d7e79f029e143';

type Loco = InstanceType<typeof BodyLoco>;
const full: LocoRig = { has: () => true, speedOut: 0, readSpeed() { this.speedOut = 3; return true; } };
interface Keys { w?: boolean; s?: boolean; a?: boolean; d?: boolean; shift?: boolean; walk?: boolean }
type Mods = { BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn; PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn };

/** Every frame of the records over a script of keys, guns and peers' sweeps, each number written by `Object.is`'s spelling. */
function trace(mods: Mods, tune: unknown, stairs: number): string[] {
  const rows: string[] = [];
  const n = (v: unknown) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : String(v));
  for (const fps of [30, 60, 144]) {
    const b = new mods.BodyLoco(tune as never);
    const f = mods.newLocoIn();
    f.sprint = 6.35;
    f.pool = 100;
    let was = false;
    const step = (seconds: number, k: Keys, over: Record<string, unknown> = {}) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        const dt = 1 / fps;
        b.keys(dt, !!k.shift, !!k.shift && !was, !!k.walk, full);
        was = !!k.shift;
        Object.assign(f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, ground: 0, stairs }, over);
        b.plan(f);
        f.ground = b.speed * 0.97;
        const legs = b.legs(full, f, !!over.fighting);
        b.face(b.faces(!!over.fighting));
        b.fadeFor(legs !== null, !!over.fighting, f.mz !== 0 || f.mx !== 0);
        rows.push([b.asked, b.cls, b.speed, b.sprinting, b.refused, b.pick?.id ?? '-', b.dir, b.moves, b.legsOn, b.rate, b.turn, b.turnNow, b.turnStep, b.fadeNow, b.stamina.value, b.stamina.tired, legs?.id ?? '-'].map(n).join(' '));
      }
    };
    step(0.5, { w: true });
    step(0.5, { w: true, shift: true });
    step(0.2, { w: true });
    step(0.6, { w: true, shift: true });
    step(0.4, { a: true, walk: true });
    step(0.4, { d: true, walk: true });
    step(0.4, { w: true, a: true, walk: true });
    step(0.4, { s: true, d: true, walk: true });
    step(0.4, { w: true, shift: true }, { gunClass: 1 });
    step(0.4, { a: true, walk: true }, { gunClass: 0 });
    step(0.3, { d: true, shift: true }, { gunClass: 2, gunUp: true });
    step(0.3, { s: true, a: true }, { gunClass: 3 });
    step(0.4, { w: true }, { crouched: true });
    step(0.3, { w: true, walk: true }, { hpShare: 0.2 });
    step(0.3, {});
  }
  for (const state of ['walk', 'run', 'gunWalk', 'gunRun', 'gunAimRun']) {
    const p = new mods.PeerLoco();
    const f = new mods.PeerIn();
    for (let i = 0; i < 240; i++) {
      const turn = i * 0.05;
      const speed = 0.4 + (i % 40) * 0.16;
      f.vx = Math.sin(turn) * speed;
      f.vz = Math.cos(turn) * speed;
      f.heading = 0.3;
      f.speed = speed;
      f.dt = 1 / 60;
      (f as unknown as { stairs: number }).stairs = stairs;
      const got = p.resolve(tune as never, full, state, f);
      rows.push([state, got?.id ?? '-', p.rate, p.rel].map(n).join(' '));
    }
  }
  return rows;
}
const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
const today: Mods = { BodyLoco: BodyLoco as never, newLocoIn, PeerLoco, PeerIn };

{
  const FILES = ['src/anim/bodyLoco.ts', 'src/anim/locoClass.ts', 'src/anim/locoTable.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'];
  const old = await loadOldMany(FILES, ['src/anim/bodyLoco.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'], PRE_WAVE);
  const off = T();
  off.stairs.rule = 'before';
  off.ik.rule = 'before';
  off.slopeCrease = 'before';
  const none = trace(today, T(), 0);
  const up = trace(today, off, 1);
  const down = trace(today, off, -1);
  const shipped = trace(today, T(), 1);
  const digest = createHash('sha1').update(none.join('\n')).digest('hex').slice(0, 16);
  ok(up.join('\n') === none.join('\n') && down.join('\n') === none.join('\n'), `under 'before' stairs under the body, up or down, change nothing the records give (${none.length} rows)`);
  const first = shipped.findIndex((r, i) => r !== none[i]);
  ok(first >= 0 && /stairs/.test(shipped.join('\n')), `and under the shipped rule they do (from row ${first}: the stair clips), so the check is not blind`);
  if (old) {
    const [ob, ot, op] = old as [{ BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn }, { LOCO_TUNE_SHIPPED: LocoTune }, { PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }];
    const then = trace({ BodyLoco: ob.BodyLoco, newLocoIn: ob.newLocoIn, PeerLoco: op.PeerLoco, PeerIn: op.PeerIn }, JSON.parse(JSON.stringify(ot.LOCO_TUNE_SHIPPED)), 0);
    const at = none.findIndex((r, i) => r !== then[i]);
    ok(none.length === then.length && at < 0, `day one: with no stairs under the body the records are ${PRE_WAVE}'s, frame for frame at 30, 60 and 144 frames a second (${none.length} rows, every number by Object.is)${at >= 0 ? `: row ${at} is ${none[at]} against ${then[at]}` : ''}`);
    note(`the records' trace digest is ${digest} (LOCO_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s modules here: the records' trace is held to the digest recorded from them`);
  ok(digest === LOCO_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${digest})`);
}

// ---- the pack's fitted clips --------------------------------------------------------------------------------------------------
{
  const root = repoRoot(import.meta.url);
  const body = speciesBodies(root).find((b) => b.id === 'human_male');
  const target = body ? glbSkeleton(body.body) : targetSkeleton();
  const packDir = join(root, 'public', 'anims', 'mixamo');
  const io = (also: readonly string[]) => ({
    enabled: () => true,
    index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
    clip: async (file: string) => {
      const b = readFileSync(join(packDir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    also,
    now: () => performance.now(),
  });
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  type Clip = { name: string; tracks: { name: string; times: ArrayLike<number>; values: ArrayLike<number> }[] };
  const flat = (clips: Clip[]) => clips.filter((c) => !STAIR_IDS.some((id) => c.name === `mx_${id}`)).map((c) => `${c.name}|${c.tracks.map((t) => `${t.name}:${Array.from(t.times).map(String).join(',')}:${Array.from(t.values).map((v) => (Object.is(v, -0) ? '-0' : String(v))).join(',')}`).join(';')}`).sort();
  const now = (await new MixamoPack(io([...moreClips(), ...STAIR_IDS])).clipsFor(target as never, 'day one')) as unknown as Clip[];
  const stairs = now.filter((c) => STAIR_IDS.some((id) => c.name === `mx_${id}`));
  const mine = flat(now);
  const digest = createHash('sha1').update(mine.join('\n')).digest('hex').slice(0, 16);
  ok(stairs.length === STAIR_IDS.length, `the pack fits the ${STAIR_IDS.length} stair clips the game names beside the rest (${stairs.map((c) => c.name).join(', ')})`);
  const old = await loadOldMany(['src/anim/mixamoPack.ts', 'src/anim/fit.ts', 'src/anim/locoTable.ts'], ['src/anim/mixamoPack.ts', 'src/anim/locoTable.ts'], PRE_WAVE);
  if (old) {
    const [om, ol] = old as [{ MixamoPack: typeof MixamoPack }, { moreClips: () => string[] }];
    const then = flat((await new om.MixamoPack(io(ol.moreClips())).clipsFor(target as never, 'day one')) as unknown as Clip[]);
    const at = mine.findIndex((r, i) => r !== then[i]);
    ok(mine.length === then.length && at < 0, `day one: every other clip the pack fits (${mine.length}) is ${PRE_WAVE}'s own, track by track and value by value${at >= 0 ? `: ${mine[at].slice(0, 80)} differs` : ''}`);
    note(`the pack's trace digest is ${digest} (PACK_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s pack here: its clips are held to the digest recorded from it`);
  console.info = info;
  console.warn = warn;
  ok(digest === PACK_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own pack (${digest})`);
}

console.log(`wave3DayOne: ${checks} checks passed`);
