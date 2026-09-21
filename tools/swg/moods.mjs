// The mood branches of a character's logical animation table: which clip the game's `mood`
// selector plays for each value, and which of those really differ from the clip the table plays
// when no mood is set.
//
// Two things here are not what they look like, and each is why this is a file rather than a
// filter in the command.
//
// **The selectors nest, and the shipped flattener loses the inner one.** On the human table the
// standing loop is a gender selector outside a speed selector outside the mood selector, and
// `skeletal.mjs`'s flattener spreads each selector's variable and values over what it already
// built as it unwinds, so the outermost wins: every mood branch comes out of it carrying the
// *gender's* values and no mood value at all. The mobiles command wrote a path-keeping flattener
// for exactly this reason and this file borrows it rather than keeping a second copy of it.
//
// **A branch is not a clip.** The mood values divide into three kinds and only one of them may
// grow a pack: values whose branch plays a clip of its own; values whose branch plays the very
// clip the default branch plays, which is the same animation under another name and must not be
// baked twice; and several values that share one branch, or several branches that name one file,
// which are one clip carrying every value that reaches it. `moodEntries` answers with one entry
// per distinct animation, named for the first value that picks it and carrying the rest, which is
// exactly what `rig.variant(base, value)` resolves at the other end.
//
// Everything here is pure: it takes a parsed table and a run's already named entries and gives
// back more entries of the same shape, so a test can drive it with a table it built itself.

import { flattenPaths, tableNames } from './mobiles.mjs';

/** The label the converter names a selector branch with: its first value that is not `default`. */
export function branchLabel(values, index = 0) {
  const list = values ?? [];
  return list.find((v) => v !== 'default') ?? list[0] ?? String(index);
}

/**
 * An animation path as both readers would have to spell it to be the same file. The two sides of
 * the join are normalised differently at the source — the path-keeping flattener lowercases and
 * strips a leading slash, the shipped one only turns the backslashes round — so a table with one
 * uppercase letter or one leading slash in it would otherwise match nothing at all and the whole
 * pass would quietly convert nothing. No retail table does; the comparison is made here anyway.
 */
export function normFile(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
}

/** A selector step as a key, so two leaves of the same branch chain group together. */
function stepKey(s) {
  if (s.k === 'sel') return `${s.variable}#${s.i}`;
  if (s.k === 'speed') return `speed${s.i}`;
  return `${s.k}=${s.v}`;
}

/**
 * The mood branches a logical name's leaves carry, grouped by where in the table they hang: one
 * group per place the selector appears (the human table's standing loop has one per gender, both
 * under the still speed branch), each with the branch played when no mood is set and the branches
 * beside it. A leaf with no such selector is in no group, which is the honest answer for the walk
 * and the run: on the human table the mood selector is under the still branch alone.
 */
export function moodGroups(leaves, variable = 'mood') {
  const groups = new Map();
  for (const leaf of leaves ?? []) {
    const at = (leaf.path ?? []).findIndex((s) => s.k === 'sel' && s.variable === variable);
    if (at < 0) continue;
    const step = leaf.path[at];
    const key = leaf.path.filter((_, i) => i !== at).map(stepKey).join(',');
    let group = groups.get(key);
    if (!group) {
      group = { key, outer: leaf.path.slice(0, at), branches: [], base: null };
      groups.set(key, group);
    }
    group.branches.push({
      label: branchLabel(step.values, step.i),
      values: [...(step.values ?? [])],
      isDefault: step.isDefault === true,
      file: leaf.file ?? null,
      timeScale: leaf.timeScale ?? 1,
    });
  }
  // What "differs" means is "differs from the branch played with no mood set", so a selector with
  // no default branch at all leaves every branch undifferent and nothing is baked: without the
  // branch to measure against there is no telling a real mood from the idle under another name,
  // and a pack that grew by every branch would be the thing this file exists to avoid.
  for (const group of groups.values()) {
    group.base = group.branches.find((b) => b.isDefault) ?? null;
    for (const b of group.branches) {
      b.differs = !!group.base && !!b.file && (normFile(b.file) !== normFile(group.base.file) || b.timeScale !== group.base.timeScale);
    }
  }
  return [...groups.values()];
}

/**
 * The group a named locomotion entry belongs to, **and why** when the answer is none. One note
 * text for three outcomes is worth nothing here: "the walk has no mood selector" is the wave's
 * headline finding, and it must not read the same as "the reader failed to find the branch". So
 * the answer carries `why`:
 *
 * - `matched` — one group's no-mood branch plays this very animation (or the entry's own selector
 *   values, which the shipped flattener left as the outermost selector's, break a tie between two
 *   genders' groups).
 * - `nosel` — leaves of this logical name do play the entry's animation, and not one of them hangs
 *   under a selector of this variable. That is the walk and the run, said from the table itself.
 * - `absent` — no leaf of this logical name plays the entry's animation at all, so its mood
 *   branches were never in this part of the table to be found.
 * - `unmatched` — leaves play it under such a selector, but no selector's *no-mood* branch does,
 *   so the entry is itself some branch and the default is another animation.
 * - `ambiguous` — several groups play it with no mood set and the entry's values pick none of
 *   them; answered with none rather than guessed at, because a mood hung on the other gender's
 *   branch is a clip nobody ever sees.
 *
 * `leaves` is optional: without it the three no-match outcomes cannot be told apart and the
 * answer is `unmatched`.
 */
export function matchGroup(groups, entry, leaves = null, variable = 'mood') {
  const scale = entry.timeScale ?? 1;
  const file = normFile(entry.file);
  const plays = (g) => g.base && normFile(g.base.file) === file && (g.base.timeScale ?? 1) === scale;
  const same = groups.filter(plays);
  if (same.length === 1) return { group: same[0], why: 'matched', count: 1 };
  if (same.length > 1) {
    const want = (entry.values ?? []).join('|');
    const byValues = same.filter((g) => g.outer.some((s) => s.k === 'sel' && [...(s.values ?? [])].join('|') === want));
    if (byValues.length === 1) return { group: byValues[0], why: 'matched', count: 1 };
    return { group: null, why: 'ambiguous', count: same.length };
  }
  if (!leaves) return { group: null, why: 'unmatched', count: 0 };
  const playing = (leaves ?? []).filter((l) => normFile(l.file) === file && (l.timeScale ?? 1) === scale);
  if (!playing.length) return { group: null, why: 'absent', count: 0 };
  const under = playing.filter((l) => (l.path ?? []).some((s) => s.k === 'sel' && s.variable === variable));
  if (!under.length) return { group: null, why: 'nosel', count: playing.length };
  return { group: null, why: 'unmatched', count: under.length };
}

/** The group alone, for a caller that does not care why there is none. */
export function groupFor(groups, entry, leaves = null, variable = 'mood') {
  return matchGroup(groups, entry, leaves, variable).group;
}

/**
 * One clip per distinct animation among a group's mood branches, named `<base>:<label>` and
 * carrying every value that reaches it. A branch that plays the no-mood branch's own clip is left
 * out and its values are returned as `sameAsDefault`: the game asks for those by name, finds no
 * branch, and stands as it always did, which is what they mean.
 */
export function moodClips(group, base) {
  const byAnimation = new Map();
  const sameAsDefault = [];
  const unplayable = [];
  for (const b of group.branches ?? []) {
    if (b.isDefault || !b.differs) {
      if (b.file) sameAsDefault.push(...b.values);
      else unplayable.push(...b.values);
      continue;
    }
    const key = `${b.file}@${b.timeScale}`;
    const have = byAnimation.get(key);
    if (have) {
      for (const v of b.values) if (!have.values.includes(v)) have.values.push(v);
      continue;
    }
    byAnimation.set(key, { clip: `${base}:${b.label}`, file: b.file, timeScale: b.timeScale, values: [...b.values] });
  }
  return { clips: [...byAnimation.values()], sameAsDefault, unplayable };
}

/**
 * What to say when a base clip has no mood group, in the words of the outcome rather than one
 * sentence that would fit all of them. The headline of this pass is that the walk and the run
 * carry no mood selector at all, and a reader must be able to tell that from a reader that simply
 * did not find the branch.
 */
export function noGroupNote(why, count = 0, { base = 'this clip', logical = 'the logical name', variable = 'mood' } = {}) {
  switch (why) {
    case 'nosel':
      return `its own branch carries no ${variable} selector at all (${count === 1 ? '1 leaf' : `${count} leaves`} of ${logical} play its animation, not one of them under a ${variable} selector), so nothing a ${variable} can be set to changes it`;
    case 'absent':
      return `its animation is not a leaf of ${logical} in this table, so its ${variable} branches were never looked for there`;
    case 'ambiguous':
      return `${count} ${variable} selectors play its animation with no ${variable} set and ${base}'s own values pick none of them; left out rather than guessed at`;
    default:
      return `no ${variable} selector whose no-${variable} branch plays its animation (${count === 1 ? '1 leaf plays' : `${count} leaves play`} it under one, so the branch played with no ${variable} set is another animation)`;
  }
}

/**
 * Extra entries for the mood branches of the locomotion clips a conversion has already named,
 * shaped exactly as `skeletal.mjs`'s so the command's own clip loop bakes them with nothing else
 * to learn. `mood: true` marks them as asked for outright, since the name filters a command
 * carries are written against the table's own names and know nothing of these.
 *
 * The second half of the answer is `notes`, which says of each base clip what became of it: the
 * walk and the run have no mood selector under them at all on the human table, and saying so is
 * worth more than a silent nothing.
 */
export function moodEntries(latRoot, named, { logical = 'loop_standing', bases = ['idle', 'walk', 'run'], variable = 'mood' } = {}) {
  const entries = [];
  const notes = [];
  const { names } = tableNames(latRoot);
  const leaves = names.get(logical);
  if (!leaves) {
    notes.push(`${logical}: not in this animation table, so it has no ${variable} branches`);
    return { entries, notes };
  }
  const groups = moodGroups(leaves, variable);
  if (!groups.length) {
    notes.push(`${logical}: this table's ${logical} has no ${variable} selector anywhere under it`);
    return { entries, notes };
  }
  const taken = new Set(named.map((e) => e.clip));
  for (const base of bases) {
    const entry = named.find((e) => e.clip === base);
    if (!entry) continue;
    if (entry.kind !== 'file') {
      notes.push(`${base}: a ${entry.kind} animation, which the ${variable} branches are not read against`);
      continue;
    }
    const { group, why, count } = matchGroup(groups, entry, leaves, variable);
    if (!group) {
      notes.push(`${base}: ${noGroupNote(why, count, { base, logical, variable })}`);
      continue;
    }
    const { clips, sameAsDefault, unplayable } = moodClips(group, base);
    for (const c of clips) {
      if (taken.has(c.clip)) continue;
      taken.add(c.clip);
      entries.push({ name: c.clip, clip: c.clip, kind: 'file', file: c.file, timeScale: c.timeScale, variable, values: c.values, isDefault: false, speed: 0, mood: true });
    }
    notes.push(
      `${base}: ${group.branches.length} ${variable} branches over ${group.branches.reduce((a, b) => a + b.values.length, 0)} values` +
        `; ${clips.length} clips converted, ${sameAsDefault.length} values play the ${base} itself` +
        `${sameAsDefault.length ? ` (${sameAsDefault.join(', ')})` : ''}${unplayable.length ? `; ${unplayable.length} name no animation (${unplayable.join(', ')})` : ''}`,
    );
  }
  return { entries, notes };
}

/** `flattenPaths` under its borrowed name, so a reader of this file can see where it comes from. */
export { flattenPaths };
