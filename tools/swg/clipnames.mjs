// The friendly clip names a logical animation table's entries get: the same names the
// converted packs carry, so anything that has to line up with a pack's clips (which sound
// belongs to which animation, for one) can work them out from the archives alone without
// reading the pack.
//
// This is the helper the `sat`, `parts`, `player` and `species` conversions have always used,
// moved out of the command file unchanged so a second reader can import it.

/**
 * Friendly clip names for the locomotion loops. The client's speed selector picks the child
 * whose recorded movement speed is nearest the creature's speed, in no fixed order, so the
 * default loop_stand (and loop_stand_combat) steps are named by that speed: idle for the
 * still one, walk and run for the slowest and fastest moving ones.
 */
export function nameLocomotion(entries, loadAnimation) {
  const named = entries.map((e) => ({ ...e, clip: e.name, speed: 0 }));
  // A speed selector's branches are listed in the file's order, not by speed: rank each group's
  // ":speedN" by the speed its animation carries (0 the slowest, so speed0 is the idle everywhere).
  const groups = new Map();
  for (const e of named) {
    const m = /^(.*):speed(\d+)(.*)$/.exec(e.name);
    if (!m) continue;
    const g = groups.get(m[1]) ?? groups.set(m[1], new Map()).get(m[1]);
    const idx = Number(m[2]);
    const list = g.get(idx) ?? g.set(idx, []).get(idx);
    list.push({ e, tail: m[3] });
  }
  for (const [base, byIndex] of groups) {
    if (byIndex.size < 2) continue;
    // The skill loop's branches are a walk, a run and the performances (the dances and music
    // loops), not one motion at three speeds: they keep the table's order, so the dances stay speed2.
    if (base.startsWith('loop_skill')) continue;
    const ranked = [...byIndex.entries()].map(([idx, list]) => {
      const rep = list.find((x) => x.tail === '') ?? list.find((x) => x.e.isDefault) ?? list[0];
      let speed = 0;
      try {
        speed = loadAnimation(rep.e)?.locomotionSpeed ?? 0;
      } catch {
        speed = 0;
      }
      return { idx, speed, list };
    });
    ranked.sort((a, b) => a.speed - b.speed || a.idx - b.idx);
    ranked.forEach((r, rank) => {
      for (const { e, tail } of r.list) e.clip = e.name = `${base}:speed${rank}${tail}`;
    });
  }
  // Creatures: loop_stand:speedN[:variant]; players: loop_standing:<gender>:speedN[:variant].
  // One entry per speed: the default variant (marked default, or with no variant suffix), from
  // the first selector branch the table lists.
  // Selector branches are named for their values (a gender's "o", a mood's "bored") or numbered when the table names none.
  const LOCO = /^(loop_stand(?:ing)?(?:_combat)?)((?::[\w-]+)*):speed(\d+)((?::[\w-]+)*)$/;
  const branches = new Map();
  for (const e of named) {
    const m = e.name.match(LOCO);
    if (!m) continue;
    const suffix = m[1].endsWith('_combat') ? '_combat' : '';
    const key = `${m[1]}${m[2]}`;
    if (!branches.has(suffix)) branches.set(suffix, { key, bySpeed: new Map() });
    const branch = branches.get(suffix);
    if (branch.key !== key) continue;
    const rank = e.isDefault === true ? 2 : m[4].length === 0 ? 1 : 0;
    const current = branch.bySpeed.get(Number(m[3]));
    if (!current || rank > current.rank) branch.bySpeed.set(Number(m[3]), { e, rank });
  }
  for (const [suffix, branch] of branches) {
    const group = [...branch.bySpeed.values()].map((c) => c.e);
    for (const e of group) {
      try {
        e.speed = loadAnimation(e)?.locomotionSpeed ?? 0;
      } catch {
        e.speed = 0;
      }
    }
    if (!group.length) continue;
    const moving = group.filter((e) => e.speed > 0.05).sort((a, b) => a.speed - b.speed);
    const still = group.filter((e) => e.speed <= 0.05);
    if (still.length) still[0].clip = `idle${suffix}`;
    else if (moving.length) moving.shift().clip = `idle${suffix}`;
    if (moving.length === 1) moving[0].clip = `${moving[0].speed > 4 ? 'run' : 'walk'}${suffix}`;
    else if (moving.length >= 2) {
      moving[0].clip = `walk${suffix}`;
      moving[moving.length - 1].clip = `run${suffix}`;
      moving.slice(1, -1).forEach((e, i) => (e.clip = `walk${i + 2}${suffix}`));
    }
  }
  return named;
}
