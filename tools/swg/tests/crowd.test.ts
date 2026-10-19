// The crowd's thinning by share of the screen (the performance pass's third wave, `src/world/mobiles/crowd.ts`, the
// tiers in `lod.ts`, the sliders in `crowdDials.ts`): `screenShare` against a real `PerspectiveCamera` in node (a 1.8 m
// segment projected at a distance, its height in normalised device coordinates halved) to 1e-9, zoomed and not; the
// client's two far tiers by share, each off at nought, the hold only ever on a body standing still and neither on a body
// engaged or busy; the engaged floor; the floor on a shared body's thought; the small parts' band (hidden under
// `smallShare`, kept hidden up to the band, shown past it, shown at once on engaging); `tuneCrowd`'s refusals and
// clamps; every slider moving its own number and no other through it (a threshold of a small part relisting, a value
// past its range held); the day-one half: `lod.ts` as it stood at the pass's base (`5f3cff4`, read out of git) and
// today's `lodTier`, with both shares at nought and no new input, answering the same tier by `Object.is` over 10,000
// inputs, and today's trace held to a hash of the old one's where git cannot answer; and what the manager hands the tiers
// of each body (`crowdInput`): the share against a real camera, the fight and the server's keeping, and standing still
// judged over time, a walker stepped in sixtieths under 144 to 20 frames a second never held. The rules' checks are
// written against numbers set here, not the shipped table, which is the owner's to move.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { CROWD_PARTS, CROWD_TUNE, CrowdRecord, crowdInput, listsMover, screenShare, shareScale, smallPartsHidden, tuneCrowd, type CrowdBody, type CrowdHeld, type CrowdView } from '../../../src/world/mobiles/crowd.ts';
import { LOD_TUNE, lodTier, type LodInput, type LodTier } from '../../../src/world/mobiles/lod.ts';
import { CROWD_DIALS, crowdDialsFor } from '../../../src/world/mobiles/crowdDials.ts';
import { allDials, dialMoved, movedLine, resetDials } from '../../../src/ui/dials.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- 1. The share against a real camera. ----
{
  let worst = 0;
  for (const fov of [45, 60, 75]) {
    for (const zoom of [1, 1.6]) {
      const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 9000);
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      for (const d of [2, 10, 35, 52, 90, 160, 400]) {
        const top = new THREE.Vector3(0, 0.9, -d).project(cam);
        const bottom = new THREE.Vector3(0, -0.9, -d).project(cam);
        const ndc = (top.y - bottom.y) / 2;
        worst = Math.max(worst, Math.abs(ndc - screenShare(1.8, d, fov, zoom)));
      }
    }
  }
  ok(worst < 1e-9, `a 1.8 m figure's share of the screen's height is its projected height halved, at three fields of view, zoomed and not, from 2 to 400 m (worst ${worst.toExponential(2)})`);
  ok(Math.abs(screenShare(1.8, 52, 60) - 0.03) < 0.0005, 'at the game\'s 60 degrees a figure covers 3% of the screen\'s height about 52 m off (1.56 / d), where smallShare starts');
  ok(screenShare(1.8, 0, 60) === Infinity && shareScale(0) === Infinity, 'a body on the eye fills the screen, and a camera with no field of view thins nothing');
}

// ---- 2. The tiers by share, the engaged floor and the shared floor. ----
const base: LodInput = { dist: 120, onScreen: true, nearScreen: true, busy: false, sizeClass: 'medium', shadows: true, playerDist: 120, animRange: 160 };
/**
 * The crowd's numbers the checks below are written against, set here and not read from the shipped table: those are the
 * owner's to move (each a slider), and a check of the rules must not break when he ships another value. Only the checks
 * that say "as shipped" read `CROWD_TUNE`.
 */
const QUIET = { holdShare: 0, goneShare: 0, sharedThink: 0.4 };
const t = (o: Partial<LodInput>, crowd: typeof QUIET = QUIET): LodTier => lodTier({ ...base, ...o }, LOD_TUNE, undefined, crowd);
{
  const off = { ...QUIET };
  ok(lodTier({ ...base, share: 0.001, still: true }, LOD_TUNE).animEvery === 4 && lodTier({ ...base, share: 0.001 }, LOD_TUNE).visible, 'with both shares at nought (as shipped) a body however small on the screen is thinned by nothing');
  const on = { ...off, holdShare: 0.02, goneShare: 0.005 };
  ok(t({ share: 0.01, still: true }, on).animEvery === 0 && t({ share: 0.01, still: true }, on).visible, 'under holdShare a body standing still holds its pose (its mixer at nought) and is still drawn');
  ok(t({ share: 0.01, still: false }, on).animEvery === 4, 'one walking keeps its mixer at its tier\'s rate whatever its share, so no foot slides');
  ok(t({ share: 0.03, still: true }, on).animEvery === 4, 'and over holdShare nothing is held');
  const gone = t({ share: 0.002 }, on);
  ok(!gone.visible && !gone.castShadow, 'under goneShare a body is not drawn and throws no shadow (still simulated: its thought and its movement are as they were)');
  ok(gone.think === t({ share: 0.5 }, on).think && gone.move, '...its thought and whether it moves untouched by it');
  ok(t({ share: 0.002, engaged: true }, on).visible && t({ share: 0.01, still: true, engaged: true }, on).animEvery === 2, 'an engaged body is never held or left undrawn, and on screen it is lifted to the mid tier');
  ok(t({ share: 0.002, busy: true }, on).visible && t({ share: 0.01, still: true, busy: true }, on).animEvery === 2, 'nor is a busy one (a shot, a swing, a death)');
  const far = t({ engaged: true });
  ok(t({}).name === 'far' && far.name === 'mid' && far.animEvery === 2 && far.think === LOD_TUNE.think[1], 'an engaged body on screen past the mid distance is at the mid tier: its mixer every second frame');
  const past = t({ dist: 300, engaged: true });
  ok(t({ dist: 300 }).name === 'hidden' && past.name === 'mid' && past.animEvery === 2, '...and one on screen past the animation range too');
  const nearPlayer = t({ engaged: true, playerDist: 20 });
  ok(nearPlayer.think === LOD_TUNE.think[0], '...thinking at the near rate when it is near the player, as the mid tier does');
  ok(t({ onScreen: false, nearScreen: false, dist: 300, playerDist: 300, engaged: true }).name === 'frozen', 'off screen the floor does not apply (the room and the frustum decide, as before)');
  // Off screen at the hidden tier (just off the edge, throwing its shadow in, its mixer every fourth frame): the floor
  // that lifts an engaged body on screen to the mid tier must leave this one where the distance put it.
  const offEdge = { onScreen: false, nearScreen: true, dist: 30, playerDist: 30 };
  const hiddenPlain = t(offEdge);
  const hiddenEngaged = t({ ...offEdge, engaged: true });
  ok(hiddenPlain.name === 'hidden' && hiddenPlain.animEvery === 4 && hiddenEngaged.name === 'hidden' && hiddenEngaged.animEvery === 4 && hiddenEngaged.think === hiddenPlain.think, `an engaged body off screen at the hidden tier stays hidden, its mixer every fourth frame (${hiddenEngaged.name}, every ${hiddenEngaged.animEvery})`);
  const roomPast = { onScreen: true, nearScreen: true, dist: 30, playerDist: 30, room: 2 };
  ok(t(roomPast).name === 'hidden' && t({ ...roomPast, engaged: true }).name === 'hidden' && t({ ...roomPast, engaged: true }).animEvery === t(roomPast).animEvery, 'and so does one in a room one past a seen one, which the frustum has on screen and the walls do not');
  const frozen = t({ onScreen: false, nearScreen: false, dist: 300, playerDist: 300, shared: true });
  ok(frozen.name === 'frozen' && frozen.think === QUIET.sharedThink && t({ onScreen: false, nearScreen: false, dist: 300, playerDist: 300 }).think === LOD_TUNE.think[2], 'a body kept for a server thinks every 0.4 s however far off, where one of this browser\'s own frozen thinks every 1.5 s');
  const shipped = lodTier({ ...base, onScreen: false, nearScreen: false, dist: 300, playerDist: 300, shared: true }, LOD_TUNE);
  ok(shipped.think === CROWD_TUNE.sharedThink, `and as shipped the floor is CROWD_TUNE's own (${CROWD_TUNE.sharedThink} s)`);
  ok(t({ dist: 10, shared: true }).think === LOD_TUNE.think[0], 'and a faster tier is left faster');
  ok(t({ onScreen: false, nearScreen: false, dist: 300, playerDist: 300, shared: true }, { ...off, sharedThink: 1 }).think === 1, 'sharedThink is a live number');
}

// ---- 3. The small parts' band, and the mover list's rule. ----
{
  // The band's numbers set here (the shipped ones are the owner's sliders): hide under 3%, show again past 3.6%.
  const tune = { smallShare: 0.03, smallBand: 1.2 };
  const s = tune.smallShare;
  const band = s * tune.smallBand;
  const hide = (was: boolean, share: number, engaged = false, on = true) => smallPartsHidden(was, share, engaged, on, tune);
  ok(!hide(false, s * 1.01) && hide(false, s * 0.99), 'small parts hide only under smallShare');
  ok(hide(true, s * 1.1) && hide(true, band), 'once hidden they stay hidden between smallShare and smallShare times the band');
  ok(!hide(true, band * 1.01), 'and come back only past the band');
  // A body pacing in and out across the line: it changes once, never at every step.
  let hidden = false;
  let flips = 0;
  for (let k = 0; k < 400; k++) {
    const share = s * (1 + 0.08 * Math.sin(k * 0.3));
    const now = hide(hidden, share);
    if (now !== hidden) flips++;
    hidden = now;
  }
  ok(flips === 1, `a body pacing up and down across smallShare (8% either way) hides its small parts once and never blinks them (${flips} change)`);
  ok(!hide(true, s * 0.5, true), 'a body that engages has them back at once, however small');
  ok(!hide(true, s * 0.5, false, false), 'and with the switch off none is ever hidden');
  const shipped = CROWD_TUNE.smallShare;
  ok(smallPartsHidden(false, shipped * 0.99, false, true) && !smallPartsHidden(false, shipped * 1.01, false, true), 'and the manager\'s call, handed no tune, reads the live table');
  ok(listsMover(true, false, true) && !listsMover(false, false, true) && listsMover(false, false, false) && !listsMover(true, true, false) && !listsMover(true, true, true), "the motion blur lists a body a pass drew; every body with the list at the old way; and never one the walk stepped over as culled");
}

// ---- 4. The knob and the sliders. ----
{
  const was = { ...CROWD_TUNE };
  const v0 = CROWD_PARTS.version;
  ok(tuneCrowd({ smallShare: 0.05 }).length === 0 && CROWD_TUNE.smallShare === 0.05, 'tuneCrowd moves a number in place');
  ok(CROWD_PARTS.version === v0, 'a share moved lists nothing again');
  tuneCrowd({ smallTris: 64 });
  ok(CROWD_PARTS.version === v0 + 1, 'a threshold of what a small part is moved has every body list its small parts again');
  const words = tuneCrowd({ nope: 1, goneShare: 'x', smallBand: 0.2 } as Record<string, unknown>);
  ok(words.length === 3 && !('nope' in CROWD_TUNE) && CROWD_TUNE.smallBand === 1 && CROWD_TUNE.goneShare === was.goneShare, `a name it does not hold is refused, a word refused, a number past its range held at the edge, each said (${words.join('; ')})`);
  Object.assign(CROWD_TUNE, was);
  ok(crowdDialsFor('crowd') === CROWD_DIALS && crowdDialsFor('race') === null, 'the debug menu finds the crowd\'s sliders under `crowd` and nowhere else');
  const keys = allDials(CROWD_DIALS).map((d) => d.key);
  ok(Object.keys(CROWD_TUNE).every((k) => keys.includes(`tune.${k}`)) && keys.length === Object.keys(CROWD_TUNE).length, `every number of CROWD_TUNE has a slider, and no slider is anything else (${keys.length})`);
  // Each slider alone, from the shipped table: it moves its own number and no other, and a threshold of what a small
  // part is lists every body's small parts again, which only `tuneCrowd` does.
  const strays: string[] = [];
  for (const d of allDials(CROWD_DIALS)) {
    if (d.kind !== 'number') continue;
    resetDials(CROWD_DIALS);
    const k = d.key.slice('tune.'.length) as keyof typeof CROWD_TUNE;
    const before = { ...CROWD_TUNE };
    const version = CROWD_PARTS.version;
    let v = d.min + (d.max - d.min) * 0.5;
    if (v === before[k]) v = d.max;
    d.set(v);
    const others = (Object.keys(before) as (keyof typeof CROWD_TUNE)[]).filter((o) => o !== k && !Object.is(CROWD_TUNE[o], before[o]));
    if (!(Math.abs(CROWD_TUNE[k] - v) < 1e-12) || d.get() !== CROWD_TUNE[k] || others.length > 0 || !dialMoved(CROWD_DIALS, d)) strays.push(`${d.key} (${others.join(', ')})`);
    const relists = k === 'smallTris' || k === 'smallSize';
    if (relists !== (CROWD_PARTS.version === version + 1)) strays.push(`${d.key} relisted ${CROWD_PARTS.version - version} times`);
  }
  ok(strays.length === 0, `each slider moves its own number of the table and no other, and the two of what a small part is have every body list its small parts again (${strays.join('; ') || 'all'})`);
  resetDials(CROWD_DIALS);
  // A value past a number's own range is held at its edge, as the console holds it: only `tuneCrowd` clamps.
  const dialOf = (k: string) => allDials(CROWD_DIALS).find((d) => d.key === `tune.${k}`);
  dialOf('smallShare')?.set(5);
  dialOf('holdAfter')?.set(0.001);
  ok(CROWD_TUNE.smallShare === 1 && CROWD_TUNE.holdAfter === 0.05, `a slider handed a value past its number's range has it held at the edge, through tuneCrowd (smallShare ${CROWD_TUNE.smallShare}, holdAfter ${CROWD_TUNE.holdAfter})`);
  resetDials(CROWD_DIALS);
  dialOf('smallShare')?.set(0.05);
  dialOf('smallBand')?.set(1.5);
  const line = movedLine(CROWD_DIALS);
  ok(line.startsWith('__debug.crowd({ tune: { ') && line.includes('smallShare: '), `the line that keeps them is the console's own (${line.slice(0, 90)}…)`);
  resetDials(CROWD_DIALS);
  ok(JSON.stringify(CROWD_TUNE) === JSON.stringify(was), 'Reset all puts every number back where it shipped');
}

// ---- 5. Day one: today's tiers with no new input are the base's, bit for bit. ----
{
  /** A small random generator of our own, so every run draws the same inputs. */
  let seed = 0x2f6b1d;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const inputs: LodInput[] = [];
  for (let k = 0; k < 10000; k++) {
    const onScreen = rnd() < 0.5;
    inputs.push({
      dist: rnd() * 400,
      onScreen,
      nearScreen: onScreen || rnd() < 0.3,
      busy: rnd() < 0.2,
      sizeClass: pick(['tiny', 'small', 'medium', 'large', 'huge'] as const),
      shadows: rnd() < 0.8,
      playerDist: rnd() * 400,
      animRange: pick([100, 160, 300]),
      inCascades: pick([undefined, true, false]),
      room: pick([undefined, -1, 0, 1, 2]),
    });
  }
  const traceOf = (fn: (i: LodInput) => LodTier, extra?: (i: LodInput, k: number) => LodInput): string => inputs.map((i, k) => {
    const r = fn(extra ? extra(i, k) : i);
    return `${r.name}|${r.animEvery}|${r.visible ? 1 : 0}|${r.castShadow ? 1 : 0}|${r.think}|${r.move ? 1 : 0}`;
  }).join(';');
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  // The hash of the base's own trace over these inputs, taken from `lod.ts` at 5f3cff4: what holds today's when git cannot.
  const BASE_TRACE = '565738ff';
  const today = traceOf((i) => lodTier(i, LOD_TUNE));
  const sameAsHash = fnv(today) === BASE_TRACE;
  // And with every new input given but nothing that acts on it: shares at nought (as shipped), nobody engaged or kept.
  const quiet = traceOf((i) => lodTier(i, LOD_TUNE), (i, k) => ({ ...i, share: (k % 97) / 1000, still: k % 2 === 0, engaged: false, shared: false }));
  let old: ((i: LodInput, tune?: unknown) => LodTier) | null = null;
  let dir = '';
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const text = execFileSync('git', ['show', '5f3cff4:src/world/mobiles/lod.ts'], { cwd: root, encoding: 'utf8' });
    dir = mkdtempSync(join(tmpdir(), 'lod-base-'));
    const file = join(dir, 'lod.ts');
    writeFileSync(file, text);
    old = (await import(pathToFileURL(file).href)).lodTier;
  } catch (err) {
    console.log(`skip the base's lod.ts out of git (${(err as Error).message.split('\n')[0]}): held to its trace's hash instead`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  if (old) {
    let differs = 0;
    for (const i of inputs) {
      const a = old(i, LOD_TUNE);
      const b = lodTier(i, LOD_TUNE);
      if (!Object.is(a.name, b.name) || !Object.is(a.animEvery, b.animEvery) || !Object.is(a.visible, b.visible) || !Object.is(a.castShadow, b.castShadow) || !Object.is(a.think, b.think) || !Object.is(a.move, b.move)) differs++;
    }
    const oldTrace = traceOf((i) => old!(i, LOD_TUNE));
    ok(differs === 0, `over 10,000 inputs today's lodTier with no new input is the base's (5f3cff4, out of git) by Object.is in every field (${differs} differ)`);
    ok(fnv(oldTrace) === BASE_TRACE, `and the base's trace is the one this test holds by hash (${fnv(oldTrace)})`);
  }
  ok(sameAsHash, `today's trace with no new input hashes to the base's (${fnv(today)})`);
  ok(quiet === today, 'and given a share, a still root, and nobody engaged or kept, with both shares at nought, every tier is the same');
}

// ---- 6. What the manager hands the tiers of each body (`crowdInput`, the call `MobileManager.tierOf` makes). ----
{
  const mkBody = (height = 1.8): CrowdBody & { pos: THREE.Vector3; engaged: boolean; keptForServer: boolean } => ({ plan: { height }, pos: new THREE.Vector3(4, 0, -7), engaged: false, keptForServer: false });
  // The manager's own record of a body, as it makes it.
  const mkHeld = (): CrowdHeld => new CrowdRecord();
  const input = (): LodInput => ({ ...base, share: 0.5, engaged: false, shared: false, still: false });
  // The share against a real camera, at the view's own scale, as the manager works it out once a frame.
  let worst = 0;
  let exact = true;
  for (const fov of [45, 60, 75]) {
    for (const zoom of [1, 1.6]) {
      const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 9000);
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
      const view: CrowdView = { shareK: shareScale(cam.fov, cam.zoom), now: 0 };
      for (const d of [3, 35, 52, 140]) {
        for (const h of [0.6, 1.8, 6]) {
          const i = input();
          i.dist = d;
          const held = mkHeld();
          crowdInput(i, mkBody(h), held, view);
          const top = new THREE.Vector3(0, h / 2, -d).project(cam);
          const bottom = new THREE.Vector3(0, -h / 2, -d).project(cam);
          worst = Math.max(worst, Math.abs((top.y - bottom.y) / 2 - (i.share ?? NaN)));
          if (!Object.is(i.share, screenShare(h, d, fov, zoom)) || !Object.is(held.share, i.share)) exact = false;
        }
      }
    }
  }
  ok(worst < 1e-9 && exact, `the share handed to the tiers is the body's own height over the frustum's height at its distance, against a real camera, zoomed and not (worst ${worst.toExponential(2)}), screenShare's to the bit, and kept on the manager's record for the small parts and the console`);
  {
    const i = input();
    i.dist = 40;
    crowdInput(i, mkBody(), mkHeld(), { shareK: 0, now: 0 });
    ok(i.share === Infinity, 'with no perspective camera every body is taken to fill the screen, and nothing is thinned by its share');
  }
  {
    const b = mkBody();
    const i = input();
    b.engaged = true;
    b.keptForServer = true;
    crowdInput(i, b, mkHeld(), { shareK: 1, now: 0 });
    const engagedKept = i.engaged === true && i.shared === true;
    b.engaged = false;
    b.keptForServer = false;
    crowdInput(i, b, mkHeld(), { shareK: 1, now: 0 });
    ok(engagedKept && i.engaged === false && i.shared === false, "whether the body is in a fight and whether this browser keeps it for a server are the body's own, every pass");
  }
  // Standing still, judged over time. The physics moves a body only on whole sixtieths of a second (the world's fixed
  // step, with at most three a frame as the loop holds a frame to a twentieth), so at 144 frames a second a walker shows
  // no movement on most frames: a walker stepped so must never count as still, at any frame rate.
  const tune = { holdStill: 0.001, holdAfter: 0.25 };
  const walk = (fps: number, speed: number, seconds: number) => {
    const b = mkBody();
    const held = mkHeld();
    const i = input();
    i.dist = 300;
    const view: CrowdView = { shareK: shareScale(60), now: 0 };
    const dt = Math.min(1 / fps, 1 / 20);
    let acc = 0;
    let stillFrames = 0;
    let unmovedFrames = 0;
    let held0 = 0;
    const last = new THREE.Vector3().copy(b.pos);
    const frames = Math.round(seconds * fps);
    for (let f = 0; f < frames; f++) {
      view.now += dt;
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 - 1e-12 && steps < 3) {
        b.pos.x += speed / 60;
        acc -= 1 / 60;
        steps++;
      }
      if (b.pos.equals(last)) unmovedFrames++;
      last.copy(b.pos);
      crowdInput(i, b, held, view, tune);
      if (i.still) stillFrames++;
      // The tier the manager would have from it, with the client's hold on and the body tiny on the screen.
      if (lodTier({ ...i, share: 0.001 }, LOD_TUNE, undefined, { holdShare: 0.02, goneShare: 0, sharedThink: 0.4 }).animEvery === 0) held0++;
    }
    return { stillFrames, unmovedFrames, held: held0, frames };
  };
  const rates = [144, 120, 60, 30, 20];
  const walkers = rates.flatMap((fps) => [1.4, 0.1].map((speed) => ({ fps, speed, ...walk(fps, speed, 6) })));
  ok(walkers.every((w) => w.stillFrames === 0 && w.held === 0), `a walker stepped in sixtieths of a second is never judged still and never holds its pose, at ${rates.join(', ')} frames a second, walking and creeping at 0.1 m/s (${walkers.map((w) => `${w.fps}/${w.speed}: ${w.stillFrames}`).join(', ')})`);
  const fast = walkers.find((w) => w.fps === 144 && w.speed === 1.4)!;
  ok(fast.unmovedFrames > fast.frames * 0.5, `the case it guards: at 144 frames a second the walker shows no movement on ${fast.unmovedFrames} of its ${fast.frames} frames, every one of which a frame-to-frame measure would have held`);
  // A body standing: still after `holdAfter`, at every rate; one that stops: still a quarter second on; one that sets off: at once.
  const stand = (fps: number) => {
    const b = mkBody();
    const held = mkHeld();
    const i = input();
    const view: CrowdView = { shareK: 1, now: 100 };
    const dt = 1 / fps;
    let firstStill = -1;
    let start = Number.NaN;
    for (let f = 0; f < fps; f++) {
      view.now += dt;
      if (f === 0) start = view.now;
      crowdInput(i, b, held, view, tune);
      if (i.still && firstStill < 0) firstStill = view.now - start;
    }
    const restedAll = i.still && held.resting;
    b.pos.x += 0.02;
    view.now += dt;
    crowdInput(i, b, held, view, tune);
    return { firstStill, restedAll, setOff: !i.still && !held.resting };
  };
  const stands = rates.map((fps) => ({ fps, ...stand(fps) }));
  ok(stands.every((s) => s.restedAll && s.firstStill >= tune.holdAfter - 1e-9 && s.firstStill < tune.holdAfter + 1 / s.fps + 1e-9 && s.setOff), `a body standing counts as still once it has stood holdAfter, within a frame of it at every rate, and not the frame it sets off (${stands.map((s) => `${s.fps}: ${s.firstStill.toFixed(3)} s`).join(', ')})`);
  {
    const b = mkBody();
    const held = mkHeld();
    const i = input();
    const view: CrowdView = { shareK: 1, now: 50 };
    for (let f = 0; f < 120; f++) {
      view.now += 1 / 60;
      crowdInput(i, b, held, view, tune);
    }
    const wasStill = i.still;
    view.now = 3;
    crowdInput(i, b, held, view, tune);
    ok(wasStill && !i.still, 'a clock that goes back (a new world) starts the wait again rather than holding a pose on a time from before');
    b.pos.x += 0.0005;
    view.now += 0.3;
    crowdInput(i, b, held, view, tune);
    ok(i.still, "a root that strays less than holdStill from where it came to rest is still standing (the physics' own settling)");
  }
}

console.log(`\n${checks} checks passed`);
