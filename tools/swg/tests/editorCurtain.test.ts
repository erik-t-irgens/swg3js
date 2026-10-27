// The world editor's short curtain (Map-maker II, DESIGN.md §2.9 item 9, W3: factored out of Fold now), and what hangs on it:
//
//   1. `runCurtain`, the order every curtain keeps, driven over stand-ins of the game's pieces: the game held and the screen
//      shown before anything, the screen's paint, the work, the world round the eye waited for (bounded, its progress said),
//      the sweep, the queue flushed and its programs sampled, the screen hidden and the game let go; a work that throws
//      still hides the screen and lets the game go, and builds nothing; the bound kept when the world never settles;
//   2. Fold now through the factored curtain answers what it answered before: its work the very refile it ran, its words
//      the very words (`foldRows.test.ts` holds the streamer's refile itself), and the curtain's hold and let-go the very
//      game state Fold now set and put back;
//   3. the third wave's other user, a family of another world lent in play: the editor's paint brush asks the game
//      (`lendGround`), the game asks the curtain over `World.lendInPlay`, and nothing else of the game lends in play;
//   4. the minimap kept clear of the editor's window (Map-maker I's open item): the window docks under the display's
//      top-left block by the very sum the help block stands by, only while the minimap shows.
//
// Run: node tools/swg/tests/editorCurtain.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURTAIN_TUNE, runCurtain, type CurtainDeps } from '../../../src/world/curtain.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** Stand-ins of the game's pieces, writing down every call in order; a clock moved only by the waits. */
function stand(settleAfter: number): { d: CurtainDeps; log: string[]; clock: { t: number } } {
  const log: string[] = [];
  const clock = { t: 1000 };
  let asked = 0;
  const d: CurtainDeps = {
    hold: () => log.push('hold'),
    release: () => log.push('release'),
    show: (w, x) => log.push(`show ${w} | ${x}`),
    setWhat: (w) => log.push(`what ${w}`),
    setProgress: (p) => log.push(`progress ${p.toFixed(2)}`),
    hide: async () => {
      log.push('hide');
    },
    settled: () => {
      asked++;
      log.push('settled?');
      return asked > settleAfter;
    },
    progress: () => ({ total: 0.5, stage: 'tiers' }),
    compile: async () => {
      log.push('compile');
      return 7;
    },
    flush: async () => {
      log.push('flush');
    },
    sample: () => log.push('sample'),
    now: () => clock.t,
    wait: async (ms) => {
      log.push(`wait ${ms}`);
      clock.t += ms;
    },
  };
  return { d, log, clock };
}

// ---------------------------------------------------------------- 1. the order

{
  const { d, log } = stand(2);
  const r = await runCurtain(d, 'folding the placed rows', '3 rows into their tiers', () => {
    log.push('work');
    return 'done';
  });
  const order = log.map((l) => l.split(' ')[0]).join(',');
  ok(order === 'hold,show,wait,work,settled?,progress,what,wait,settled?,progress,what,wait,settled?,what,compile,flush,sample,hide,release', `the game held and the screen shown first, painted before the work, the world waited for with its progress said, the sweep, the flush, the sample, the screen hidden and the game let go, in that order (${order})`);
  ok(log[1] === 'show folding the placed rows | 3 rows into their tiers' && log[2] === `wait ${CURTAIN_TUNE.paintMs}` && log.includes('what loading tiers') && log.includes('what compiling shaders'), 'the screen says what it is for and on what, and its stages in words');
  ok(r.answer === 'done' && r.compiled === 7 && r.ms === CURTAIN_TUNE.paintMs + 2 * CURTAIN_TUNE.pollMs, `it answers the work's answer, the programs the sweep built and how long it was up (${r.ms} ms)`);
}
{
  const { d, log } = stand(0);
  let thrown = false;
  try {
    await runCurtain(d, 'w', 'd', async () => {
      log.push('work');
      throw new Error('the work failed');
    });
  } catch (err) {
    thrown = (err as Error).message === 'the work failed';
  }
  ok(thrown && log.slice(-2).join() === 'hide,release' && !log.includes('compile'), 'a work that throws comes out after the screen is hidden and the game let go, and builds nothing');
}
{
  const { d, log, clock } = stand(Infinity);
  const t0 = clock.t;
  await runCurtain(d, 'w', 'd', () => 1);
  const polls = log.filter((l) => l === 'settled?').length;
  ok(clock.t - t0 >= CURTAIN_TUNE.settleMs && clock.t - t0 < CURTAIN_TUNE.settleMs + CURTAIN_TUNE.paintMs + 2 * CURTAIN_TUNE.pollMs && log.includes('compile') && log.at(-1) === 'release', `a world that never settles is waited for ${CURTAIN_TUNE.settleMs} ms and no longer (${polls} asks), and the sweep still runs`);
}

// ---------------------------------------------------------------- 2. Fold now through it

const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
function method(text: string, head: string): string {
  const at = text.indexOf(head);
  if (at < 0) return '';
  const next = text.indexOf('\n  /**', at + head.length);
  return text.slice(at, next < 0 ? undefined : next);
}
{
  const fold = method(main, '  private async editorFold(): Promise<string> {');
  ok(/const r = await this\.editorCurtain\('folding the placed rows', `\$\{before\.rows\} rows into their tiers`, \(\) => \{\s*this\.world\.refilePlaced\(ls\.filing, \{ force: true \}\);\s*ls\.update\(this\.player\.worldPos, this\.world\.cameraRoom\.building\);\s*\}\);/.test(fold), "Fold now's work behind the curtain is the very refile it ran before (every tier filed again with `force`, the streamer moved round the eye)");
  ok(fold.includes('return `folded: ${before.rows - after.rows} of ${before.rows} rows into their tiers (${after.rows} still one by one), ${r?.compiled ?? 0} programs built behind the screen, ${r?.ms ?? 0} ms`;'), 'and answers in the very words it answered before');
  ok(!/this\.loadingScreen\.show\(|this\.traveling = |this\.curtainOnly = /.test(fold), 'and keeps no screen or game state of its own: the curtain is the one place that does');
  const curtain = method(main, '  private async editorCurtain<T>(');
  ok(/if \(!import\.meta\.env\.DEV\) return null;/.test(curtain) && /return runCurtain\(/.test(curtain), "the game's curtain is the dev server's alone and runs the order above (`runCurtain`)");
  ok(/hold: \(\) => \{\s*this\.traveling = true;\s*this\.curtainOnly = true;\s*this\.map\.hide\(\);\s*held = this\.input\.captured;\s*this\.input\.captured = false;\s*\}/.test(curtain) && /release: \(\) => \{\s*this\.traveling = false;\s*this\.curtainOnly = false;\s*this\.input\.captured = held;\s*\}/.test(curtain), 'it holds and lets go the very game state Fold now did: travelling, a curtain alone, the map put away, the mouse let go and given back as it was');
  ok(/if \(this\.editor\?\.on && \(\(this\.traveling && !this\.curtainOnly\) \|\| !this\.inWorld\)\) this\.editor\.worldGone\(\);/.test(main), "and the editor stays on through it, its selection and its history kept (the frame let the editor go with its world at any `traveling`, and every curtain of its own turned it off: found by this wave's smoke)");
  ok(/show: \(w, d\) => this\.loadingScreen\.show\(this\.world\.planet, w, d\)/.test(curtain) && /hide: \(\) => this\.loadingScreen\.hide\(\{ quick: LOADING_TUNE\.quickHide \}\)/.test(curtain) && /settled: \(\) => this\.world\.settled\(this\.player\.worldPos\)/.test(curtain) && /compile: \(\) => this\.world\.compileAllAsync\(\(\) => \{ \}\)/.test(curtain) && /flush: \(\) => this\.world\.flushPrograms\(\)/.test(curtain) && /sample: \(\) => this\.sampleShaders\('loading'\)/.test(curtain), "and hands it the game's own screen, settle, sweep, flush and sample");
}

// ---------------------------------------------------------------- 3. a family lent in play

{
  ok(/lendGround: \(pack, name\) => this\.editorLend\(pack, name\),/.test(main), 'the game hands the editor its lending (`lendGround`)');
  const lend = method(main, '  private async editorLend(pack: string, name: string): Promise<string | null> {');
  ok(/const r = await this\.editorCurtain\("lending another world's ground", `\$\{pack\}'s \$\{name\}`, \(\) => this\.world\.lendInPlay\(pack, name\)\);/.test(lend) && /if \(!import\.meta\.env\.DEV\)/.test(lend), "and lends a family behind the curtain, over `World.lendInPlay`, the dev server's alone");
  const ed = readFileSync(join(REPO, 'src/editor/editorEntry.ts'), 'utf8');
  ok(/lend: \(pack, name\) => h\.lendGround\(pack, name\),/.test(ed) && /lent: \(pack, name\) => w\.lentHere\(pack, name\),/.test(ed), "the paint brush asks the game to lend (`PaintHost.lend`) and whether a family is lent already");
  const callers = [...main.matchAll(/this\.world\.lendInPlay\(/g)].length + [...ed.matchAll(/lendInPlay\(/g)].length;
  ok(callers === 1, `nothing else lends in play: \`lendInPlay\` is called once, behind the curtain (${callers})`);
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8');
  const inPlay = method(world, '  async lendInPlay(pack: string, name: string): Promise<string | null> {');
  ok(inPlay.indexOf('lendInto(group, l.plan);') > 0 && inPlay.indexOf('this.terrain.swg?.postLent();') > inPlay.indexOf('lendInto(group, l.plan);') && inPlay.indexOf('await this.loadGroundTextures(') > inPlay.indexOf('postLent()') && /const no = appendLending\(l\.plan, table, pack, name, GROUND_FIRST_CHILD_ONLY\);/.test(inPlay), "a family lent in play is appended after every one lent (`appendLending`), lent the group, handed to the worker and its pictures put in the arrays, in that order");
}

// ---------------------------------------------------------------- 4. the minimap and the editor's window

{
  const win = readFileSync(join(REPO, 'src/ui/editorWindow.ts'), 'utf8');
  const hud = readFileSync(join(REPO, 'src/ui/hud.css'), 'utf8');
  const help = /#hud\.minimap-on \.help \{ top: calc\(12px \+ (\d+)px \* var\(--hud-scale\)\); \}/.exec(hud);
  const dock = /#hud\.minimap-on ~ \.ed-panel \{ top: calc\((\d+)px \+ (\d+)px \* var\(--hud-scale\)\); max-height: calc\(100vh - (\d+)px - (\d+)px \* var\(--hud-scale\)\); \}/.exec(win);
  ok(!!help && !!dock && dock[2] === help[1] && dock[4] === help[1] && Number(dock[1]) === 12 + 8 && Number(dock[3]) > Number(dock[1]), `while the minimap shows, the editor's window docks under the top-left block by the very sum the help block stands by (12 + ${help?.[1]} on the HUD scale, and a gap of 8), no taller than what is left; with the minimap off the window's own place (the selector asks for \`minimap-on\`)`);
  const css = /const EDITOR_WINDOW_CSS = `([\s\S]*?)`;/.exec(win)?.[1] ?? '';
  ok(!/#hud\.minimap-on (\.|#)(?!help)[^{]*\{/.test(css.replace(/#hud\.minimap-on ~ \.ed-panel/g, '')), "and nothing of the minimap's own block is restyled by the editor");
}

console.log(`\neditorCurtain: ${checks} checks passed`);
