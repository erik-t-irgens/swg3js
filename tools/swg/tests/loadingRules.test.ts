// The loading screens' own rules (the performance pass's first wave), checked without a browser: when the sweep that
// compiles the scene waits a frame, whether a race start needs a curtain at all and why and the counts it is made of,
// how a course curtain's loads are bounded, where a place on another world stands in the game's frame before that
// world loads (its places file's centre read, and held to `App.teleport`'s own two lines, read as text out of main.ts
// and run, since node cannot load main.ts), whether two centres agree, when the screen covers the picture, what was
// built after a screen for the bodies it had up, the tune's guard, and the record of the last trip's screens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centreAgrees, courseCounts, LOADING_TUNE, LoadingLog, loadBounded, opaqueAt, placeFromPois, poisCentreOf, programsForUp, raceCurtainNeed, SCREEN_FADE_MS, sweepYield, tuneLoading } from '../../../src/world/loadingTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the sweep's frame waits ---------------------------------------------------------------------------------------

{
  ok(sweepYield(0, 0, false, 10) && sweepYield(5, 0, false, 10) && sweepYield(0, 1000, false, 10), 'in play every batch waits a frame, as it always did (the Effects switch draws the old picture meanwhile)');
  ok(sweepYield(1, 0, true, 10), 'behind a screen a batch that built a program waits a frame, so the bar shows it');
  ok(!sweepYield(0, 9.9, true, 10), 'behind a screen a batch that built nothing, within the slice, goes straight on');
  ok(sweepYield(0, 10, true, 10), 'and the slice spent, it waits a frame however little was built');
  ok(sweepYield(0, 0, true, 0), 'a slice of nought is the old frame per batch, for comparing');
  ok(LOADING_TUNE.sliceMs === 10 && LOADING_TUNE.standWaitMs === 8000 && LOADING_TUNE.drawEveryMs === 100 && LOADING_TUNE.courseNear === 64, 'the numbers the design starts from');
}

// --- the race start's need test ------------------------------------------------------------------------------------

{
  const fine = { hullToGrid: 10, settled: true, pending: 0, missing: 0, unwarmed: 0 };
  ok(raceCurtainNeed(fine).need === 'none', 'beside the grid with everything in: no curtain');
  ok(raceCurtainNeed({ ...fine, hullToGrid: LOADING_TUNE.courseNear }).need === 'none', 'at exactly courseNear it is still beside the grid');
  const far = raceCurtainNeed({ ...fine, hullToGrid: LOADING_TUNE.courseNear + 1 });
  ok(far.need === 'course' && /from the grid/.test(far.why), `farther than courseNear is a course curtain (${far.why})`);
  ok(raceCurtainNeed({ ...fine, hullToGrid: Number.NaN }).need === 'course', 'a distance that is not a number is never beside the grid');
  ok(/ground/.test(raceCurtainNeed({ ...fine, settled: false }).why), 'the grid not settled');
  ok(/not loaded/.test(raceCurtainNeed({ ...fine, missing: 3 }).why), 'a course model not loaded');
  ok(/not warmed/.test(raceCurtainNeed({ ...fine, unwarmed: 1 }).why), 'one loaded and not warmed');
  ok(/queued/.test(raceCurtainNeed({ ...fine, pending: 2 }).why), 'programs still queued');
  // The order: the first reason that holds is the one given.
  const all = { hullToGrid: 500, settled: false, pending: 4, missing: 2, unwarmed: 1 };
  ok(/from the grid/.test(raceCurtainNeed(all).why), 'the hull far comes first');
  ok(/ground/.test(raceCurtainNeed({ ...all, hullToGrid: 1 }).why), 'then the grid not settled');
  ok(/not loaded/.test(raceCurtainNeed({ ...all, hullToGrid: 1, settled: true }).why), 'then a model not loaded');
  ok(/not warmed/.test(raceCurtainNeed({ ...all, hullToGrid: 1, settled: true, missing: 0 }).why), 'then a model not warmed');
  ok(/queued/.test(raceCurtainNeed({ ...all, hullToGrid: 1, settled: true, missing: 0, unwarmed: 0 }).why), 'then the queue');
  ok(raceCurtainNeed({ ...fine, hullToGrid: 100 }, 200).need === 'none', 'the near distance is the caller\'s to hand in');
}

// --- the counts the need test is made of ---------------------------------------------------------------------------

{
  // Five models along a course: one not loaded, one known not to load, one loaded and warmed whole outdoors, one
  // loaded and warmed whole by its materials but with a copy indoors, and one loaded and warmed by a course before.
  const models = new Map<string, boolean>([
    ['cold', false],
    ['broken', false],
    ['street', false],
    ['hallChair', true],
    ['done', true],
  ]);
  const loaded = new Set(['street', 'hallChair', 'done']);
  const failedIds = new Set(['broken']);
  const warmedIds = new Set(['done']);
  const asked: string[] = [];
  const look = {
    loaded: (id: string) => (loaded.has(id) ? { id } : null),
    failed: (id: string) => failedIds.has(id),
    warmed: (id: string) => warmedIds.has(id),
    warmedWhole: (m: { id: string }) => {
      asked.push(m.id);
      return true;
    },
  };
  const c = courseCounts(models, look);
  ok(c.missing === 1, `a model neither loaded nor known not to load is missing (${c.missing})`);
  ok(c.failed === 1, 'one known not to load is counted apart, never as missing, so a broken file asks for no curtain on every start');
  ok(c.unwarmed === 1, `a model with a copy indoors is never warmed whole, whatever its materials say (${c.unwarmed})`);
  ok(!asked.includes('hallChair') && asked.includes('street'), 'and its materials are not even asked; an outdoor one is');
  ok(!asked.includes('done'), 'one warmed for a course this session is warmed, asked nothing more');
  warmedIds.clear();
  const again = courseCounts(models, look);
  ok(again.unwarmed === 2, 'and with the memo forgotten (another streamer) the same model is unwarmed again');
  const cold = courseCounts(models, { ...look, warmedWhole: () => false });
  ok(cold.unwarmed === 3, 'an outdoor model whose materials are not all adopted is unwarmed');
  const need = raceCurtainNeed({ hullToGrid: 1, settled: true, pending: 0, ...courseCounts(new Map([['broken', false]]), look) });
  ok(need.need === 'none', 'a course whose only trouble is a file that will never load goes with no curtain');
}

// --- a parsed pois.json's centre ------------------------------------------------------------------------------------

{
  ok(JSON.stringify(poisCentreOf({ center: { x: -1376, z: -3576 }, pois: [] })) === '{"x":-1376,"z":-3576}', 'a good file gives its centre');
  ok(poisCentreOf({ pois: [] }) === null, 'a file with no centre gives none');
  ok(poisCentreOf({ center: null }) === null && poisCentreOf({ center: 4 }) === null, 'nor one whose centre is not an object');
  ok(poisCentreOf({ center: { x: '-1376', z: -3576 } }) === null && poisCentreOf({ center: { x: 1 } }) === null, 'nor one whose coordinates are not both numbers');
  ok(poisCentreOf({ center: { x: Number.NaN, z: 0 } }) === null && poisCentreOf({ center: { x: 0, z: Number.POSITIVE_INFINITY } }) === null, 'nor one that is not finite');
  ok(poisCentreOf(null) === null && poisCentreOf('x') === null, 'and nothing at all gives none');
  const galaxy = readFileSync(new URL('../../../src/ui/galaxyMap.ts', import.meta.url), 'utf8');
  ok(/return \{ center: poisCentreOf\(data\), pois:/.test(galaxy), "and the galaxy map's file reader reads the centre through it");
}

// --- when the screen covers the picture -----------------------------------------------------------------------------

{
  ok(!opaqueAt(true, false, 1000, 1000 + SCREEN_FADE_MS - 1), 'while it fades in the screen does not cover the picture');
  ok(opaqueAt(true, false, 1000, 1000 + SCREEN_FADE_MS), 'once its fade is over it does');
  ok(!opaqueAt(true, true, 1000, 1000 + SCREEN_FADE_MS * 10), 'and from the moment it begins to go away it does not, so the reveal is drawn every frame');
  ok(!opaqueAt(false, false, 1000, 99999), 'a screen not shown covers nothing');
  ok(SCREEN_FADE_MS === 500, "the fade is the stylesheet's own half second");
  const loading = readFileSync(new URL('../../../src/ui/loading.ts', import.meta.url), 'utf8');
  ok(/return opaqueAt\(this\.visible, this\.hiding, this\.shownAt, performance\.now\(\)\);/.test(loading), "and the screen's own `opaque` answers through it");
}

// --- a course curtain's loads, bounded -----------------------------------------------------------------------------

{
  // A load that never settles: the bound returns.
  const never = (): Promise<unknown> => new Promise(() => undefined);
  let slept = -1;
  const sleep = (ms: number): Promise<void> => {
    slept = ms;
    return Promise.resolve();
  };
  const r = await loadBounded(['a', 'b', 'c'], never, () => true, 2, 4000, sleep);
  ok(r.loaded === 0 && slept === 4000, `a load that never settles cannot hold the curtain open: the bound answers (${JSON.stringify(r)})`);
  // Loads that settle are counted, at most `lanes` at once.
  let running = 0;
  let most = 0;
  const quick = async (): Promise<void> => {
    running++;
    most = Math.max(most, running);
    await new Promise((res) => setTimeout(res, 2));
    running--;
  };
  const r2 = await loadBounded(['a', 'b', 'c', 'd', 'e'], quick, () => true, 2, 0, () => new Promise((res) => setTimeout(res, 1000)));
  ok(r2.loaded === 5 && most === 2, `every load that settles inside the bound is counted, two lanes at a time (${r2.loaded}, at most ${most} at once)`);
  // One that throws is no reason to stop.
  const r3 = await loadBounded(['bad', 'good'], async (id) => {
    if (id === 'bad') throw new Error('no such file');
  }, () => true, 1, 0, () => new Promise((res) => setTimeout(res, 1000)));
  ok(r3.loaded === 1, 'a load that throws is stepped over and the next one goes on');
  // The screen gone: no new load begins.
  const started: string[] = [];
  let on = true;
  const r4 = await loadBounded(['x', 'y', 'z'], async (id) => {
    started.push(id);
    on = false;
  }, () => on, 1, 0, () => new Promise((res) => setTimeout(res, 1000)));
  ok(started.join(',') === 'x' && r4.loaded === 1, 'once `keepOn` says no (the screen gone, another world), no further load begins');
}

// --- what was built after a screen for the bodies it had up --------------------------------------------------------

{
  // Two bodies' materials sharing one program (a crowd's look), a third with a program built before the lift, one
  // built after the window, and one with no record at all.
  const prog = (id: number) => ({ id });
  const shared = prog(12);
  const records = new Map<string, { id: number }[]>([
    ['skin', [prog(5), shared]],
    ['shirt', [shared, prog(13)]],
    ['boots', [prog(9)]],
    ['late', [prog(40)]],
  ]);
  const names: string[] = [];
  const n = programsForUp(['skin', 'shirt', 'boots', 'late', 'none'], 10, 20, (m) => records.get(m) ?? null, (m) => m, names);
  ok(n === 2, `only programs past the lift and inside the window count, each once however many materials share it (${n})`);
  ok(names.join(',') === 'skin,shirt', `and the materials they were built for are named (${names.join(',')})`);
  ok(programsForUp(['skin'], 12, 20, (m) => records.get(m) ?? null) === 0, 'the lift\'s own highest is not past itself');
  ok(programsForUp(['late'], 10, 40, (m) => records.get(m) ?? null) === 1, 'and the window\'s highest is inside it');
}

// --- a place out of pois.json, held to App.teleport's own arithmetic ------------------------------------------------

{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const gxLine = /const gx = (-\(poi\.x - c\.x\));/.exec(main);
  const gzLine = /const gz = (poi\.z - c\.z);/.exec(main);
  ok(!!gxLine && !!gzLine, "teleport's own two lines are found in main.ts");
  // The very expressions, run on sample rows.
  const teleportX = new Function('poi', 'c', `return ${gxLine![1]};`) as (poi: { x: number }, c: { x: number }) => number;
  const teleportZ = new Function('poi', 'c', `return ${gzLine![1]};`) as (poi: { z: number }, c: { z: number }) => number;
  const rows = [
    { c: { x: -1376, z: -3576 }, poi: { x: -1218, z: -3688 } },
    { c: { x: 0, z: 0 }, poi: { x: 3528, z: -4804 } },
    { c: { x: 512.5, z: -77.25 }, poi: { x: -0.5, z: 12345.75 } },
    { c: { x: -4000, z: 4000 }, poi: { x: -4000, z: 4000 } },
  ];
  let same = 0;
  for (const r of rows) {
    const g = placeFromPois(r.c, r.poi);
    if (Object.is(g.x, teleportX(r.poi, r.c)) && Object.is(g.z, teleportZ(r.poi, r.c))) same++;
  }
  ok(same === rows.length, `placeFromPois is teleport's own arithmetic on every sample row (${same} of ${rows.length})`);
  ok(/placeFromPois\(centre, poi\)/.test(main), 'and the single pass places with it');
}

// --- two centres agreeing ------------------------------------------------------------------------------------------

{
  const c = { x: -1376, z: -3576 };
  ok(centreAgrees(c, { x: -1376, z: -3576 }, 0.5), 'equal centres agree');
  ok(centreAgrees(c, { x: -1375.5, z: -3576.5 }, 0.5), 'within the slack in both, at its very edge, they agree');
  ok(!centreAgrees(c, { x: -1375.49, z: -3576 }, 0.5), 'just past it in x they do not');
  ok(!centreAgrees(c, { x: -1376, z: -3575.4 }, 0.5), 'nor in z');
  ok(!centreAgrees(c, null, 0.5) && !centreAgrees(null, c, 0.5), 'a centre missing agrees with nothing');
  ok(!centreAgrees(c, { x: Number.NaN, z: -3576 }, 0.5), 'nor one that is not a number');
}

// --- the tune ------------------------------------------------------------------------------------------------------

{
  const was = { ...LOADING_TUNE };
  let words = tuneLoading({ sliceMs: 0 });
  ok(words.length === 0 && LOADING_TUNE.sliceMs === 0, 'a slice of nought can be asked for, for comparing');
  words = tuneLoading({ nope: 1, standWaitMs: 'x', screenDraws: 3, drawEveryMs: 1e9 } as never);
  ok(words.length === 4 && !('nope' in LOADING_TUNE), `names refused and values held, in words (${words.join('; ')})`);
  ok(LOADING_TUNE.drawEveryMs === 5000 && LOADING_TUNE.screenDraws === was.screenDraws, 'a number held to its range, a switch left as it was when handed a number');
  tuneLoading({ screenDraws: false });
  ok(LOADING_TUNE.screenDraws === false, 'a switch takes a boolean');
  tuneLoading(was);
  ok(JSON.stringify(LOADING_TUNE) === JSON.stringify(was), 'and everything can be put back');
}

// --- the record of the last trip's screens -------------------------------------------------------------------------

{
  const log = new LoadingLog();
  log.on('NABOO TO TATOOINE', 1000, 10);
  log.what('loading ground', 1000);
  log.what('loading ground', 1100);
  log.what('building shaders, 3 new', 2000);
  log.what('building shaders, 4 new', 2500);
  log.what('the people here, 3 of 9', 3000);
  log.sweep(4, 812.4);
  log.bodies({ want: 9, refused: 2, up: 7, stood: 7, loading: 1 });
  log.off(5000, 40);
  const s = log.screens[0];
  ok(log.screens.length === 1 && s.title === 'NABOO TO TATOOINE' && s.s === 4, 'a screen is kept with its title and length');
  ok(s.phases.length === 3 && s.phases[0].words === 'loading ground' && s.phases[1].words === 'building shaders, # new' && s.phases[1].s === 1, `its phases are the words it said, numbers folded (${s.phases.map((p) => `${p.words} ${p.s}`).join(' / ')})`);
  ok(s.programs === 30 && s.sweep?.programs === 4 && s.sweep.ms === 812, 'the whole screen\'s programs and the sweep\'s own');
  ok(s.bodies?.up === 7 && s.bodies.want - s.bodies.refused === 7, 'the bodies up against the want less the refusals');
  log.on('MOS EISLEY', 6000, 40);
  log.off(7000, 41);
  ok(log.screens.length === 2, 'a screen up within moments of the last is the same trip');
  log.on('BESTINE', 20000, 41);
  log.bodies({ want: 3, refused: 0, up: 2, stood: 3, loading: 1 });
  log.off(21000, 41, 300);
  ok(log.screens.length === 1 && log.screens[0].title === 'BESTINE', 'one up long after the last starts a trip of its own');
  ok(log.inWindow(21100) && !log.inWindow(20999) && log.afterEnds === 21000 + LOADING_TUNE.afterS * 1000, 'the window after it runs from the lift for afterS');
  // The window after it: frames, the queue's look count and the highest program id, numbers only.
  log.frame(16, 21016, 5, 302);
  log.frame(250, 21266, 6, 305);
  log.frame(16, 21282, 8, 304);
  log.frame(500, 21000 + LOADING_TUNE.afterS * 1000 + 1, 99, 400);
  const a = log.after(21300)!;
  ok(a.frames === 3 && a.worstMs === 250 && a.over100 === 1 && a.people === 3, `the window counts its frames, the worst, those past 100 ms and the people's programs (${JSON.stringify(a)})`);
  ok(a.afterBound === 1, 'and the bodies the screen\'s bound left still loading');
  ok(a.idFrom === 300 && a.idTo === 305, 'and the program ids it holds the bodies\' programs to: the lift\'s highest, and the highest any frame inside it saw, never one after');
  log.on('NEXT', 25000, 41);
  ok(log.afterEnds === Number.NEGATIVE_INFINITY && !log.inWindow(25001), 'a screen going up ends the window');
  log.off(25100, 41);
  log.curtain('none', 30000);
  ok(log.screens[log.screens.length - 1].curtain === 'none' && log.screens[log.screens.length - 1].title === '(no screen)', 'a race start with no curtain is a record of its own with no screen');
  log.on('DUNE LOOP', 30100, 41);
  log.curtain('course (2 of the course\'s models are not loaded)', 30200, { models: 40, loaded: 2, left: 0, compiled: 5 });
  log.off(31000, 46);
  const c = log.screens[log.screens.length - 1];
  ok(c.curtain?.startsWith('course') && c.course?.compiled === 5, 'a course curtain sits on its screen with what it loaded and compiled');
}

console.log(`\nloadingRules: ${checks} checks passed`);
