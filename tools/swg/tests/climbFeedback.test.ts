// Climbing II, the feedback round (the owner's notes after playing phase 2), items 1 and 2, through the game's own movement,
// ledges and wall climb on the real Rapier (the course's harness, tools/swg/tests/climbCourseBody.ts, over the grapple's
// TestBody), frame by frame while moving, at 30, 60, 144 and 240 frames a second:
//  1. the grab lets go sooner (`climb.grabFree` 'share'): from `grabFreeAt` of its clip on, a shimmy (A or D held), W, a
//     hop (a side and Space), Space alone (the small jump off), the crouch's let-go and the look-away begin, a press made
//     earlier in the grab kept for then; nothing asked, the grab is the whole grab to the frame, as under 'whole'; under
//     'whole' every key waits for the grab's end (and a press made during it is lost, as today); the drawn figure never jumps
//     as the grab hands over;
//  2. "No room to climb up here." says why (`climb.roomSay` 'why': the test that failed, where, what it met and how far
//     into it; 'before' today's words), and a climb that nearly fits is climbed short (`climb.roomRule` 'fit'): nearer the
//     lip (room-beam), tucked crouched on the way up (room-roof), over the lip lower (room-sill), with a brush allowed
//     (room-bump), each on a piece of the course's feedback row built for it, refused where nothing fits (room-none); a short
//     climb that ends nearer or crouched is cut where its clip crouches on the top, a whole one plays its whole clip; the
//     sliders reach (no brush refuses the bump, no lower way leaves the sill to another end);
// and the hand-overs only the game makes (main.ts's collider names, the console's report) pinned as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIMB_FEEDBACK_BEFORE, CLIMB_TUNE, climbFeedbackBefore, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { climbCourse, FACE_Z, ROOM_HEIGHT, ROOM_ROW, STAND_OFF, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { LEDGE_CLIMB_CUT, LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { LEDGE_HANG, LEDGE_MOVE, LEDGE_NONE } from '../../../src/player/ledge.ts';
import { bodyAt, runCourse, runUntil, standPiece, tap, type Stood } from './climbCourseBody.ts';
import { TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string): CoursePiece => climbCourse({ pieces: [id] }).pieces[0];

resetClimbTune();
ok(CLIMB_TUNE.grabFree === 'share' && CLIMB_TUNE.roomSay === 'why' && CLIMB_TUNE.roomRule === 'fit' && CLIMB_FEEDBACK_BEFORE.grabFree === 'whole' && CLIMB_FEEDBACK_BEFORE.roomSay === 'before' && CLIMB_FEEDBACK_BEFORE.roomRule === 'strict', "the round's switches ship on (the owner asked for them), each with today's as its other word");

// ---- 1. the grab lets go sooner ----------------------------------------------------------------------------------------------

/** A standing jump at a piece's lip, E and W held (W let go as the grab begins): the body at the grab's first frame. */
async function toGrab(id: string, fps: number, start = 'stand'): Promise<{ s: Stood; b: TestBody; span: number }> {
  const p = piece(id);
  // On the side gap, a start of its own 0.4 m short of A's right end (the hop's band looks across from the held lip's end).
  if (start === 'nearEnd') p.starts.push({ name: 'nearEnd', at: [-(p.numbers.span as number) / 2 - 0.4, 0, FACE_Z - STAND_OFF], face: [0, 1] });
  const s = await standPiece(p);
  const { b } = bodyAt(s, start, fps);
  // A lip in the hands' reach from the ground (the 1.8 m lip): E alone grabs it there, no jump.
  const ground = id === 'lip-braced-1.8';
  if (!ground) b.key('KeyW', true);
  b.key('KeyE', true);
  if (!ground) tap(b, 'Space', fps);
  const t = runUntil(b, fps, 2.5, () => b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'grab');
  b.key('KeyW', false);
  b.key('KeyE', false);
  assert.ok(Number.isFinite(t), `${id} @${fps}: the jump grabs its lip`);
  return { s, b, span: b.ledge.move.T - b.ledge.move.t0 };
}

/** One frame, and the drawn figure's place (the body's and the ledge's offset), into `at`. */
const drawn = (b: TestBody): [number, number, number] => [b.pos.x + b.ledge.offX, b.pos.y + b.ledge.offY, b.pos.z + b.ledge.offZ];

/**
 * From a grab's first frame: `ask` sets keys on each frame (its frame number since the grab began), run until `done` or 3 s;
 * the frames taken, the drawn figure's largest step in one frame, and a hash-like trace of every frame.
 */
function after(b: TestBody, fps: number, ask: (k: number) => void, done: () => boolean): { frames: number; step: number; trace: string } {
  let last = drawn(b);
  let step = 0;
  const trace: string[] = [];
  for (let k = 1; k <= Math.round(3 * fps); k++) {
    ask(k);
    b.frame(1 / fps);
    const d = drawn(b);
    step = Math.max(step, Math.hypot(d[0] - last[0], d[1] - last[1], d[2] - last[2]));
    last = d;
    trace.push(`${b.pos.x.toFixed(9)} ${b.pos.y.toFixed(9)} ${b.pos.z.toFixed(9)} ${b.ledge.phase} ${b.heading.toFixed(9)} ${d.map((v) => v.toFixed(9)).join(' ')}`);
    if (done()) return { frames: k, step, trace: trace.join('\n') };
  }
  return { frames: Infinity, step, trace: trace.join('\n') };
}

{
  for (const id of ['lip-braced-2.4', 'lip-free-2.4']) {
    for (const fps of RATES) {
      // Nothing asked: the grab plays out whole, to the frame, whichever the switch says.
      const traces: string[] = [];
      for (const rule of ['share', 'whole'] as const) {
        resetClimbTune();
        tuneClimb({ grabFree: rule });
        const { b } = await toGrab(id, fps);
        let hung = -1;
        const r = after(b, fps, () => {}, () => {
          if (hung < 0 && b.ledge.phase === LEDGE_HANG) hung = 0;
          if (hung >= 0) hung++;
          return hung > Math.round(0.5 * fps);
        });
        traces.push(r.trace);
      }
      ok(traces[0] === traces[1], `${id} @${fps}: nothing asked, the grab under 'share' is the grab under 'whole' to the frame (its end and half a second of the hang after)`);
    }
  }

  // A key asked from the grab's second frame on: when the hang takes it, under each rule.
  type Ask = { name: string; id: string; ask: (b: TestBody, k: number) => void; begun: (b: TestBody) => boolean; lostWhole?: boolean };
  const asks: Ask[] = [
    { name: 'D held (the shimmy)', id: 'lip-braced-2.4', ask: (b, k) => k === 1 && b.key('KeyD', true), begun: (b) => b.ledge.phase === LEDGE_HANG && b.ledge.shimmy !== 0 },
    { name: 'A held (the free shimmy)', id: 'lip-free-2.4', ask: (b, k) => k === 1 && b.key('KeyA', true), begun: (b) => b.ledge.phase === LEDGE_HANG && b.ledge.shimmy !== 0 },
    { name: "D held after E's grab from the ground", id: 'lip-braced-1.8', ask: (b, k) => k === 1 && b.key('KeyD', true), begun: (b) => b.ledge.phase === LEDGE_HANG && b.ledge.shimmy !== 0 },
    { name: 'W pressed (the climb up)', id: 'lip-braced-2.4', ask: (b, k) => b.key('KeyW', k === 1), begun: (b) => b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'climb', lostWhole: true },
    { name: 'D and Space pressed (a hop across)', id: 'gap-side-1.0', ask: (b, k) => { b.key('KeyD', k === 1); b.key('Space', k === 1); }, begun: (b) => b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'hop', lostWhole: true },
    { name: 'Space pressed (the small jump off)', id: 'lip-braced-2.4', ask: (b, k) => b.key('Space', k === 1), begun: (b) => b.ledge.phase === LEDGE_NONE && b.ledge.lastLetGo === 'jumped off a little', lostWhole: true },
    { name: 'the crouch pressed (the let-go)', id: 'lip-braced-2.4', ask: (b, k) => b.key('ControlLeft', k === 1), begun: (b) => b.ledge.phase === LEDGE_NONE && b.ledge.lastLetGo === 'let go', lostWhole: true },
    {
      name: 'the view turned back (the look-away)',
      id: 'lip-braced-2.4',
      ask: (b, k) => {
        if (k !== 1) return;
        const v = b.heading + (160 * Math.PI) / 180;
        b.forward.set(Math.sin(v), 0, Math.cos(v));
        b.right.set(-Math.cos(v), 0, Math.sin(v));
      },
      begun: (b) => b.ledge.phase === LEDGE_HANG && b.ledge.look > 0,
    },
  ];
  /** Where a body starts on a piece (the gap's on its left lip). */
  const startOf = (id: string) => (id.startsWith('gap-') ? 'nearEnd' : 'stand');
  // The drawn figure's largest step in a frame through a whole grab, nothing asked (each rate's): what a hand-over is held to.
  const plain = new Map<string, number>();
  for (const id of new Set(asks.map((a) => a.id))) {
    for (const fps of RATES) {
      resetClimbTune();
      tuneClimb({ grabFree: 'whole' });
      const { b } = await toGrab(id, fps, startOf(id));
      plain.set(`${id}@${fps}`, after(b, fps, () => {}, () => b.ledge.phase === LEDGE_HANG).step);
    }
  }
  for (const a of asks) {
    for (const fps of RATES) {
      resetClimbTune();
      const g = await toGrab(a.id, fps, startOf(a.id));
      const share = CLIMB_TUNE.grabFreeAt * g.span;
      const r = after(g.b, fps, (k) => a.ask(g.b, k), () => a.begun(g.b));
      const t = r.frames / fps;
      // The cut comes on the first frame that starts with the grab's own clock past its share; the times here are counted from the
      // end of the grab's first frame, which its clock already ran (so a frame early at most, and two late).
      ok(Number.isFinite(t) && t >= share - 1 / fps - 1e-9 && t <= share + 2 / fps + 1e-9 && g.b.ledge.grabsFreed === 1, `${a.id} @${fps}: under 'share' ${a.name} begins ${n3(t)} s into the grab, its share ${n3(share)} s of ${n3(g.span)} s`);
      // ... and the drawn figure takes no jump there: its largest step in a frame no larger than a whole grab's own and a
      // centimetre, or than 8 m/s over the frame (what blending into a one-off over `ease` moves it; a pop would be a step of the
      // same tenths of a metre at every rate, where an ease shrinks with the frame).
      const most = Math.max((plain.get(`${a.id}@${fps}`) ?? 0) + 0.01, 8 / fps);
      ok(r.step <= most, `${a.id} @${fps}: ... the drawn figure steps at most ${n3(r.step)} m in a frame through it (a whole grab's own ${n3((plain.get(`${a.id}@${fps}`) ?? 0))}, 8 m/s ${n3(8 / fps)})`);
      resetClimbTune();
      tuneClimb({ grabFree: 'whole' });
      const w = await toGrab(a.id, fps, startOf(a.id));
      const rw = after(w.b, fps, (k) => a.ask(w.b, k), () => a.begun(w.b));
      const tw = rw.frames / fps;
      if (a.lostWhole) ok(!Number.isFinite(tw) || tw >= w.span - 1 / fps - 1e-9, `${a.id} @${fps}: under 'whole' the same press waits for the grab's end or is lost there (${Number.isFinite(tw) ? `${n3(tw)} s` : 'never'}), as phase 2 had it`);
      else ok(Number.isFinite(tw) && tw >= w.span - 1 / fps - 1e-9 && tw <= w.span + 2 / fps + 1e-9 && w.b.ledge.grabsFreed === 0, `${a.id} @${fps}: under 'whole' it begins only as the grab ends (${n3(tw)} s of ${n3(w.span)} s)`);
    }
  }
  // A press made early in the grab is kept until the share: W pressed on the grab's second frame climbs at the share.
  for (const fps of RATES) {
    resetClimbTune();
    tuneClimb({ grabFreeAt: 0.6 });
    const g = await toGrab('lip-braced-2.4', fps);
    const r = after(g.b, fps, (k) => g.b.key('KeyW', k === 1), () => g.b.ledge.phase === LEDGE_MOVE && g.b.ledge.move.kind === 'climb');
    const t = r.frames / fps;
    ok(Number.isFinite(t) && t >= 0.6 * g.span - 1 / fps - 1e-9 && t <= 0.6 * g.span + 2 / fps + 1e-9, `@${fps}: with the slider at 0.6, W pressed on the grab's second frame is kept and climbs at ${n3(t)} s (its share ${n3(0.6 * g.span)} s)`);
  }
}

// ---- 2. "No room" says why, and a climb that nearly fits is climbed short ----------------------------------------------------------
{
  const ids = climbCourse().pieces.filter((p) => p.row === ROOM_ROW).map((p) => p.id);
  ok(ids.join() === 'room-beam,room-roof,room-sill,room-bump,room-none', `the course has the round's row, after every other (${ids.join(', ')})`);
  const last = climbCourse().pieces.slice(-ids.length).map((p) => p.id);
  ok(last.join() === ids.join(), 'and it is the last row, so no piece before it moves (the digests of phases 1 and 2 hold over the rest)');

  // Under 'strict' with the words: each refusal names its test and what it met.
  resetClimbTune();
  tuneClimb({ roomRule: 'strict', roomSay: 'why' });
  const strict = await runCourse(ids, RATES);
  const want: Record<string, RegExp> = {
    'room-beam': /^No room to climb up: the course's beam \(room-beam\), 1[0-9] cm in the way of a crouched body 0\.66 m in from the lip\.$/,
    'room-roof': /^No room to climb up: the course's roof \(room-roof\), \d+ cm in the way up past the lip\.$/,
    'room-sill': /^No room to climb up: the course's roof \(room-sill\), \d+ cm in the way in over the top\.$/,
    'room-bump': /^No room to climb up: the course's bump \(room-bump\), \d+ cm in the way of a crouched body 0\.1[78] m in from the lip\.$/,
    'room-none': /^No room to climb up: the course's roof \(room-none\), 1[0-9] cm in the way of a crouched body 0\.1[78] m in from the lip\.$/,
  };
  for (const r of strict.runs) {
    ok(r.grab[0]?.ok && want[r.id].test(r.climb) && r.stages.some((s) => s.startsWith('room strict: refused')), `${r.id} @${r.fps}: under 'strict' refused, in words: "${r.climb}"`);
  }
  // Under 'before' words the refusal is today's to the letter.
  resetClimbTune();
  climbFeedbackBefore();
  const before = await runCourse(ids, RATES);
  ok(before.runs.every((r) => r.climb === 'No room to climb up here.'), `under every switch at 'before' each is refused in today's words, "No room to climb up here." (${before.runs.length} runs)`);

  // Under 'fit': each climbed short its own way, the same at every rate.
  resetClimbTune();
  const fit = await runCourse(ids, RATES);
  const how: Record<string, { result: string; deep: number; crouched: boolean; cut: boolean }> = {
    'room-beam': { result: 'nearer', deep: 0.213, crouched: false, cut: true },
    'room-roof': { result: 'tucked, crouched', deep: 0.175, crouched: true, cut: false },
    'room-sill': { result: 'lower, crouched', deep: 0.663, crouched: true, cut: true },
    'room-bump': { result: 'brushed, crouched', deep: 0.177, crouched: false, cut: false },
  };
  for (const r of fit.runs) {
    const room = r.stages.find((s) => s.startsWith('room fit:')) ?? '';
    if (r.id === 'room-none') {
      ok(want['room-none'].test(r.climb) && room.startsWith('room fit: refused'), `${r.id} @${r.fps}: under 'fit' nothing fits and it is refused, in the same words`);
      continue;
    }
    const h = how[r.id];
    const m = /^stood (-?[\d.]+) m in at y ([\d.]+)$/.exec(r.climb);
    ok(!!m && Math.abs(Number(m[1]) - h.deep) < 0.005 && room.startsWith(`room fit: ${h.result} `) && room.includes(', cut') === h.cut && r.stages.includes(h.crouched ? 'kept crouched' : 'standing'), `${r.id} @${r.fps}: under 'fit' climbed ${h.result}, its feet ${m ? m[1] : '?'} m in from the lip${h.cut ? ', its clip cut' : ''}, ${h.crouched ? 'kept crouched' : 'standing'} after (${room})`);
  }
}

// ---- the climb's clip: whole where the whole climb fits, cut where a short one ends nearer or crouched --------------------------
{
  const free = LEDGE_FACTS[LEDGE_ROLES.free.climb];
  const cut = LEDGE_CLIMB_CUT[LEDGE_ROLES.free.climb];
  ok(!!cut && cut.t < free.dur && Math.abs(cut.ankle - free.a1) < 0.01 && !LEDGE_CLIMB_CUT[LEDGE_ROLES.braced.climb], `the free climb's cut is where its figure crouches on the top (${cut.t} s of ${free.dur}, ankles ${cut.ankle} against its end's ${free.a1}); the braced climb ends in its crouch and is never cut`);
  for (const fps of RATES) {
    for (const [id, T] of [['lip-free-2.4', free.dur], ['room-beam', cut.t], ['room-sill', cut.t], ['lip-braced-2.4', LEDGE_FACTS[LEDGE_ROLES.braced.climb].dur]] as const) {
      resetClimbTune();
      const g = await toGrab(id, fps);
      runUntil(g.b, fps, 3, () => g.b.ledge.phase === LEDGE_HANG);
      tap(g.b, 'KeyW', fps);
      const m = g.b.ledge.move;
      const climbing = g.b.ledge.phase === LEDGE_MOVE && m.kind === 'climb';
      ok(climbing && Math.abs(m.T - T) < 1e-9, `${id} @${fps}: the climb's clip runs to ${n3(m.T)} s (${T === cut.t ? 'cut where it crouches on the top' : 'whole'})`);
    }
  }
}

// ---- the tuck: crouched on the way up, and never into the roof ---------------------------------------------------------------
{
  for (const fps of RATES) {
    resetClimbTune();
    const g = await toGrab('room-roof', fps);
    runUntil(g.b, fps, 3, () => g.b.ledge.phase === LEDGE_HANG);
    const lipY = g.b.ledge.lip.ey;
    tap(g.b, 'KeyW', fps);
    // Today's way up stands until it is over the lip and only goes crouched on the way in; tucked, it crouches below the lip,
    // and once crouched it never stands again before the top.
    let tuckedAt = Number.NaN;
    let upAgain = false;
    runUntil(g.b, fps, 3, () => {
      if (g.b.ledge.phase === LEDGE_MOVE) {
        if (g.b.ledge.crouchedNow && tuckedAt !== tuckedAt) tuckedAt = g.b.pos.y - lipY;
        else if (!g.b.ledge.crouchedNow && tuckedAt === tuckedAt) upAgain = true;
      }
      return !g.b.ledge.holding;
    });
    ok(tuckedAt < -0.01 && !upAgain, `room-roof @${fps}: the climb tucks crouched on its way up, its feet ${n3(tuckedAt)} m under the lip, and never stands again before the top`);
  }
}

// ---- the sliders reach ----------------------------------------------------------------------------------------------------------
{
  resetClimbTune();
  tuneClimb({ roomBrush: 0 });
  const bump = await runCourse(['room-bump'], [60]);
  ok(/^No room to climb up: the course's bump/.test(bump.runs[0].climb), `with no brush the bump's climb is refused under 'fit' ("${bump.runs[0].climb}")`);
  resetClimbTune();
  tuneClimb({ liftLeast: 0.05 });
  const sill = await runCourse(['room-sill'], [60]);
  const room = sill.runs[0].stages.find((s) => s.startsWith('room fit:')) ?? '';
  ok(!room.includes('lower'), `with the least lift at today's 0.05 the sill is never climbed by a lower way in (${room})`);
  resetClimbTune();
  tuneClimb({ roomRule: 'strict' });
  const roof = await runCourse(['room-roof'], [60]);
  ok(/^No room to climb up: the course's roof \(room-roof\), \d+ cm in the way up past the lip\.$/.test(roof.runs[0].climb), `under 'strict' the roof's climb is refused at the way up, as today's rule refused it`);
}

// ---- what only the game hands over, as text -------------------------------------------------------------------------------------
{
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const main = read('../../../src/main.ts');
  const world = read('../../../src/world/world.ts');
  ok(main.includes('this.player.ledge.namer = (c) => this.climbColliderName(c.handle);'), "the game hands the ledges its collider names (main.ts's `climbColliderName`)");
  ok(main.includes("if (k) return `the course's ${k.role} (${k.piece})`;") && main.includes('return this.world.colliderNameOf(handle);'), "... the test course's solid by its role and piece, else the world's name for it");
  ok(world.includes('colliderNameOf(handle: number): string | null {') && world.includes("return i === 0 ? 'the ground' : 'a planted tree or rock';"), "... the world's: a placed thing's template, else the ground's heightfield or a planting of a chunk standing");
  ok(main.includes('if (o.room) return { room: p.ledge.roomReport(),'), '`__debug.climb({ room: true })` answers the last climb up\'s room tests in full');
  ok(ROOM_HEIGHT === 2.4, 'the round\'s pieces stand their lips where a standing jump grabs them, braced and free (2.4 m)');
}

resetClimbTune();
console.log(`climbFeedback: ${checks} checks passed`);
