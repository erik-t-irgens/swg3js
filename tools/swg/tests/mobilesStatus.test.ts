// What `status` counts as mobiles work: a model the game's own archives cannot give (its
// appearance stripped at every detail level, "no mesh survived") fails again on every rerun, so it
// is listed apart and never asks for one; any other failure, a failure from other archives or for
// other inputs, and a unit that is there but broken, all stay work to do.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as M from '../mobiles.mjs';

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
  } else console.log('     (no converted catalogue under assets-private: the real-catalogue checks are skipped)');
}

console.log(`\n${passed} checks passed`);
