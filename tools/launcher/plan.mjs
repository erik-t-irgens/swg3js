// From what `status --json` asks for to what is run. The list of conversions is never kept here:
// `status` is the truth and changes with the converter, so it is asked, what it asks for is run, and it
// is asked again until it asks for nothing. What lives here is only how a step's placeholders become
// the player's folders, which steps cannot run on this machine, how to tell a step that keeps being
// asked for after it has run (so a drive stops instead of looping for ever), and setting aside a file a
// killed step left half written.
//
// It is the launcher's file and the launcher's page reads `planSteps` for its list of steps, but the
// last three are the converter's driver's too (`tools/swg/convertDrive.mjs`, which `npm run swg --
// convert` runs): there is one copy of each rule, not two that can disagree.

import { renameSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** The one status format this launcher reads. */
export const STATUS_FORMAT = 1;

/** Plain words for the converter's commands, for the page. Any command not here shows its own name. */
const WORDS = {
  snapshot: 'Planets: objects, terrain, sky and flora',
  terrain: 'Ground textures',
  sky: 'Skies and weather',
  water: 'Water and lava',
  pois: 'Named places',
  creatures: 'Creatures',
  player: 'The player character',
  parts: 'The character as parts',
  'clips-save': 'Jedi Academy clips, saved',
  'clips-apply': 'Jedi Academy clips, carried over',
  species: 'Every playable species',
  wardrobe: 'The wardrobe',
  mobiles: 'Creatures, droids and NPCs',
  weapons: 'Weapons and the Force',
  ships: 'Ships',
  space: 'Space zones',
  maps: 'Planet maps and the galaxy',
  sounds: 'Sounds',
  gallery: 'The gallery',
  loading: 'Loading pictures',
};

/** The page's words for a step. */
export function labelOf(args) {
  const w = WORDS[args[0]];
  const detail = args[0] === 'wardrobe' ? args.filter((a) => a.startsWith('--gender=') || a.startsWith('--template=')).map((a) => a.replace(/^--template=.*shared_/, '').replace(/\.iff$/, '').replace(/^--gender=/, '')).join(', ') : '';
  return `${w ?? args[0]}${detail ? ` (${detail})` : ''}`;
}

/** Reads `status --json`'s output, refusing anything that is not the format this launcher knows. */
export function readStatus(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('status printed no JSON');
  const json = JSON.parse(text.slice(start));
  if (json.format !== STATUS_FORMAT) throw new Error(`status answered format ${json.format}; this launcher reads ${STATUS_FORMAT}`);
  if (!Array.isArray(json.steps)) throw new Error('status answered no steps');
  return json;
}

/** One argument with `@SWG` and `@JKA` put back as the chosen folders, whole or after an `=`. */
function fill(arg, folders) {
  return arg.replace(/(^|=)@(SWG|JKA)$/, (whole, before, name) => before + (name === 'SWG' ? folders.swg : folders.jka));
}

/**
 * The steps `status` asked for, ready to run: the folders filled in, `--jka=` added to a command that
 * takes it when Jedi Academy was chosen, `--retail-only` made certain on anything that reads the
 * archives, and the ones that need Jedi Academy marked (not dropped) when it was not chosen. Two steps
 * that come out the same are one, keeping both sets of reasons.
 */
export function planSteps(status, folders) {
  const out = [];
  const byKey = new Map();
  for (const s of status.steps) {
    if (s.jka === 'needs' && !folders.jka) {
      out.push({ args: s.args.slice(), key: s.args.join('\u0000'), label: labelOf(s.args), reason: s.reason, skip: 'needs a Jedi Academy folder' });
      continue;
    }
    const args = s.args.map((a) => fill(a, folders));
    if (s.jka === 'takes' && folders.jka && !args.some((a) => a.startsWith('--jka='))) args.push(`--jka=${folders.jka}`);
    if (args.includes(folders.swg) && !args.includes('--retail-only')) args.push('--retail-only');
    const key = args.join('\u0000');
    const had = byKey.get(key);
    if (had) {
      had.reason = had.reason === s.reason ? had.reason : `${had.reason}; ${s.reason}`;
      continue;
    }
    const step = { args, key, label: labelOf(args), reason: s.reason };
    byKey.set(key, step);
    out.push(step);
  }
  return out;
}

/**
 * The steps worth running now, given what has been run in this drive (`history`: key to `{ runs,
 * reason, failed }`), in the order they were asked for. A step is passed over when it cannot run here,
 * when it failed in this drive, or when it is asked for again for exactly the reasons it was asked for
 * before it last ran: running it again would change nothing, so the drive says so rather than looping.
 * `stuck` collects those.
 */
export function runnableSteps(steps, history, stuck = []) {
  const out = [];
  for (const s of steps) {
    if (s.skip) continue;
    const h = history.get(s.key);
    if (h?.failed) continue;
    if (h && (h.reason === s.reason || h.runs >= 3)) {
      if (!stuck.some((x) => x.key === s.key)) stuck.push(s);
      continue;
    }
    out.push(s);
  }
  return out;
}

/** The first of those, or null: what a drive that runs one step at a time asks for. */
export function nextStep(steps, history, stuck = []) {
  return runnableSteps(steps, history, stuck)[0] ?? null;
}

/**
 * Sets aside the files `status --json` could not read (`unreadable`): each is renamed beside itself to
 * `<name>.cut-<time>`, never deleted, so the step that writes it starts clean and nothing is lost. Only a
 * file inside the converted content's own folder is touched. Returns how many were moved, or why it
 * could not go on (a sentence for the page).
 */
export function setAside(files, outDir, say = () => {}, when = Date.now()) {
  const list = Array.isArray(files) ? files : [];
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const root = fold(resolve(outDir)) + sep;
  let moved = 0;
  for (const f of list) {
    if (typeof f !== 'string' || !f) continue;
    const full = resolve(f);
    if (!fold(full).startsWith(root)) return { moved, failed: `Status named a file outside the converted content (${f}); nothing was run.` };
    const to = `${full}.cut-${when}`;
    try {
      renameSync(full, to);
      moved++;
      say(`set aside ${full} as ${to}: it was cut short while it was written, so the step that writes it runs again`, 'note');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      return { moved, failed: `${full} was cut short while it was written and could not be set aside (${err.code ?? err.message}). Move it somewhere else and press Convert again.` };
    }
  }
  return { moved, failed: null };
}