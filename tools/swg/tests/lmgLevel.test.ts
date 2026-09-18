// Which detail level of a skinned mesh the converter takes: the finest with geometry. Where the
// finest level that exists has triangles (every mesh the game draws but a handful), the answer is
// exactly the old one, the first level that exists, parsed once; a level stripped in the archives
// is passed over for the next that draws; with none that draws, the old answer stands so the
// caller reports it as it always has; and an unreadable level is never skipped.
import assert from 'node:assert/strict';
import { finestLevelWithGeometry, triangleCount } from '../lmglevel.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

// A mesh generator as parseMgn gives it: shaders with flat triangle index lists.
const mgn = (...trisPerShader: number[]) => ({ shaders: trisPerShader.map((n) => ({ triangles: new Int32Array(n * 3) })) });
type Mgn = ReturnType<typeof mgn>;
const archive = (files: Record<string, Mgn | 'bad'>) => {
  const loads: string[] = [];
  return {
    loads,
    io: {
      has: (f: string) => f in files,
      load: (f: string) => {
        loads.push(f);
        const m = files[f];
        if (m === 'bad') throw new Error(`SKMG: unsupported version 0002`);
        return m;
      },
    },
  };
};
const oldPick = (levels: string[], has: (f: string) => boolean) => levels.find((l) => has(l)) ?? levels[0];

ok(triangleCount(mgn(2, 3)) === 5 && triangleCount(mgn()) === 0 && triangleCount(mgn(0, 0)) === 0, 'triangles are counted over every shader');

// The finest level has geometry: the old answer, parsed once, and nothing coarser is read.
{
  const a = archive({ 'l0.mgn': mgn(40), 'l1.mgn': mgn(20), 'l2.mgn': mgn(10) });
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn', 'l2.mgn'], a.io);
  ok(r.file === 'l0.mgn' && triangleCount(r.mgn) === 40, 'the finest level, when it draws');
  ok(a.loads.join() === 'l0.mgn', 'parsed once, and no coarser level is read');
}

// Changes nothing wherever the finest level that exists has geometry: every arrangement of up to
// four levels, each present or absent, each drawing or stripped, compared with the old rule.
{
  let same = 0;
  let cases = 0;
  const names = ['a_l0.mgn', 'a_l1.mgn', 'a_l2.mgn', 'a_l3.mgn'];
  for (let n = 1; n <= 4; n++) {
    const levels = names.slice(0, n);
    for (let present = 0; present < 1 << n; present++) {
      for (let draws = 0; draws < 1 << n; draws++) {
        const files: Record<string, Mgn> = {};
        levels.forEach((l, i) => {
          if (present & (1 << i)) files[l] = draws & (1 << i) ? mgn(12 + i) : mgn(0);
        });
        const a = archive(files);
        const before = oldPick(levels, a.io.has);
        if (!before || !(before in files) || triangleCount(files[before]) === 0) continue;
        cases++;
        const r = finestLevelWithGeometry(levels, a.io);
        if (r.file === before && r.mgn === files[before] && a.loads.length === 1) same++;
      }
    }
  }
  ok(cases > 100 && same === cases, `every one of ${cases} arrangements whose finest present level draws picks exactly what it did before, with one parse`);
}

// A level stripped in the archives is passed over for the next that draws.
{
  const a = archive({ 'l0.mgn': mgn(0), 'l1.mgn': mgn(0, 18), 'l2.mgn': mgn(9) });
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn', 'l2.mgn'], a.io);
  ok(r.file === 'l1.mgn' && triangleCount(r.mgn) === 18, 'stripped at the finest level alone: the next level that draws');
}
{
  const a = archive({ 'l1.mgn': mgn(0), 'l2.mgn': mgn(7) });
  ok(finestLevelWithGeometry(['l0.mgn', 'l1.mgn', 'l2.mgn'], a.io).file === 'l2.mgn', 'a missing level and a stripped one are both passed over');
}
// The three creatures stripped only at coarser levels keep their finest.
{
  const a = archive({ 'l0.mgn': mgn(30), 'l1.mgn': mgn(0), 'l2.mgn': mgn(0) });
  ok(finestLevelWithGeometry(['l0.mgn', 'l1.mgn', 'l2.mgn'], a.io).file === 'l0.mgn', 'stripped only at coarser levels: the finest, as before');
}

// Nothing draws anywhere (the one model the archives cannot give): the old answer, reported as before.
{
  const a = archive({ 'l0.mgn': mgn(0), 'l1.mgn': mgn(0) });
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn'], a.io);
  ok(r.file === 'l0.mgn' && triangleCount(r.mgn) === 0, 'stripped at every level: the finest present, as before, for the caller to report');
}
{
  const a = archive({});
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn'], a.io);
  ok(r.file === 'l0.mgn' && r.mgn === null && a.loads.length === 0, 'no level in the archives: the first name, unread, for the caller to call missing');
  ok(finestLevelWithGeometry([], a.io).file === null, 'an empty level list gives nothing');
}

// An unreadable level is never passed over for a coarser one: the caller parses it and reports the error.
{
  const a = archive({ 'l0.mgn': 'bad', 'l1.mgn': mgn(5) });
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn'], a.io);
  ok(r.file === 'l0.mgn' && r.mgn === null, 'the finest present level unreadable: kept, unparsed, as before');
}
{
  const a = archive({ 'l0.mgn': mgn(0), 'l1.mgn': 'bad', 'l2.mgn': mgn(5) });
  const r = finestLevelWithGeometry(['l0.mgn', 'l1.mgn', 'l2.mgn'], a.io);
  ok(r.file === 'l0.mgn', 'a stripped level then an unreadable one: the search stops, and the finest present stands');
}

console.log(`\n${passed} checks passed`);
