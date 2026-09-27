// What `status` counts as mobiles work: a model the game's own archives cannot give (its
// appearance stripped at every detail level, "no mesh survived") fails again on every rerun, so it
// is listed apart and never asks for one; any other failure, a failure from other archives or for
// other inputs, and a unit that is there but broken, all stay work to do.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as M from '../mobiles.mjs';
import { SPAWNS_FORMAT, spawnsStale } from '../spawnpack.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

type Failure = { what: string; id: string; why: string; sig?: string | null; source?: string | null };
const catalogue = (failed: Failure[], key: string | null = 'k1') => ({
  options: { source: key ? { retailOnly: true, archives: 2, key } : undefined },
  appearances: { gubbur: { id: 'gubbur', sig: 's-gubbur' }, bantha: { id: 'bantha', sig: 's-bantha' } },
  failed,
});
const stripped: Failure = { what: 'model', id: 'gubbur', why: 'no mesh survived' };
const units = (gubbur: string) => [
  { kind: 'model', id: 'gubbur', state: gubbur },
  { kind: 'model', id: 'bantha', state: 'current' },
  { kind: 'pack', id: 'all_b', state: 'current' },
];
const toDo = (cat: ReturnType<typeof catalogue>, gubbur = 'missing') => M.unitsToDo(units(gubbur), M.permanentFailures(cat)).length;

// The owner's case: one appearance stripped in the archives, the rest converted.
ok(M.permanentFailures(catalogue([stripped])).has('gubbur'), 'a model that failed with "no mesh survived" is permanent');
ok(toDo(catalogue([stripped])) === 0, 'so a catalogue whose only gap is that model has no mobiles work to do');
ok(toDo(catalogue([])) === 1, 'the same model missing with no failure recorded is still work (a run stopped before it)');

// Other reasons are not permanent.
ok(toDo(catalogue([{ ...stripped, why: 'ENOENT: no such file' }])) === 1, 'a model that failed for another reason is still work');
ok(toDo(catalogue([{ ...stripped, what: 'anims' }])) === 1, 'an animation pack failure is never taken for a stripped model');
ok(toDo(catalogue([{ ...stripped, why: 'no mesh survived after all' }])) === 1, 'only the exact reason counts');

// The archives or the inputs changed: a rerun may convert it now.
ok(toDo(catalogue([{ ...stripped, source: 'k0' }])) === 1, 'a failure from other archives than the catalogue\'s is work again');
ok(toDo(catalogue([{ ...stripped, sig: 's-old' }])) === 1, 'a failure for other inputs than the unit now plans is work again');
ok(toDo(catalogue([{ ...stripped, source: 'k1', sig: 's-gubbur' }])) === 0, 'a failure stamped with the same archives and inputs stays permanent');
ok(toDo(catalogue([stripped], null)) === 1, 'a catalogue that does not say which archives it came from keeps it as work');
ok(!M.permanentFailures(catalogue([{ ...stripped, id: 'gone' }])).size, 'a failure for an appearance the catalogue no longer plans is ignored');

// Only a missing unit is excused: one on disk that is broken or foreign is work whatever failed.
for (const state of ['incomplete', 'foreign', 'oldFormat', 'stale']) ok(toDo(catalogue([stripped]), state) === 1, `a unit that is ${state} is work even with a permanent failure recorded`);

// Everything else is counted exactly as before.
{
  const mixed = [
    { kind: 'model', id: 'a', state: 'missing' },
    { kind: 'model', id: 'b', state: 'stale' },
    { kind: 'pack', id: 'gubbur', state: 'missing' },
    { kind: 'wearables', id: 'w', state: 'current' },
  ];
  const before = mixed.filter((u) => u.state !== 'current').length;
  ok(M.unitsToDo(mixed, M.permanentFailures(catalogue([stripped]))).length === before, 'units that are not the stripped model count as they always did (a pack of the same name included)');
}

// The failure record a run writes carries the stamps the check reads.
{
  const src = readFileSync(new URL('../mobiles.mjs', import.meta.url), 'utf8');
  ok(/failed\.push\(\{ what: 'model'[^}]*\bsig: a\.sig\b[^}]*\bsource: plan\.source\b/.test(src),'a model failure is recorded with its unit signature and the archives it was tried on');
}

// A humanoid pack baked before a name was asked for, which its own record cannot show: the catalogue's
// planned signature was written by the same run as the pack, so the two agree however old the list.
// A name the pack must carry says it, and a pack whose table has not got the name says so itself.
{
  const name = 'loop_polearm_combat';
  ok(M.bakedBefore({ set: 'curated', logical: { loop_standing: ['idle'] } }, name), 'a humanoid pack with no clip for the name and nothing to say about it was baked before the name was asked for');
  ok(!M.bakedBefore({ set: 'curated', logical: { [name]: ['pole'] }, absent: [] }, name), 'one that carries it is current');
  ok(!M.bakedBefore({ set: 'curated', logical: {}, absent: [name] }, name), 'and one whose table has not got it says so, and is not asked for again for ever');
  ok(!M.bakedBefore({ set: 'full', logical: {} }, name) && !M.bakedBefore(null, name), 'a creature pack is never asked for a humanoid\'s name');
  // What the curated planner writes into every humanoid pack is what the check reads.
  const table = new Map([['loop_standing', [{ file: 'appearance/animation/idle.ans', timeScale: 1, path: [] }]]]);
  const plan = M.planPack({ id: 'p', key: 'k', table: 't', hierarchy: 'all_b', joints: 2, names: table }, { header: () => ({ frames: 30, fps: 30, speed: 0, transforms: [] }) });
  ok(plan.set === 'curated' && plan.absent.includes(name) && !plan.absent.includes('loop_standing') && !M.bakedBefore({ set: plan.set, logical: plan.logical, absent: plan.absent }, name), 'a pack planned now names every asked-for name its table could not give, so status never asks again for one it cannot have');
  const units = [
    { kind: 'pack', record: { set: 'curated', logical: {} } },
    { kind: 'pack', record: { set: 'curated', logical: {}, absent: [name] } },
    { kind: 'pack', record: null },
    { kind: 'model', record: { set: 'curated', logical: {} } },
  ];
  ok(M.packsBakedBefore(units, name) === 1, 'status counts only the humanoid packs on disk that were baked before the name, never one missing or a model');
}

// What `status` itself calls, read as text: the rules above are pure, and every line of the status
// that calls them compiles just as well deleted or pointed at another name.
{
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  ok(/const unasked = M\.packsBakedBefore\(units, M\.CURATED_WITNESS\);\s*if \(unasked\) need\(rerun,/.test(cli), 'status asks for the mobiles again for every humanoid pack baked before the witness clip was asked for');
  ok(/const oldTemper = M\.oldTempers\(mobiles\);\s*if \(oldTemper\) need\(rerun,/.test(cli), 'and for a catalogue whose tempers were worked out while KILLER and STALKER still counted');
  ok(/const stale = spawnsStale\(Object\.fromEntries\(spawnWorlds\.map\(\(w\) => \[w, readQuiet\(join\(dir, w, 'spawns\.json'\)\)\?\.format\]\)\), spawnManifest\.format\);\s*if \(stale\.stale\) \{\s*need\(`spawns /.test(cli), 'and for the spawns wherever a world\'s pack or the fleet\'s manifest is older than the format');
  const src = readFileSync(new URL('../mobiles.mjs', import.meta.url), 'utf8');
  ok(/\.\.\.\(p\.set === 'curated' \? \{ absent: p\.absent \} : \{\}\),/.test(src), 'and the pack record a run writes carries what its table could not give, which is what keeps that from asking for ever');
}

// The spawns packs' own rule, which status runs.
{
  const f = SPAWNS_FORMAT;
  ok(!spawnsStale({ a: f, b: f }, f).stale, 'packs and a manifest at the format ask for nothing');
  const older = spawnsStale({ a: f, b: f - 1, c: undefined }, f);
  ok(older.stale && older.older.join() === 'b,c' && !older.manifest, 'a world whose pack is older, or has none that says, is asked for by name');
  ok(spawnsStale({ a: f }, f - 1).manifest && spawnsStale({ a: f }, undefined).stale, 'and so is an older manifest, or one that says nothing');
}

// The real catalogue, when it has been converted: status asks for no rerun for the one model the
// game's own archives lack, and still lists it.
{
  const at = new URL('../../../assets-private/mobiles/catalogue.json', import.meta.url);
  if (existsSync(at)) {
    const file = JSON.parse(readFileSync(at, 'utf8'));
    const root = new URL('../../../assets-private/', import.meta.url);
    const sizeOf = (p: string) => {
      try {
        return statSync(new URL(p, root)).size;
      } catch {
        return null;
      }
    };
    const readQuiet = (p: string) => {
      try {
        return JSON.parse(readFileSync(new URL(p, root), 'utf8'));
      } catch {
        return null;
      }
    };
    const all = M.unitList(file).map((u: { record: string; sig: string }) => ({ ...u, state: M.unitState(readQuiet(u.record), { sig: u.sig, source: file.options.source }, sizeOf) }));
    const permanent = M.permanentFailures(file);
    const left = M.unitsToDo(all, permanent);
    ok(permanent.size >= 1 && [...permanent.values()].every((f: Failure) => f.why === 'no mesh survived'), `the real catalogue's permanent gaps are listed: ${[...permanent.keys()].join(', ')}`);
    ok(left.every((u: { kind: string; id: string }) => !permanent.has(u.id) || u.kind !== 'model'), 'none of them is counted as work');
    console.log(`     (real catalogue: ${all.length} units, ${all.filter((u: { state: string }) => u.state !== 'current').length} not current, ${left.length} left as work)`);
    // The humanoid packs as the last run wrote them: each says what it was asked for and could not have,
    // none is one status would ask for again, and every one that bakes a weapon's stance carries its row.
    type PackRecord = { set?: string; logical?: Record<string, unknown>; absent?: string[]; carries?: Record<string, unknown> };
    const packs = M.unitList(file).filter((u: { kind: string }) => u.kind === 'pack').map((u: { record: string }) => ({ kind: 'pack', record: readQuiet(u.record) as PackRecord | null }));
    const curated = packs.filter((p: { record: PackRecord | null }) => p.record?.set === 'curated');
    ok(curated.length > 20 && curated.every((p: { record: PackRecord | null }) => Array.isArray(p.record!.absent)), `every one of the ${curated.length} humanoid packs says what its table could not give`);
    ok(M.packsBakedBefore(packs, M.CURATED_WITNESS) === 0, 'and none of them is one status would ask for again');
    const polearm = curated.filter((p: { record: PackRecord | null }) => p.record!.logical?.loop_polearm_combat);
    const sword2h = curated.filter((p: { record: PackRecord | null }) => p.record!.logical?.loop_sword2h_combat);
    ok(polearm.length > 0 && polearm.every((p: { record: PackRecord | null }) => p.record!.carries?.polearm) && sword2h.every((p: { record: PackRecord | null }) => p.record!.carries?.sword2h), `every pack that bakes the polearm's stance carries its row (${polearm.length}), and so does every one with the two-handed sword's (${sword2h.length})`);
    ok(M.oldTempers(file) === 0, 'and no entry of the catalogue attacks on sight for a reason the server never did');
  } else console.log('     (no converted catalogue under assets-private: the real-catalogue checks are skipped)');
}

console.log(`\n${passed} checks passed`);
