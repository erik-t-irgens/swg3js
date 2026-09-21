// `status --json`: what `status` asks for, for a program rather than a person. The human report is
// untouched; this turns its to-do (a command line and the reasons for it) into steps with their
// arguments already split, so a caller never has to parse a sentence or guess where a path with
// spaces in it ends. The launcher runs these in order and asks again until there are none.
//
// Nothing here reads the archives or the packs: it is handed the to-do `status` built.

/** Bumped when the shape of the JSON changes in a way a reader must know about. */
export const STATUS_FORMAT = 1;

/**
 * Commands that accept a Jedi Academy folder (`--jka=`) and are better for it. `player` drops the
 * saber, jump and roll clips without one (the README says to pass it always once you have it), and
 * `sounds` takes Jedi Academy's saber sounds and animation marks with it. A step for one of these
 * that does not carry the flag is marked `jka: 'takes'`, and a caller with the folder adds it.
 */
export const TAKES_JKA = new Set(['player', 'sounds', 'gallery']);

/** The placeholders `status` writes for the two install folders, as the converter's own `@NAME`s. */
const PLACEHOLDERS = [
  [/<swg-dir>/g, '@SWG'],
  [/<jka-dir>|<jedi-academy-gamedata>/g, '@JKA'],
];

/**
 * One command line of `status`'s to-do as its arguments. The output folder is written into the line
 * whole and may hold spaces, so every occurrence of it is protected before the line is split on
 * spaces and put back after. `dir` must be the exact text `status` was given (resolved), since
 * `join(dir, ...)` begins with it character for character.
 */
export function splitCommand(text, dir) {
  const mark = '\u0001';
  const marked = dir ? text.split(dir).join(mark) : text;
  return marked
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      let a = dir ? t.split(mark).join(dir) : t;
      for (const [re, to] of PLACEHOLDERS) a = a.replace(re, to);
      return a;
    });
}

/** The reasons as the human report words them: every one, or the first three and a count. */
export function reasonLine(whys) {
  return whys.length > 4 ? `${whys.slice(0, 3).join('; ')}; and ${whys.length - 3} more` : whys.join('; ');
}

/**
 * The to-do (`Map<command line, reasons[]>`, in the order `status` asks) as steps. A line joined with
 * `&&` is two steps in that order, each carrying the line's reasons; a step asked for twice is kept
 * once, where it was first asked, with both sets of reasons.
 */
export function statusJson(todo, dir, lines = []) {
  const steps = [];
  const byKey = new Map();
  for (const [cmd, whys] of todo) {
    for (const part of cmd.split(' && ')) {
      const args = splitCommand(part, dir);
      if (!args.length) continue;
      const key = args.join('\u0000');
      let step = byKey.get(key);
      if (!step) {
        const needsJka = args.some((a) => a.includes('@JKA'));
        step = { command: args[0], args, reasons: [], jka: needsJka ? 'needs' : TAKES_JKA.has(args[0]) ? 'takes' : null };
        byKey.set(key, step);
        steps.push(step);
      }
      for (const w of whys) if (!step.reasons.includes(w)) step.reasons.push(w);
    }
  }
  for (const s of steps) s.reason = reasonLine(s.reasons);
  // Files that are there and will not parse, which status took as missing: a writer stopped in the
  // middle. The step that writes one may read it back before it writes it again, so a caller sets them
  // aside before running anything. The field is new in the same format: an older reader ignores it.
  const unreadable = [...(todo.unreadable ?? [])];
  return { format: STATUS_FORMAT, dir, done: steps.length === 0, steps, unreadable, lines };
}
