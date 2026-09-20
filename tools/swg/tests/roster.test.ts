// The group's roster on the display (src/ui/hud.ts).
//
// It is driven against a stand-in for the page that counts every property written and every one read
// back, so "a steady frame writes nothing" is a measurement and not a claim. It has to be measured:
// the tab a session can drive here is hidden, its game loop is frozen, and there is no profiler to
// watch.
//
// What is pinned here: a roster handed the same group again writes nothing at all and reads nothing
// back off the page; sixty thousand such frames grow the heap by less than a browser's own noise,
// which is the measurement behind "nothing is allocated per frame"; a distance is compared in steps
// and the words it becomes are built only when they would differ, so two distances that read the
// same never cost a write; a member who is genuinely on another world is named the way the game
// names that world, out of the game's own table, while a member whose browser has gone quiet or who
// has simply not been heard from is not called a traveller; your own row carries no distance from
// yourself; the health bar moves by a transform and takes the interface's own bands; a group of one
// stands down; and more members than there are rows are counted rather than dropped in silence.
//
// The worlds named here are the game's own ids, read from `src/data/planets.ts`. Everything else —
// the names, the distances, the healths — is made up, and nothing is read from the game's files.
import assert from 'node:assert/strict';

// --- the stand-in for the page --------------------------------------------------------------------
const count = { writes: 0, width: 0, transform: 0, readText: 0 };

function styleBag(): Record<string, string> {
  const bag: Record<string, any> = {
    setProperty(name: string, value: string) {
      count.writes++;
      bag[name] = String(value);
    },
  };
  return new Proxy(bag, {
    set(t, k, v) {
      count.writes++;
      if (k === 'width') count.width++;
      if (k === 'transform') count.transform++;
      t[String(k)] = String(v);
      return true;
    },
    get(t, k) {
      const v = t[String(k)];
      return v === undefined ? '' : v;
    },
  }) as Record<string, string>;
}

function makeEl(): any {
  const found = new Map<string, any>();
  const classes = new Set<string>();
  const el: any = {
    style: styleBag(),
    classList: {
      toggle(name: string, force?: boolean) {
        count.writes++;
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name: string) {
        return classes.has(name);
      },
    },
    setAttribute() {
      count.writes++;
    },
    appendChild() {
      count.writes++;
    },
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) {
        hit = makeEl();
        found.set(sel, hit);
      }
      return hit;
    },
  };
  let text = '';
  let html = '';
  let cls = '';
  let hidden = false;
  Object.defineProperty(el, 'textContent', {
    get: () => {
      count.readText++;
      return text;
    },
    set: (v) => {
      count.writes++;
      text = String(v);
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (v) => {
      count.writes++;
      html = String(v);
    },
  });
  Object.defineProperty(el, 'className', {
    get: () => cls,
    set: (v) => {
      count.writes++;
      cls = String(v);
    },
  });
  Object.defineProperty(el, 'hidden', {
    get: () => hidden,
    set: (v) => {
      count.writes++;
      hidden = !!v;
    },
  });
  (el as any).said = () => text;
  return el;
}

(globalThis as any).document = { createElement: () => makeEl() };

const { Roster, ROSTER_TUNE, quantiseMetres, distanceWords, worldWords } = await import('../../../src/ui/hud.ts');
// The interface's own bands, so what a made-up group is judged against here is the same function
// the row is drawn through and not a second copy of its thresholds.
const { barBand } = await import('../../../src/ui/hudMath.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

/**
 * How many steady frames the allocation measurement runs, and what the heap is allowed to grow by
 * across them at its worst. Both INVENTED, and both are here rather than in the game because they
 * are about measuring, not about playing. Measured on this machine, over sixty thousand calls:
 * handing the roster the same group again grows the heap by 12 kB, which is noise; allocating one
 * short string each time grows it by 2.3 MB. A quarter of a megabyte sits twenty times above the
 * noise and nine times under a real allocation, and the run-to-run spread is a couple of kilobytes.
 */
const ALLOC_FRAMES = 60000;
const ALLOC_BUDGET = 256 * 1024;

/** The worst the heap grew across a loop, sampled rather than taken at the end, because a collection anywhere in it would hide a real allocation. */
function heapGrowth(times: number, step: (i: number) => void): number {
  const base = process.memoryUsage().heapUsed;
  let peak = 0;
  for (let i = 0; i < times; i++) {
    step(i);
    if ((i & 1023) === 0) {
      const d = process.memoryUsage().heapUsed - base;
      if (d > peak) peak = d;
    }
  }
  const end = process.memoryUsage().heapUsed - base;
  return end > peak ? end : peak;
}

/**
 * A group the caller keeps and refills, which is how the roster asks to be fed. The fields are the
 * ones the group itself keeps (`GroupMember` in `src/net/groups.ts`), so the display is handed that
 * list with nothing adapted: a health below zero is one nothing carries yet, `here` false is a
 * browser that is reloading or shut, and a distance below zero means one of three different things,
 * which is what the world column has to tell apart.
 */
type Member = {
  id: number;
  name: string;
  hp: number;
  planet: string;
  zone: string;
  leader: boolean;
  me: boolean;
  here: boolean;
  distance: number;
  away?: boolean;
};
const group: Member[] = [
  { id: 1, name: 'Riva', hp: 1, planet: 'tatooine', zone: '', leader: true, me: false, here: true, distance: 12 },
  { id: 2, name: 'Tem', hp: 1, planet: 'tatooine', zone: '', leader: false, me: true, here: true, distance: 0 },
  { id: 3, name: 'Osk', hp: 1, planet: 'tatooine', zone: '', leader: false, me: false, here: true, distance: 500 },
];

const roster = new Roster(makeEl());

// ---------------------------------------------------------------------------------------------
// The first group: the block comes up and each row is written once. Your own row is the one that
// writes three values rather than four — it carries no distance from itself.
{
  const made = writes(() => roster.set(group));
  ok(made === 14, `three members is the block up, the values on each row and the two marks (wrote ${made})`);
  ok(roster.report().rows === 3, 'and three rows stand');
  ok(count.transform > 0, 'the health bar moved by a transform');
  ok(count.width === 0, 'and never by a width');
  ok(roster.report().lines.indexOf('Tem (you) 100% |') > 0, `your own row carries no distance from yourself: ${roster.report().lines}`);
}

// ---------------------------------------------------------------------------------------------
// A steady frame: nothing written, and nothing read back off the page either.
{
  const before = roster.stats().writesNow;
  count.readText = 0;
  const made = writes(() => {
    for (let i = 0; i < 60; i++) {
      roster.set(group);
      roster.update();
    }
  });
  ok(made === 0, `sixty frames with nothing changed write nothing (wrote ${made})`);
  ok(count.readText === 0, `and its elements are never read back to find out what they say (${count.readText} reads)`);
  ok(roster.stats().writesNow - before === 0, 'and the roster agrees, which is the figure the console reads');
}

// ---------------------------------------------------------------------------------------------
// And nothing is allocated in them either. The only claim in this file that was ever a reading of
// the source rather than a number; it is a number now.
//
// The two halves of a frame are measured apart, and by different means, because only one of them
// can be weighed. `set` is all the work — eight rows of comparisons, every value against what the
// row is showing, and the strings a row would be written with — and it is weighed against a budget,
// with a control beside it that does allocate so the budget is known to be able to fail. `update`
// cannot be weighed the same way: its one reading of the clock is a boxed double in node, a dozen
// bytes a call, and whether V8 boxes it at all changes with the shape of the loop around it, so a
// weight here would measure node and not this file. What is pinned instead is exact: it reads the
// clock once a frame and does nothing else with it.
{
  const kB = (n: number) => Math.round(n / 1024);
  const steady = heapGrowth(ALLOC_FRAMES, () => roster.set(group));
  ok(steady < ALLOC_BUDGET, `${ALLOC_FRAMES} steady frames of the group grow the heap by ${kB(steady)} kB, under the ${kB(ALLOC_BUDGET)} kB budget`);
  let keep = '';
  const noisy = heapGrowth(ALLOC_FRAMES, (i) => {
    keep = `scaleX(${i / 160})`;
  });
  ok(noisy > ALLOC_BUDGET && keep.length > 0, `and it would notice one short string a frame, which grows it by ${kB(noisy)} kB`);
}

// ---------------------------------------------------------------------------------------------
// The frame's own call, against a clock this test holds: one reading a frame, and the second the
// writes are counted in closed on the far side of it.
{
  const real = globalThis.performance;
  let reads = 0;
  let ticks = 0;
  (globalThis as any).performance = { now: () => { reads++; return ticks; } };
  try {
    const timed = new Roster(makeEl());
    reads = 0;
    const made = writes(() => { for (let i = 0; i < 1000; i++) timed.update(); });
    ok(reads === 1000 && made === 0, `a thousand frames read the clock a thousand times and write nothing (${reads} reads, ${made} writes)`);
    timed.set(group);
    const inWindow = timed.stats().writesNow;
    ok(inWindow > 0 && timed.stats().writes === 0, 'what a frame writes is counted in the second it is being written in');
    ticks = 1200;
    timed.update();
    ok(timed.stats().writes === inWindow && timed.stats().writesNow === 0, 'and a second later that second is closed and the next one started');
  } finally {
    (globalThis as any).performance = real;
  }
}

// ---------------------------------------------------------------------------------------------
// The distance: compared in steps, and the words built only when they would differ.
{
  group[0].distance = 12.4;
  ok(writes(() => roster.set(group)) === 0, 'a distance that rounds to the same metre writes nothing');
  group[0].distance = 13.6;
  ok(writes(() => roster.set(group)) === 1, 'and a metre of it is one write and nothing else');
  // Far off, a metre either way is not worth a write: the step widens and the words do not move.
  group[2].distance = 501;
  ok(writes(() => roster.set(group)) === 0, 'a metre at five hundred is under the step out there');
  group[2].distance = 530;
  ok(writes(() => roster.set(group)) === 1, 'and a step of it writes once');
  group[2].distance = 1620;
  ok(writes(() => roster.set(group)) === 1, 'past a kilometre the row writes once and reads in kilometres');
  ok(roster.report().lines.indexOf('1.6 km') > 0, `and says so: ${roster.report().lines}`);
}

// ---------------------------------------------------------------------------------------------
// Two distances that read the same must round to the same number, or the roster would write the
// same words twice. Swept rather than argued.
{
  let clashes = 0;
  let seen = '';
  let last = -1;
  for (let m = 0; m <= 4000; m += 0.5) {
    const q = quantiseMetres(m);
    const words = distanceWords(q);
    if (q !== last) {
      last = q;
      seen = words;
      continue;
    }
    if (words !== seen) clashes++;
  }
  ok(clashes === 0, 'every distance that rounds the same reads the same, all the way to four kilometres');
  ok(quantiseMetres(-5) === 0 && quantiseMetres(NaN) === 0, 'a distance that is nonsense is nothing, not a NaN that writes every frame');
}

// ---------------------------------------------------------------------------------------------
// A world is named the way the game names it, out of the game's own table, and these are the ids
// that really cross: a planet's id with a zone's beside it, and a system whose id looks nothing
// like its name.
{
  ok(worldWords('naboo', '') === 'Naboo', 'a planet is its own name');
  ok(worldWords('yavin4', '') === 'Yavin IV', 'including one the table names something the id could never be tidied into');
  ok(worldWords('kashyyyk', 'main') === 'Kashyyyk: Kachirho', 'a zone is named after the planet it is on');
  ok(worldWords('kashyyyk', 'hunting') === 'Kashyyyk: Etyyy, the Hunting Grounds', 'by the name the game gives it, not by its id');
  ok(worldWords('space_light1', '') === 'Kessel', 'and a system reads as its own name rather than as the file it is kept in');
  ok(worldWords('space_heavy1', '') === 'Deep Space' && worldWords('space_ord_mantell', '') === 'Ord Mantell', 'as do the other two');
  ok(worldWords('kashyyyk', 'no_such_zone') === 'Kashyyyk', 'a zone the table does not know leaves the planet standing');
  ok(worldWords('some_other_world', '') === 'Some other world', 'and a world it has never heard of is tidied up rather than taking the display down');
  ok(worldWords('', '') === 'away', 'a world with no name at all still says something');
}

// ---------------------------------------------------------------------------------------------
// A member who really is elsewhere: where, not how far, and moving about there costs nothing.
{
  group[2].distance = -1;
  group[2].planet = 'naboo';
  const made = writes(() => roster.set(group));
  ok(made === 1, `leaving the world is one write on that row (wrote ${made})`);
  ok(roster.report().lines.indexOf('Naboo') > 0, `and the row reads where they are, not how far: ${roster.report().lines}`);
  ok(writes(() => roster.set(group)) === 0, 'and nothing more is written while they stay there');
  group[2].planet = 'space_naboo';
  ok(writes(() => roster.set(group)) === 1, 'going up to the system above it is one write');
  ok(roster.report().lines.indexOf('Naboo orbit') > 0, `which reads as that world: ${roster.report().lines}`);
  group[2].planet = 'kashyyyk';
  group[2].zone = 'rryatt_trail';
  ok(writes(() => roster.set(group)) === 1, 'and a planet the game splits into zones is one write too');
  ok(roster.report().lines.indexOf('Kashyyyk: Rryatt Trail') > 0, `naming both: ${roster.report().lines}`);
  // A member on another world is not measured, so however far they go nothing is written.
  group[2].distance = -1;
  ok(writes(() => roster.set(group)) === 0, 'and ninety kilometres of moving about there is still nothing');
  group[2].distance = 530;
  group[2].planet = 'tatooine';
  group[2].zone = '';
  ok(writes(() => roster.set(group)) === 1, 'coming back is one write again');
}

// ---------------------------------------------------------------------------------------------
// The three things a distance below zero means, told apart. This is the whole point of the column:
// the group sets -1 for a member who is elsewhere, for one whose browser has gone quiet, and for one
// standing beside you that nothing has been heard of yet, and only the first is a world.
{
  // Standing on your own planet with nothing heard of them: not a traveller.
  group[2].distance = -1;
  const heard = writes(() => roster.set(group));
  ok(heard === 1, `nothing heard of them is one write (wrote ${heard})`);
  ok(roster.report().lines.indexOf('Osk 100% away') > 0, `and the row says so in one plain word: ${roster.report().lines}`);
  ok(roster.report().lines.indexOf('Tatooine') < 0, 'and never names the planet you are both standing on');
  // Their browser reloading: the same word, and the row dims.
  group[2].here = false;
  const quiet = writes(() => roster.set(group));
  ok(quiet === 1, `a browser gone quiet dims its row with one write (wrote ${quiet})`);
  ok(roster.report().lines.indexOf('(away)') > 0, 'and the reading says which of the two it is');
  // Quiet AND carrying another planet's name: still not a traveller, because their place is stale.
  group[2].planet = 'naboo';
  ok(writes(() => roster.set(group)) === 0, 'a name left behind by a browser that has gone quiet moves nothing');
  ok(roster.report().lines.indexOf('Naboo') < 0, 'and is never read as them having travelled');
  group[2].here = true;
  const back = writes(() => roster.set(group));
  ok(back === 2, `their line coming back undims the row and reads the world again (wrote ${back})`);
  ok(roster.report().lines.indexOf('Naboo') > 0, `which is now a real world: ${roster.report().lines}`);
  // `away` said outright does the same as `here` false, for whoever would rather say it that way.
  group[2].away = true;
  ok(writes(() => roster.set(group)) === 2, 'and saying it outright instead does the same');
  group[2].away = false;
  group[2].planet = 'tatooine';
  group[2].distance = 530;
  roster.set(group);
}

// ---------------------------------------------------------------------------------------------
// A health nothing carries yet: an empty bar in a band of its own, not a member about to die.
{
  group[2].hp = -1;
  const made = writes(() => roster.set(group));
  ok(made === 3, `a health nobody carries is the bar emptied and the band changed (wrote ${made})`);
  ok(roster.report().lines.indexOf('— ') > 0, `and the row shows a dash rather than a number: ${roster.report().lines}`);
  ok(writes(() => roster.set(group)) === 0, 'and it is steady there');
  group[2].hp = 1;
  ok(writes(() => roster.set(group)) === 3, 'a health arriving fills it again');
}

// ---------------------------------------------------------------------------------------------
// Health: the bar and its band.
{
  count.transform = 0;
  group[0].hp = 0.99;
  ok(writes(() => roster.set(group)) === 1, 'a health that moves by a step of the bar writes the bar alone');
  group[0].hp = 0.9901;
  ok(writes(() => roster.set(group)) === 0, 'and one under a step of it writes nothing');
  const banded = writes(() => {
    group[0].hp = 0.2;
    roster.set(group);
  });
  ok(banded === 3, `crossing into another band is the bar and the two class marks (wrote ${banded})`);
  ok(count.width === 0, 'and the bar still never moves by a width');
  ok(roster.report().lines.indexOf('20%') > 0, `the row says what it is showing: ${roster.report().lines}`);
}

// ---------------------------------------------------------------------------------------------
// The leader and you: one mark each, and only when it changes.
{
  ok(writes(() => roster.set(group)) === 0, 'the marks are steady while nothing has changed');
  group[0].leader = false;
  group[1].leader = true;
  const made = writes(() => roster.set(group));
  ok(made === 2, `the lead changing hands is two writes (wrote ${made})`);
  ok(roster.report().lines.indexOf('Tem (leader) (you)') > 0, `and the reading says who it is: ${roster.report().lines}`);
  group[0].leader = true;
  group[1].leader = false;
  roster.set(group);
}

// ---------------------------------------------------------------------------------------------
// The group shrinking, standing alone, and going.
{
  const three = group.length;
  const made = writes(() => roster.set(group.slice(0, 2)));
  ok(made === 1, `a member leaving puts one row away (wrote ${made})`);
  ok(roster.report().rows === 2, 'and two rows stand');
  const alone = writes(() => roster.set(group.slice(0, 1)));
  ok(alone > 0 && roster.report().rows === 0, 'a group of one is not a group and the block stands down');
  ROSTER_TUNE.showAlone = 1;
  roster.set(group.slice(0, 1));
  ok(roster.report().rows === 1, 'unless the knob says to keep it up, which is how to look at it alone');
  ROSTER_TUNE.showAlone = 0;
  roster.set(group.slice(0, three));
  ok(roster.report().rows === 3, 'and the whole group comes back');
  roster.clear();
  ok(roster.report().rows === 0, 'no group at all takes the block away');
  // Leaving the world calls `clear()` where the frame that would notice has already stopped being
  // run, so the block must stay down on its own rather than because something keeps telling it to.
  ok(writes(() => { for (let i = 0; i < 30; i++) roster.update(); }) === 0, 'and thirty frames after it write nothing and leave it down');
  ok(roster.report().rows === 0 && writes(() => roster.set(null)) === 0, 'and it is still down');
}

// ---------------------------------------------------------------------------------------------
// More members than there are rows: counted, never dropped in silence. Your own row is the last of
// them, so the world everyone else is compared against is found over the whole group and not just
// over the rows that fit.
{
  const many: Member[] = [];
  for (let i = 0; i < ROSTER_TUNE.rows + 3; i++) {
    many.push({ id: i, name: `Name ${i}`, hp: 1, planet: 'tatooine', zone: '', leader: false, me: false, here: true, distance: i });
  }
  many[many.length - 1].me = true;
  many[0].distance = -1;
  roster.set(many);
  const r = roster.report();
  ok(r.rows === roster.size && r.over === 3, `the pool holds ${roster.size} and says the other ${r.over} had no row`);
  ok(r.lines.indexOf('Name 0 100% away') === 0, `and a ninth member does not make the first one a traveller: ${r.lines.slice(0, 40)}`);
  ok(writes(() => roster.set(many)) === 0, 'and a full roster is still steady');
}

// ---------------------------------------------------------------------------------------------
// The console's two calls.
{
  const stats = roster.stats();
  ok(roster.stats() === stats, 'stats() hands back one object, filled in place');
  const report = roster.report();
  ok(roster.report() === report, 'and so does report()');
  ok(report.styled === false, 'a page with no head for its rules is said to be styleless rather than left to look broken');
  const said: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => said.push(String(m));
  const before = ROSTER_TUNE.metreStep;
  const reply = roster.tune({ metreStop: 4 } as any);
  console.warn = warn;
  ok(said.length === 1 && ROSTER_TUNE.metreStep === before, 'tune() says so when given a step it does not have, and changes nothing');
  ok(reply !== (ROSTER_TUNE as any) && reply.metreStep === ROSTER_TUNE.metreStep, 'and hands back a copy with the live values in it');
  roster.tune({ metreStep: 10 });
  ok(ROSTER_TUNE.metreStep === 10, 'a step it does have is taken');
  // The reading taken in the gap between a step changing and the next group coming round must not
  // be a number the row is not showing.
  const gap = roster.report().lines;
  ok(gap.indexOf('?') > 0 && gap.indexOf('NaN') < 0, `what a step let go reads as a question until it is written again: ${gap}`);
  ok(writes(() => roster.set(group)) > 0, 'and what was written at the old step is written again at the new one');
  ok(roster.report().lines.indexOf('?') < 0, 'after which nothing is a question any more');
  roster.tune({ metreStep: before });
  roster.set(group);
  // Where the block sits is three properties the rules read, written when they move and never in a
  // frame: the steady count above is what says they are not written every time round.
  const top = ROSTER_TUNE.top;
  const moved = writes(() => roster.tune({ top: top + 40 }));
  ok(moved === 3, `moving the block writes its three placements and nothing else (wrote ${moved})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) roster.update(); }) === 0, 'and thirty frames after it write nothing at all');
  // Flush against the corner is a placement, not a mistake: the two offsets take a zero, the width
  // does not.
  const zeroed: string[] = [];
  console.warn = (m: string) => zeroed.push(String(m));
  roster.tune({ top: 0, side: 0 });
  const refusedWidth = roster.tune({ width: 0 });
  console.warn = warn;
  ok(zeroed.length === 1 && ROSTER_TUNE.top === 0 && ROSTER_TUNE.side === 0, 'the two offsets take a zero, so the block can be put flush against the corner');
  ok(refusedWidth.width > 0, 'and a block no pixels wide is refused out loud');
  roster.tune({ top });
  roster.tune({ side: 12, width: 168 });
}

// ---------------------------------------------------------------------------------------------
// The source: with one, the frame takes the group itself and the wiring is one line.
{
  let handed: Member[] | null = group;
  const fed = new Roster(makeEl());
  fed.source = () => handed;
  ok(writes(() => fed.update()) > 0, 'a roster with a source takes the group from it on its own');
  ok(fed.report().rows === group.length, 'and stands a row for each of them');
  ok(writes(() => { for (let i = 0; i < 30; i++) fed.update(); }) === 0, 'and thirty frames of the same group write nothing');
  handed = null;
  ok(writes(() => fed.update()) > 0 && fed.report().rows === 0, 'a source that answers with no group takes the block away');
  ok(writes(() => { for (let i = 0; i < 30; i++) fed.update(); }) === 0, 'and keeps it away without writing');
  const bare = new Roster(makeEl());
  ok(writes(() => { for (let i = 0; i < 30; i++) bare.update(); }) === 0, 'a roster nobody has given a source pulls nothing at all');
  // A made-up group put up at the console must not be written over by the real one a frame later.
  handed = group;
  fed.update();
  fed.standIn(4);
  ok(writes(() => { for (let i = 0; i < 10; i++) fed.update(); }) === 0, 'a made-up group holds the block against the frame that would refill it');
  ok(fed.report().rows === 4, 'and stands where it was put');
  fed.standIn(0);
  fed.update();
  ok(fed.report().rows === group.length, 'putting it down hands the block back to the real group');
  fed.standIn(3);
  fed.clear();
  fed.update();
  ok(fed.report().rows === group.length, 'and leaving the world lets a made-up group go rather than holding the block for good');
}

// ---------------------------------------------------------------------------------------------
// The console's made-up group, which is how the block is looked at with nobody else connected. Its
// healths must reach every band at whatever size it is asked for, or the owner is sent looking for
// a fault in the bands that is not there.
{
  const bands = (n: number): string[] => {
    roster.standIn(n);
    const out: string[] = [];
    for (const part of roster.report().lines.split(' | ')) {
      const share = /(\d+)%/.exec(part);
      if (!share) continue;
      out.push(barBand(Number(share[1]) / 100));
    }
    return out;
  };
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const seen = bands(n);
    ok(
      seen.indexOf('good') >= 0 && seen.indexOf('warn') >= 0 && seen.indexOf('bad') >= 0,
      `a made-up group of ${n} shows all three bands (${seen.join(', ')})`,
    );
  }
  const made = roster.standIn(4);
  ok(made.length === 4 && roster.report().rows === 4, 'a made-up group of four stands four rows');
  const lines = roster.report().lines;
  ok(lines.indexOf('Naboo') > 0, `with one of them on another world: ${lines}`);
  ok(lines.indexOf('(away)') > 0, 'one whose browser has gone quiet');
  ok(lines.indexOf(' m') > 0, 'and the rest at a distance, so all three readings show at once');
  ok(lines.indexOf('(you)') > 0, 'and one of them is yours');
  ok(roster.standIn(4) === made, 'and asking again refills the same rows rather than making new ones');
  ok(writes(() => roster.standIn(4)) === 0, 'so the same made-up group writes nothing either');
  ok(roster.standIn(99).length === roster.size, 'more than the pool holds is held to the pool');
  roster.clear();
}

console.log(`\n${checks} checks passed`);
