// The city walked into (src/story/cities.ts): in at a city's reach, out only past it and a share more,
// the nearer middle where two reaches overlap, and nothing said for a city walked back into within the
// repeat gap. Synthetic first; then measured over every converted world's own `pois.json` where
// `assets-private` is there, walking into every city the packs hold, and skipped with a line where it is not.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CITY_TUNE, CityWatch, cityAt, isCity, tuneCities, type CityRow } from '../../../src/story/cities.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const city = (name: string, x: number, z: number, r: number): CityRow => ({ name, x, z, r, kind: 'city' });

// ---------------------------------------------------------------------------------------------------
// The rules, on made-up cities.
{
  ok(isCity(city('a', 0, 0, 400)) && !isCity(city('b', 0, 0, CITY_TUNE.minR - 1)) && !isCity({ name: 'p', x: 0, z: 0, r: 900, kind: 'place' }), `a city is a city row with a reach of ${CITY_TUNE.minR} m or more`);
  const rows = [city('Big', 0, 0, 500), city('Small', 400, 0, 200)];
  const flipped = [rows[1], rows[0]];
  ok(cityAt(rows, 380, 0)?.name === 'Small' && cityAt(flipped, 380, 0)?.name === 'Small', 'where two reaches overlap, the nearer middle is the city you are in, whichever row comes first');
  const pair = [city('West', 0, 0, 300), city('East', 400, 0, 300)];
  const pairFlipped = [pair[1], pair[0]];
  ok(
    cityAt(pair, 150, 0)?.name === 'West' && cityAt(pairFlipped, 150, 0)?.name === 'West' && cityAt(pair, 250, 0)?.name === 'East' && cityAt(pairFlipped, 250, 0)?.name === 'East',
    'and across an overlap each side of the middle line is the city whose middle it is nearer, in either order',
  );
  ok(cityAt(rows, -480, 0)?.name === 'Big' && cityAt(rows, -520, 0) === null, 'and outside every reach there is none');

  const w = new CityWatch();
  const r = 500;
  ok(w.step(rows, -900, 0, 0) === null, 'far outside, nothing is said');
  ok(w.step(rows, -r + 5, 0, 1) === 'Big', 'walking in says the name');
  ok(w.step(rows, -r + 20, 0, 2) === null, 'once');
  // The edge: just out and back in, inside the margin, is still in.
  ok(w.step(rows, -r * 1.05, 0, 3) === null && w.here === 'Big', `a step out within ${CITY_TUNE.hysteresis * 100}% of the reach is still in`);
  ok(w.step(rows, -r + 5, 0, 4) === null, 'and coming back over the edge says nothing');
  ok(w.step(rows, -r * 1.2, 0, 5) === null && w.here === '', 'past the margin it is left');
  ok(w.step(rows, -r + 5, 0, 10) === null && w.quiet === 1, `and walked back into within ${CITY_TUNE.repeatGap} s, nothing is said`);
  w.step(rows, -r * 1.2, 0, 11);
  ok(w.step(rows, -r + 5, 0, 11 + CITY_TUNE.repeatGap + 1) === 'Big', 'but after the gap it is said again');
  w.reset();
  ok(w.step(rows, -r + 5, 0, 12 + CITY_TUNE.repeatGap) === 'Big', 'and a new world forgets them all');
  // Standing in one city says it once; staying in it longer than the repeat gap keeps its clock running,
  // so stepping out of the gate and straight back in after a long stay is not an arrival.
  const w2 = new CityWatch();
  ok(w2.step(rows, 0, 0, 0) === 'Big', 'standing in a city says it');
  ok(w2.step(rows, 0, 0, 1) === null && w2.here === 'Big', 'once');
  for (let t = 10; t <= 200; t += 10) w2.step(rows, -r + 10, 0, t);
  ok(w2.step(rows, -r * 1.2, 0, 201) === null && w2.here === '', `after ${200} s in it, out past the margin`);
  ok(w2.step(rows, -r + 10, 0, 202) === null, `and straight back in says nothing: the ${CITY_TUNE.repeatGap} s count from the last moment in it, not from the arrival`);

  // A walk from one city's middle straight into another's, across where the two overlap, in both row
  // orders: each name is said once, the second where its middle has become nearer by the margin, and
  // the walk back hands over again and, inside the repeat gap, says nothing.
  for (const order of [rows, flipped]) {
    const w3 = new CityWatch();
    const heard: string[] = [];
    let handedAt = Number.NaN;
    for (let x = 0; x <= 400; x += 1) {
      const s = w3.step(order, x, 0, x / 100);
      if (s) heard.push(`${s}@${x}`);
      if (s === 'Small') handedAt = x;
    }
    const want = (400 * (1 + CITY_TUNE.hysteresis)) / (2 + CITY_TUNE.hysteresis);
    ok(heard.length === 2 && heard[0] === 'Big@0' && heard[1].startsWith('Small@'), `walking from Big into Small says both, once each (${heard.join(', ')})`);
    ok(Math.abs(handedAt - want) <= 1, `and hands over where Small's middle is nearer by the margin (${handedAt} m, ${want.toFixed(1)} m by the rule)`);
    ok(w3.here === 'Small', 'standing at its middle, you are in Small');
    let back = 0;
    for (let x = 400; x >= 0; x -= 1) if (w3.step(order, x, 0, 5 + (400 - x) / 100) !== null) back++;
    ok(w3.here === 'Big' && back === 0, 'and walking straight back is in Big again, said nothing since it was just left');
  }
  const was = CITY_TUNE.hysteresis;
  tuneCities({ hysteresis: -1 });
  ok(CITY_TUNE.hysteresis === 0, 'the margin cannot be negative');
  tuneCities({ hysteresis: was });
}

// ---------------------------------------------------------------------------------------------------
// The real packs, where they are converted.
{
  const root = new URL('../../../assets-private/', import.meta.url);
  if (!existsSync(root)) {
    console.log('skip the converted packs: assets-private is not here');
  } else {
    let worlds = 0;
    let cities = 0;
    let said = 0;
    let overlaps = 0;
    const none: string[] = [];
    const wrong: string[] = [];
    for (const pack of readdirSync(root)) {
      const file = new URL(`${pack}/pois.json`, root);
      if (!existsSync(file)) continue;
      const rows = ((JSON.parse(readFileSync(file, 'utf8')) as { pois?: CityRow[] }).pois ?? []) as CityRow[];
      worlds++;
      const here = rows.filter(isCity);
      if (!here.length) none.push(pack);
      for (const c of here) {
        cities++;
        for (const o of here) if (o !== c && Math.hypot(o.x - c.x, o.z - c.z) < o.r + c.r) overlaps++;
        // Walk in from twice the reach out to the middle along the +x axis, a metre at a time: the city
        // walked into is this one or one nearer that overlaps it, and it is said once.
        const w = new CityWatch();
        let named: string[] = [];
        for (let d = c.r * 2; d >= 0; d -= 1) {
          const s = w.step(rows, c.x + d, c.z, 0);
          if (s) named.push(s);
        }
        if (named.length >= 1 && named.includes(c.name)) said++;
        else if (!named.length || !named.includes(c.name)) {
          // Its middle may be inside a nearer city's reach; then that one is the one you are in.
          const at = cityAt(rows, c.x, c.z);
          if (at?.name !== c.name && at && named.includes(at.name)) said++;
          else wrong.push(`${pack}/${c.name}: ${named.join(', ') || 'nothing'}`);
        }
        named = [];
      }
    }
    ok(worlds > 0, `${worlds} converted worlds carry a pois.json`);
    ok(cities > 0, `${cities} cities with a reach of ${CITY_TUNE.minR} m or more among them`);
    ok(wrong.length === 0, `walking into every one of them says its name (${said} of ${cities})${wrong.length ? `: ${wrong.slice(0, 5).join('; ')}` : ''}`);
    console.log(`     worlds with no city to say: ${none.join(', ') || 'none'}; pairs of reaches that overlap: ${overlaps / 2}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// A place of ours (Map-maker II's eighth wave): said by its own `say`, whatever its kind and reach, and in by its own shape.
{
  const { inPlaceShape } = await import('../../../src/story/cities.ts');
  const ring: CityRow = { name: 'Ring', x: 0, z: 0, r: 30, kind: 'place', say: true, shape: { kind: 'circle', c: [0, 0], r: 30 } };
  const quiet: CityRow = { name: 'Quiet', x: 0, z: 0, r: 900, kind: 'city', say: false, shape: { kind: 'circle', c: [0, 0], r: 900 } };
  ok(isCity(ring) && !isCity(quiet), "a place of ours is said by its own say: a 30 m place that says it is, a 900 m city that says it is not, isn't");
  // An L-shaped outline: its middle (by its reach) is outside it, so only the shape can say where it is.
  const ell: CityRow = { name: 'Ell', x: 50, z: 50, r: 71, kind: 'city', say: true, shape: { kind: 'poly', pts: [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]] } };
  ok(cityAt([ell], 10, 90)?.name === 'Ell' && cityAt([ell], 90, 10)?.name === 'Ell', 'an outline holds a point in either of its arms');
  ok(cityAt([ell], 60, 60) === null, 'and not one in its notch, though the notch is within its reach of its middle');
  ok(inPlaceShape(ell.shape!, 60, 25, 6) && !inPlaceShape(ell.shape!, 60, 25, 4), 'grown, an outline takes a point within the margin of an edge, and no further');
  const rect: CityRow = { name: 'Box', x: 0, z: 0, r: 70, kind: 'area', say: true, shape: { kind: 'rect', min: [-50, -20], max: [50, 20] } };
  ok(cityAt([rect], 45, 15)?.name === 'Box' && cityAt([rect], 0, 30) === null, 'a rectangle by its sides');
  const w = new CityWatch();
  ok(w.step([ell], 10, 90, 0) === 'Ell', 'walking into an outline says its name');
  ok(w.step([ell], 60, 23, 1) === null && w.here === 'Ell', 'a step into its notch, within the margin of its edge, is still in');
  ok(w.step([ell], 60, 60, 1.5) === null && w.here === '', 'and deep in the notch is out, though within its reach of its middle');
  ok(w.step([ell], 300, 300, 2) === null && w.here === '', 'and far out is out');
}

// ---------------------------------------------------------------------------------------------------
// Day one: a pack's own rows, which carry neither `say` nor `shape`, are read by today's watch exactly as by the one before
// the wave (fc246b4's, out of git): every step of a walk through overlapping cities says the same and is in the same city.
// The walk's trace (what each step said, where it was, which city holds it) hashes to the one recorded from fc246b4, which is
// what holds where git cannot hand the old code over.
{
  const { createHash } = await import('node:crypto');
  const sha = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 16);
  const PRE_WAVE_WALK = '84df8bdbacefa0ed';
  const { loadOld } = await import('./oldModules.ts');
  const old = await loadOld<typeof import('../../../src/story/cities.ts')>(['src/story/cities.ts'], 'src/story/cities.ts', 'fc246b4');
  const rows: CityRow[] = [city('A', 0, 0, 400), city('B', 500, 100, 300), city('C', -300, 700, 200), { name: 'L', x: 900, z: 900, r: 600, kind: 'landmark' }];
  const now = new CityWatch();
  const was = old ? new old.CityWatch() : null;
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let x = -800;
  let z = -800;
  let same = 0;
  let diff = 0;
  const traceNow: string[] = [];
  const traceThen: string[] = [];
  for (let i = 0; i < 20000; i++) {
    x += (rnd() - 0.45) * 40;
    z += (rnd() - 0.45) * 40;
    if (x > 1600) x = -800;
    if (z > 1600) z = -800;
    const a = now.step(rows, x, z, i * 0.5);
    traceNow.push(`${a ?? ''}|${now.here}|${cityAt(rows, x, z)?.name ?? ''}`);
    if (old && was) {
      const b = was.step(rows, x, z, i * 0.5);
      traceThen.push(`${b ?? ''}|${was.here}|${old.cityAt(rows, x, z)?.name ?? ''}`);
      if (a === b && now.here === was.here && cityAt(rows, x, z) === old.cityAt(rows, x, z)) same++;
      else diff++;
    }
  }
  const hashNow = sha(traceNow.join('\n'));
  if (!old) ok(hashNow === PRE_WAVE_WALK, `git cannot hand fc246b4 over: a walk of 20000 steps through a pack's own cities hashes to the walk recorded from its watch (${hashNow})`);
  else {
    ok(diff === 0, `a walk of 20000 steps through a pack's own cities says and holds exactly what fc246b4's watch does (${same} steps alike)`);
    const hashThen = sha(traceThen.join('\n'));
    ok(hashThen === PRE_WAVE_WALK && hashNow === PRE_WAVE_WALK, `and fc246b4's walk is the one recorded here for a machine where git cannot hand it over (${hashThen})`);
  }
}

console.log(`\n${checks} checks passed`);
