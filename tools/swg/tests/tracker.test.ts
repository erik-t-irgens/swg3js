// The jobs followed (src/ui/tracker.ts): what it shows, how it rounds, and that it writes only on change.
//
// What is pinned here:
//
//   - a distance is said to ten metres and to a tenth of a kilometre from a kilometre; time left to the
//     second under ten minutes, in minutes under an hour and in hours and minutes beyond, rounded up;
//   - the jobs shown are the tracked ones still to follow, in their order, and with none of those the
//     newest job running;
//   - a time limit is said once, as its clock comes under ten minutes, and not at all for one that began
//     under it; a timer that finishes a step is no limit;
//   - a line shows what it counts, how far its place is (or which world it is on) and how long it has;
//   - an update that would show what is already shown writes nothing, and a hidden tracker writes nothing;
//   - its place under the roster is written once when it is told where to stand, and not again unchanged.
//
// Synthetic: a stand-in for the page and views made up here.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a stand-in for the page, counting every write -----------------------------------------------------------
let writes = 0;
function makeEl(): any {
  const kids: any[] = [];
  let text = '';
  let hidden = false;
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const el: any = {
    className: '',
    children: kids,
    appendChild(k: any) {
      kids.push(k);
      return k;
    },
    classList: {
      toggle(c: string, on: boolean) {
        if (on) classes.add(c);
        else classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
    },
    style: {
      setProperty(k: string, v: string) {
        props.set(k, v);
      },
      getPropertyValue: (k: string) => props.get(k) ?? '',
    },
    rect: { height: 0, bottom: 0 },
    getBoundingClientRect() {
      return el.rect;
    },
  };
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => ((text = String(v)), writes++) });
  Object.defineProperty(el, 'hidden', { get: () => hidden, set: (v) => ((hidden = !!v), writes++) });
  return el;
}
(globalThis as any).document = { createElement: () => makeEl() };

const { TRACKER_TUNE, TimeWarnings, Tracker, pickShown, trackerDistance, trackerTime, tuneTracker } = await import('../../../src/ui/tracker.ts');
type View = import('../../../src/story/view.ts').StoryView;
type QuestView = import('../../../src/story/view.ts').QuestView;

const DEFAULTS = { ...TRACKER_TUNE };
const quest = (id: string, o: Partial<QuestView> = {}): QuestView => ({ id, title: `TEST: ${id}`, client: 'none', state: 'active', lines: [], canDrop: true, canRestart: true, at: 0, ...o });
const viewOf = (quests: QuestView[], tracked: string[] = [], waypoints: View['waypoints'] = []): View => ({ rev: 1, quests, waypoints, watch: [], cast: [], objects: [], tracked, trackWp: null });

// ---- rounding ------------------------------------------------------------------------------------------------
{
  ok(trackerDistance(4) === '0 m' && trackerDistance(14) === '10 m' && trackerDistance(996) === '1000 m' && trackerDistance(1000) === '1.0 km' && trackerDistance(1449) === '1.4 km' && trackerDistance(12345) === '12.3 km', 'a distance is said to ten metres, then to a tenth of a kilometre');
  ok(trackerDistance(Number.NaN) === '' && trackerDistance(-1) === '', 'and nothing at all for none');
  ok(trackerTime(59001) === '1:00' && trackerTime(5000) === '0:05' && trackerTime(0) === '0:00' && trackerTime(-3000) === '0:00' && trackerTime(599000) === '9:59', 'under ten minutes, to the second, rounded up, and nought once it has run out');
  ok(trackerTime(600000) === '10 min' && trackerTime(1801000) === '31 min' && trackerTime(3600000) === '1 h 00 min' && trackerTime(7322000) === '2 h 03 min', 'then in minutes, then in hours and minutes');
}

// ---- which jobs ----------------------------------------------------------------------------------------------
{
  const out: QuestView[] = [];
  const v = viewOf([quest('test:a', { at: 10 }), quest('test:b', { at: 30 }), quest('test:c', { at: 20, state: 'done' }), quest('test:d', { at: 40, state: 'stalled', stalled: 'held' })], ['test:d', 'test:c', 'test:a']);
  ok(pickShown(v, out) === 2 && out[0].id === 'test:d' && out[1].id === 'test:a', 'the tracked jobs still to follow, in their order: a held one still is, a done one is not');
  ok(pickShown(viewOf(v.quests, ['test:c']), out) === 1 && out[0].id === 'test:b', 'with none of the tracked still running, the newest job running is shown');
  tuneTracker({ autoTrack: false });
  ok(pickShown(viewOf(v.quests, []), out) === 0, 'unless that is switched off');
  tuneTracker({ autoTrack: true });
  ok(pickShown(null, out) === 0, 'and with no view, none');
}

// ---- time limits about to run out, said once -------------------------------------------------------------------
{
  const w = new TimeWarnings();
  const said: string[] = [];
  const line = (deadline: number, limit = true) => ({ quest: 'test:t', step: 'race', text: 'TEST: race', deadline, ...(limit ? { limit: true as const } : {}) });
  const v = (lines: ReturnType<typeof line>[]) => viewOf([quest('test:t', { lines })]);
  const at = 1_000_000;
  w.check(v([line(at + 900000)]), at, (_q, l) => said.push(l.step));
  ok(said.length === 0, 'fifteen minutes left: nothing said');
  w.check(v([line(at + 900000)]), at + 300001, (_q, l) => said.push(l.step));
  w.check(v([line(at + 900000)]), at + 301000, (_q, l) => said.push(l.step));
  ok(said.length === 1, 'under ten minutes: said once, and once only');
  const w2 = new TimeWarnings();
  const said2: string[] = [];
  w2.check(v([line(at + 60000), line(at + 700000, false)]), at, (_q, l) => said2.push(l.step));
  w2.check(v([line(at + 60000), line(at + 700000, false)]), at + 200000, (_q, l) => said2.push(l.step));
  ok(said2.length === 0, 'a limit that began under ten minutes is not said, and a timer that finishes a step is no limit');
}

// ---- the lines, and writes only on change ------------------------------------------------------------------------
{
  const root = makeEl();
  const t = new Tracker(root);
  t.text = (r) => (typeof r === 'string' ? r : r.en);
  t.worldName = (id) => `World ${id}`;
  const now = 5_000_000;
  const v = viewOf(
    [
      quest('test:kill', {
        at: 1,
        lines: [
          { quest: 'test:kill', step: 'mites', text: 'TEST: kill three', n: 1, of: 3 },
          { quest: 'test:kill', step: 'race', text: 'TEST: reach it', wp: 'q:test:kill#race', deadline: now + 125000, limit: true },
          { quest: 'test:kill', step: 'far', text: 'TEST: far off', wp: 'q:test:kill#far' },
          { quest: 'test:kill', step: 'old', text: 'TEST: done one', done: true },
        ],
      }),
    ],
    [],
    [
      { id: 'q:test:kill#race', name: 'x', world: 'tatooine', f: 'raw', p: [100, 0, null], colour: 'component', on: true, quest: 'test:kill', step: 'race' },
      { id: 'q:test:kill#far', name: 'y', world: 'naboo', f: 'raw', p: [0, 0, null], colour: 'component', on: true, quest: 'test:kill', step: 'far' },
    ],
  );
  const here = { world: 'tatooine', x: 0, z: 0 };
  t.update(v, here, now, true, '', 0);
  const r = t.report() as { shown: boolean; jobs: { title: string; lines: string[] }[] };
  ok(r.shown && r.jobs.length === 1 && r.jobs[0].title === 'TEST: test:kill', 'the newest job running is shown, by its title');
  ok(r.jobs[0].lines[0] === 'TEST: kill three [1/3]' && r.jobs[0].lines[1] === 'TEST: reach it [100 m · 2:05]' && r.jobs[0].lines[2] === 'TEST: far off [World naboo]' && r.jobs[0].lines[3] === 'TEST: done one (done)', `each line with its count, its distance and its time; one on another world names it; the done ones last (${r.jobs[0].lines.join(' | ')})`);
  const before = writes;
  t.update(v, here, now + 200, true, '', 100);
  ok(writes === before, 'the same again a fifth of a second on: nothing written at all');
  t.update(v, { world: 'tatooine', x: 3, z: 0 }, now + 400, true, '', 200);
  ok(writes === before, 'three metres closer is the same ten metres: still nothing');
  t.update(v, here, now + 1400, true, '', 300);
  ok(writes === before + 1, 'a second on, the clock ticks over: one write, the clock alone');
  t.update(v, here, now + 1400, false, '', 400);
  const hidden = writes;
  t.update(v, here, now + 9000, false, '', 500);
  ok(writes === hidden && !(t.report() as { shown: boolean }).shown, 'switched off it is hidden, and writes nothing while it stays so');
  t.update(null, here, now, true, 'TEST: held by the server', 600);
  ok((t.report() as { note: string }).note === 'TEST: held by the server', 'a line in place of the jobs, while the story cannot be worked');
  t.update(null, here, now, true, '', 1200);
  ok(t.writesLastSecond > 0 && !(t.report() as { shown: boolean }).shown, 'nothing to show: it stands down, and its writes are counted by the second');
}

// ---- its place under the roster --------------------------------------------------------------------------------
{
  const t = new Tracker(makeEl());
  const roster = makeEl();
  t.follow(roster, 96, 6);
  ok(t.root.style.getPropertyValue('--tracker-top') === '96px', 'with the roster away, it stands where the roster would start');
  roster.rect = { height: 80, bottom: 176 };
  t.follow(roster, 96, 6);
  ok(t.root.style.getPropertyValue('--tracker-top') === '182px', 'with the roster up, under it and a gap');
  const n = (t.report() as { writesNow: number }).writesNow;
  t.follow(roster, 96, 6);
  ok((t.report() as { writesNow: number }).writesNow === n, 'and told the same place again, it writes nothing');
}

Object.assign(TRACKER_TUNE, DEFAULTS);
console.log(`\n${checks} checks passed`);
