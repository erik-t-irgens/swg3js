// The tunes as 62143fe shipped them (wave 2a and its fixes), before the owner's first look of 2026-11-15: every new
// switch at its 'before' and the paces at the speeds they were started at. The suites written for that wave hold their
// numbers under these; the polish's own suites (locoPolish.test.ts, animPolish.test.ts, jkaSpine.test.ts) hold the new
// rules and hold these against 62143fe's own modules out of git. Not a test itself.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ANIM_TUNE_SHIPPED, type AnimTune } from '../../../src/anim/animTune.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * Today's named files with some of their text changed (a mutation of the new code), written side by side into a
 * temporary folder and the entries imported, every relative import among the named files pointed at its copy and every
 * other at today's file: how a test shows that its check fails when the rule it holds is broken. Each edit must find
 * its text, or this throws (a mutation that changes nothing proves nothing).
 */
export async function loadMutant(files: readonly string[], entries: readonly string[], edits: readonly { file: string; from: string; to: string }[]): Promise<Record<string, unknown>[]> {
  const dir = mkdtempSync(join(tmpdir(), 'polish-mutant-'));
  const where = (f: string) => join(dir, f.replace(/\//g, '__'));
  try {
    for (const f of files) {
      let text = readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
      for (const e of edits.filter((x) => x.file === f)) {
        if (!text.includes(e.from)) throw new Error(`a mutation of ${f} found nothing to change: ${e.from}`);
        text = text.replace(e.from, e.to);
      }
      const from = resolve(REPO, f, '..');
      text = text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
        const target = resolve(from, p).replace(/\\/g, '/');
        const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target || resolve(REPO, x).replace(/\\/g, '/') === `${target}.ts`);
        return `from '${own ? pathToFileURL(where(own)).href : pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href}'`;
      });
      writeFileSync(where(f), text);
    }
    const out: Record<string, unknown>[] = [];
    for (const e of entries) out.push((await import(pathToFileURL(where(e)).href)) as Record<string, unknown>);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The commit the polish's day-one tests load their old modules from. */
export const BEFORE_POLISH = '62143fe';

/** The paces' speeds as they were started (91e62d9, unchanged by 62143fe). */
export const STARTED_SPEEDS: LocoTune['speed'] = {
  forward: { walk: 1.44, jog: 2.85, tired: 2.38, run: 4.9, sprint: 6.35 },
  back: { walk: 1.28, jog: 2.25, run: 2.93 },
  side: { walk: 0.59, jog: 2.89, run: 4.33 },
  forwardDiag: { walk: 1.67, jog: 2.66, run: 4.33 },
  backDiag: { walk: 1.28, jog: 2.18, run: 2.93 },
};

/** The speed classes' tune at 62143fe: the speeds as started, the slow strafe sideways, every gun's split carry, every pace's clip locked. */
export function beforeLocoTune(): LocoTune {
  const t = JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
  t.speed = JSON.parse(JSON.stringify(STARTED_SPEEDS)) as LocoTune['speed'];
  t.sideWalkClip = 'strafe';
  t.gunCarry = { pistol: 'split', carbine: 'split', rifle: 'split', heavy: 'split' };
  t.rate.byClass = { walk: 1, jog: 1, run: 1, sprint: 1 };
  return t;
}

/** The imported clips' tune at 62143fe: the air, the water and the Jedi Academy spine each at 'before'. */
export function beforeAnimTune(): AnimTune {
  const t = JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED)) as AnimTune;
  t.airRule = 'before';
  t.swim.rule = 'before';
  t.jkaSpine = 'before';
  return t;
}
