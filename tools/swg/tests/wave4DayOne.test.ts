// Wave 4 of the animations, day one: with `climb.ledges` at 'before', the body is e2b9776's own to the bit, that commit's
// grapple harness and grapple read out of git (a recorded digest where git cannot answer):
//  - the harness's body (the player's own movement, slope rule, grapple and controller, frame for frame) over scenes made
//    for the ledges -- a standing jump with W held at a 2.6 m wall's lip, a running jump at it, a fall past a lip, a crouch
//    walked off a 3 m top, a shimmy's keys held against a wall, and the grapple hauled up a face to a lip too steep to stand
//    on -- at 30, 60 and 144 frames a second, every place, velocity and verdict by `Object.is`;
//  - and under 'on' the same scenes do change (the ledges take the body), so the check above is not blind;
//  - the pack's fitted clips for the human male (or the tests' own skeleton): every clip the pack fitted at e2b9776, track
//    by track, value by value; the ledge clips are new and their own.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Today from './grappleBody.ts';
import { CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { LEDGE_IDS } from '../../../src/anim/ledgeClips.ts';
import { STAIR_IDS, moreClips } from '../../../src/anim/locoTable.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { Group, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';
import { loadOldMany } from './oldModules.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const PRE_WAVE = 'e2b9776';
/** The digests of the day-one traces under e2b9776's own modules (what a checkout with no history is held to). */
const BODY_TRACE = 'fe635578ea670ea8';
const PACK_TRACE = 'a92777031e8f7876';

type Harness = typeof Today;
type Body = InstanceType<Harness['TestBody']>;

/** Every frame of a body over the scenes, each number written by `Object.is`'s spelling. */
async function trace(H: Harness): Promise<string[]> {
  const rows: string[] = [];
  const n = (v: number) => (Object.is(v, -0) ? '-0' : String(v));
  const row = (b: Body, tag: string) => rows.push([tag, n(b.pos.x), n(b.pos.y), n(b.pos.z), n(b.vel.x), n(b.vel.y), n(b.vel.z), String(b.grounded), n(b.hp), String(b.grapple.attached), b.grapple.lastLetGo].join(' '));
  const scene = async (extra?: (p: Today.Physics) => RAPIER.Collider | null) => {
    const p = await H.makePhysics();
    H.ground(p, 0);
    H.box(p, [-3, 0, 2], [3, 2.6, 3], false);
    const c = extra ? extra(p) : null;
    p.stepOnce();
    return { p, c };
  };
  const body = (p: Today.Physics, x: number, y: number, z: number) => {
    const b = new H.TestBody(p) as Body;
    b.jka.forceLevel = 0;
    b.place(x, y, z);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    return b;
  };
  for (const fps of [30, 60, 144]) {
    const dt = 1 / fps;
    const run = (b: Body, tag: string, seconds: number, each?: (i: number) => void) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        each?.(i);
        b.frame(dt);
        row(b, tag);
      }
    };
    // A standing jump with W held at the lip.
    {
      const { p } = await scene();
      const b = body(p, 0, 0, 1.2);
      run(b, `${fps} stand`, 0.3);
      b.key('KeyW', true);
      b.key('Space', true);
      run(b, `${fps} stand`, 2.5, (i) => i === 1 && b.key('Space', false));
      b.key('KeyW', false);
    }
    // A running jump at it.
    {
      const { p } = await scene();
      const b = body(p, 0, 0, -4);
      run(b, `${fps} run`, 0.3);
      b.key('KeyW', true);
      b.key('ShiftLeft', true);
      run(b, `${fps} run`, 3, (i) => {
        if (i === Math.round(0.7 * fps)) b.key('Space', true);
        if (i === Math.round(0.7 * fps) + 1) b.key('Space', false);
      });
      b.key('KeyW', false);
      b.key('ShiftLeft', false);
    }
    // A fall past a lip, close in front of the face.
    {
      const { p } = await scene();
      const b = body(p, 0, 4.5, 1.5);
      run(b, `${fps} fall`, 2);
    }
    // A crouch walked off a 3 m top, and A and D held against the wall below.
    {
      const p = await H.makePhysics();
      H.ground(p, 0);
      H.box(p, [-3, 0, -3], [3, 3, 0], false);
      p.stepOnce();
      const b = body(p, 0, 3, -1);
      run(b, `${fps} crouch`, 0.3);
      // The crouch key (the game's default bindings: Ctrl or X; C is the class switch).
      b.key('ControlLeft', true);
      b.key('KeyW', true);
      run(b, `${fps} crouch`, 2.5);
      b.key('KeyW', false);
      b.key('ControlLeft', false);
      b.key('KeyA', true);
      run(b, `${fps} side`, 1);
      b.key('KeyA', false);
    }
    // The grapple hauled up a face to a lip too steep to stand on.
    {
      const top = 2.6;
      const rise = Math.tan((60 * Math.PI) / 180);
      const { p, c } = await scene((p) => {
        const v = [-3, 0, 6, 3, 0, 6, 3, top, 6, -3, top, 6, -3, top + rise, 7, 3, top + rise, 7, -3, 0, 7, 3, 0, 7];
        const idx = [0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5, 6, 5, 4, 6, 7, 5, 0, 1, 7, 0, 7, 6, 0, 6, 4, 0, 4, 3, 1, 2, 5, 1, 5, 7];
        const clean = cleanTrimesh(new Float32Array(v), new Uint32Array(idx))!;
        const d = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS);
        d.setCollisionGroups(groups(Group.exterior, Group.all));
        return p.world.createCollider(d);
      });
      const b = body(p, 0, 0, 5.2);
      run(b, `${fps} haul`, 0.3);
      b.hook(0, top + rise * 0.3, 6.3, 0, 0.5, -Math.sqrt(0.75), c, 4);
      b.key('KeyF', true);
      run(b, `${fps} haul`, 3);
      b.key('KeyF', false);
    }
  }
  return rows;
}

{
  CLIMB_TUNE.ledges = 'before';
  // (And the wall climb's, item B: these scenes press into faces the climb would take.)
  CLIMB_TUNE.wall = 'before';
  const before = await trace(Today);
  resetClimbTune();
  const on = await trace(Today);
  const digest = createHash('sha1').update(before.join('\n')).digest('hex').slice(0, 16);
  const first = on.findIndex((r, i) => r !== before[i]);
  ok(first >= 0 && on.length === before.length, `under 'on' the same scenes change (from row ${first}: ${on[first]?.split(' ')[0]} ${on[first]?.split(' ')[1]}), so the check is not blind`);
  const old = await loadOldMany(['tools/swg/tests/grappleBody.ts', 'src/player/grapple.ts'], ['tools/swg/tests/grappleBody.ts'], PRE_WAVE);
  if (old) {
    const then = await trace(old[0] as unknown as Harness);
    const at = before.findIndex((r, i) => r !== then[i]);
    ok(before.length === then.length && at < 0, `day one: under 'before' the body is ${PRE_WAVE}'s own, frame for frame at 30, 60 and 144 frames a second (${before.length} rows, every number by Object.is)${at >= 0 ? `: row ${at} is ${before[at]} against ${then[at]}` : ''}`);
    note(`the body's trace digest is ${digest} (BODY_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s harness here: the body's trace is held to the digest recorded from it`);
  ok(digest === BODY_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${digest})`);
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
  const ledge = (c: Clip) => LEDGE_IDS.some((id) => c.name === `mx_${id}`);
  const flat = (clips: Clip[]) => clips.filter((c) => !ledge(c)).map((c) => `${c.name}|${c.tracks.map((t) => `${t.name}:${Array.from(t.times).map(String).join(',')}:${Array.from(t.values).map((v) => (Object.is(v, -0) ? '-0' : String(v))).join(',')}`).join(';')}`).sort();
  const now = (await new MixamoPack(io([...moreClips(), ...STAIR_IDS, ...LEDGE_IDS])).clipsFor(target as never, 'day one')) as unknown as Clip[];
  const ledges = now.filter(ledge);
  const mine = flat(now);
  const digest = createHash('sha1').update(mine.join('\n')).digest('hex').slice(0, 16);
  ok(ledges.length === LEDGE_IDS.length, `the pack fits the ${LEDGE_IDS.length} ledge clips the game names beside the rest`);
  const old = await loadOldMany(['src/anim/mixamoPack.ts', 'src/anim/fit.ts', 'src/anim/locoTable.ts'], ['src/anim/mixamoPack.ts', 'src/anim/locoTable.ts'], PRE_WAVE);
  if (old) {
    const [om, ol] = old as [{ MixamoPack: typeof MixamoPack }, { moreClips: () => string[]; STAIR_IDS: readonly string[] }];
    const then = flat((await new om.MixamoPack(io([...ol.moreClips(), ...ol.STAIR_IDS])).clipsFor(target as never, 'day one')) as unknown as Clip[]);
    const at = mine.findIndex((r, i) => r !== then[i]);
    ok(mine.length === then.length && at < 0, `day one: every other clip the pack fits (${mine.length}) is ${PRE_WAVE}'s own, track by track and value by value${at >= 0 ? `: ${mine[at].slice(0, 80)} differs` : ''}`);
    note(`the pack's trace digest is ${digest} (PACK_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s pack here: its clips are held to the digest recorded from it`);
  console.info = info;
  console.warn = warn;
  ok(digest === PACK_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own pack (${digest})`);
}

console.log(`wave4DayOne: ${checks} checks passed`);
