// The map window's tabs (src/ui/mapTabs.ts, src/ui/mapUi.ts): Here and Galaxy are pictures drawn on the
// window's one WebGL canvas, and Waypoints and Group are lists. What is pinned here is what going to a list
// may never do -- move the canvas into the galaxy, give it a size, or leave a frame loop running -- and the
// rules round the tabs: which one a plain opening opens on and how that is remembered, that Group is only
// offered while a group is held, what each tab's own key does, and that a list's page is told when it shows
// and when it goes, once each way.
//
// The window itself is built here, against a stand-in page that records what is done to the canvas and a
// stand-in galaxy that records every `attachCanvas`, so it is the window's own code being run and not a
// copy of it. Nothing here is read from the game's files.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the stand-in page ----------------------------------------------------------------------------------

/** What was done to the canvases that matters here: a size written, and every element they were put in. */
const canvasLog = { sizes: 0, moves: 0 };
const canvases: any[] = [];

/** The header's four tab buttons, in the order the markup has them, with the words the markup gives them. */
const TAB_WORDS: Record<string, string> = { here: 'Here', galaxy: 'Galaxy', waypoints: 'Waypoints', group: 'Group' };

function el(tag = 'div'): any {
  const classes = new Set<string>();
  const found = new Map<string, any>();
  let first: any = null;
  let tabs: any[] | null = null;
  let width = 0;
  let height = 0;
  const e: any = {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    parentElement: null,
    hidden: false,
    title: '',
    textContent: '',
    innerHTML: '',
    id: '',
    style: {},
    dataset: {},
    clientWidth: 0,
    clientHeight: 0,
    classList: {
      add: (n: string) => void classes.add(n),
      remove: (n: string) => void classes.delete(n),
      toggle: (n: string, on?: boolean) => {
        const want = on === undefined ? !classes.has(n) : on;
        if (want) classes.add(n);
        else classes.delete(n);
      },
      contains: (n: string) => classes.has(n),
    },
    appendChild(k: any) {
      k.parentElement?.children.splice(k.parentElement.children.indexOf(k), 1);
      k.parentElement = e;
      e.children.push(k);
      if (k.tagName === 'CANVAS') canvasLog.moves++;
      return k;
    },
    insertBefore(k: any) {
      return e.appendChild(k);
    },
    prepend(k: any) {
      return e.appendChild(k);
    },
    remove() {
      if (e.parentElement) e.parentElement.children.splice(e.parentElement.children.indexOf(e), 1);
      e.parentElement = null;
    },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) {
        hit = el();
        found.set(sel, hit);
      }
      return hit;
    },
    // The header's tab buttons are the same elements the window finds one at a time by their `data-tab`,
    // so a button the window hides or lights is the one the test reads; anything else is a list of none.
    querySelectorAll(sel: string) {
      if (sel !== '.tabs .tab') return [] as any[];
      tabs ??= Object.keys(TAB_WORDS).map((tab) => {
        const b = e.querySelector(`.tabs .tab[data-tab="${tab}"]`);
        b.dataset.tab = tab;
        b.textContent = TAB_WORDS[tab];
        return b;
      });
      return tabs;
    },
    getContext: (kind: string) => (kind === '2d' ? { setTransform() {}, fillRect() {} } : null),
  };
  Object.defineProperty(e, 'className', {
    get: () => [...classes].join(' '),
    set: (v: string) => {
      classes.clear();
      for (const p of String(v).split(/\s+/)) if (p) classes.add(p);
    },
  });
  Object.defineProperty(e, 'firstElementChild', { get: () => (first ??= el()) });
  if (tag === 'canvas') {
    Object.defineProperty(e, 'width', { get: () => width, set: (v: number) => ((width = v), canvasLog.sizes++) });
    Object.defineProperty(e, 'height', { get: () => height, set: (v: number) => ((height = v), canvasLog.sizes++) });
    canvases.push(e);
  }
  return e;
}

const store = new Map<string, string>();
let storageThrows = false;
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement: (tag: string) => el(tag),
  createTextNode: (t: string) => ({ textContent: t }),
  getElementById: () => null,
  head: { appendChild() {} },
};
g.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
g.Image = class {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get: () => {
    if (storageThrows) throw new Error('storage is locked');
    return {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
  },
});
/** The frame loop: a frame asked for is counted and never run, so nothing draws behind the test's back. */
let framesAsked = 0;
let nextId = 0;
g.requestAnimationFrame = () => {
  framesAsked++;
  return ++nextId;
};
g.cancelAnimationFrame = () => {};

const { MAP_TABS, MAP_TAB_KEY, isListTab, isMapTab, pressTabKey, recallTab, rememberTab, tabKey, tabShown } = await import('../../../src/ui/mapTabs.ts');
const { MapUi } = await import('../../../src/ui/mapUi.ts');
const { WaypointsUi } = await import('../../../src/ui/waypointsUi.ts');
const { GroupUi } = await import('../../../src/ui/groupUi.ts');
const { Groups } = await import('../../../src/net/groups.ts');

// --- the rules alone -------------------------------------------------------------------------------------
{
  ok(MAP_TABS.join() === 'here,galaxy,waypoints,group', 'four tabs, in the order the header shows them');
  ok(isMapTab('waypoints') && !isMapTab('Waypoints') && !isMapTab(null) && !isMapTab('__proto__'), 'a tab is one of the four by name, and nothing else is');
  ok(isListTab('waypoints') && isListTab('group') && !isListTab('here') && !isListTab('galaxy'), 'Waypoints and Group are lists; Here and Galaxy are pictures');
  ok(tabShown('group', false) === 'here' && tabShown('group', true) === 'group' && tabShown('waypoints', false) === 'waypoints', 'Group with no group held shows Here, and nothing else falls back');
  ok(tabKey(false, 'here', 'group', true) === 'open', "a tab's key with the map shut opens it on that tab");
  ok(tabKey(true, 'here', 'waypoints', true) === 'switch', 'with the map open on another tab, it switches');
  ok(tabKey(true, 'waypoints', 'waypoints', true) === 'close', 'and pressed on its own tab it shuts the map');
  ok(tabKey(false, 'here', 'group', false) === 'none' && tabKey(true, 'here', 'group', false) === 'none', 'the full stop with no group held opens nothing and switches to nothing');
  ok(tabKey(true, 'group', 'group', false) === 'close', 'but pressed on a Group tab left showing when the group ended, it shuts the map like any tab key on its own tab');
  store.clear();
  rememberTab('galaxy');
  ok(store.get(MAP_TAB_KEY) === 'galaxy' && recallTab() === 'galaxy', 'the tab used last is kept in local storage and read back');
  store.set(MAP_TAB_KEY, 'nowhere');
  ok(recallTab() === null, 'a stored value that is not a tab is ignored');
  storageThrows = true;
  ok(recallTab() === null, 'storage that throws reads as nothing kept');
  let threw = false;
  try {
    rememberTab('waypoints');
  } catch {
    threw = true;
  }
  ok(!threw, 'and keeping a tab where storage throws costs nothing but the memory');
  storageThrows = false;
}

// --- the window -------------------------------------------------------------------------------------------

const galaxyLog = { attach: 0, shows: 0, hides: 0 };
const galaxy = {
  root: el(),
  attachCanvas: () => void galaxyLog.attach++,
  show: () => void galaxyLog.shows++,
  hide: () => void galaxyLog.hides++,
  setCurrent() {},
};
let grouped = false;
const told: string[] = [];
const source = {
  here: () => ({ packId: 'test', name: 'Test', space: false }),
  player: () => ({ x: 0, y: 0, z: 0, heading: 0, altitude: null }),
  center: () => ({ x: 0, z: 0 }),
  pois: async () => [],
  objects() {},
  ships() {},
  pack: () => null,
  piloting: () => false,
  onHyperspace() {},
  onTeleport() {},
  groupTab: () => grouped,
};
store.clear();
store.set(MAP_TAB_KEY, 'waypoints');
const map = new MapUi(el() as never, galaxy as never, source as never);
const raf = () => (map as unknown as { raf: number }).raf;
const canvas3d = canvases[1];
const waypointsPage = el();
const groupPage = el();
map.adoptBody('waypoints', waypointsPage, (on) => told.push(`waypoints ${on ? 'up' : 'down'}`));
map.adoptBody('group', groupPage, (on) => told.push(`group ${on ? 'up' : 'down'}`));
const bodies = { waypoints: map.root.querySelector('.map-body.list.waypoints'), group: map.root.querySelector('.map-body.list.group'), here: map.root.querySelector('.map-body.here') };
ok(waypointsPage.parentElement === bodies.waypoints && groupPage.parentElement === bodies.group, "each list's page goes in its own tab's body");
ok(canvases.length >= 2 && canvas3d.parentElement === bodies.here, 'the shared canvas starts in the Here body');


/** The tab buttons that carry `on`, by name, and the four bodies' `hidden` as a word each. */
const lit = () => (map.root.querySelectorAll('.tabs .tab') as any[]).filter((b) => b.classList.contains('on')).map((b) => b.dataset.tab).join();
const shown = () => (['here', 'waypoints', 'group'] as const).filter((t) => !bodies[t].hidden).join();

{
  // A plain opening, with Waypoints remembered from before.
  canvasLog.sizes = 0;
  canvasLog.moves = 0;
  framesAsked = 0;
  map.show();
  ok(map.open && map.tabNow === 'waypoints', 'opened plainly, the window opens on the tab kept from before');
  ok(galaxyLog.attach === 0 && canvasLog.moves === 0 && canvasLog.sizes === 0, 'showing the Waypoints tab never hands the canvas to the galaxy, moves it or sizes it');
  ok(raf() === 0 && framesAsked === 0, 'and runs no frame loop: no frame is asked for and none is left waiting');
  ok(shown() === 'waypoints', `its body shows and the others are hidden (${shown()})`);
  ok(lit() === 'waypoints', `and its button alone is lit (${lit()})`);
  ok(canvas3d.parentElement === bodies.here, 'the canvas is still where it was, inside the hidden Here body');
  ok(told.join() === 'waypoints up', 'and its page is told it is showing, once');
  // To Here and back: the picture runs as it always did, and leaving it stops it.
  map.showTab('here');
  ok(map.tabNow === 'here' && raf() !== 0 && framesAsked === 1, 'Here runs its frame loop again');
  ok(shown() === 'here' && lit() === 'here', `and the Waypoints list is hidden again under the picture, Here alone lit (${shown()}; ${lit()})`);
  ok(told.join() === 'waypoints up,waypoints down', 'and the Waypoints page is told it has gone');
  ok(store.get(MAP_TAB_KEY) === 'here', 'and Here is now the tab kept');
  // Group is not on offer with no group held: the window shows Here, the button is hidden.
  map.showTab('group');
  ok(map.tabNow === 'here' && map.root.querySelector('.tabs .tab[data-tab="group"]').hidden, 'with no group held, asking for Group shows Here and its button stays hidden');
  ok(!told.includes('group up') && shown() === 'here', 'and the group page is never told it is showing, nor its body shown');
  // With a group, Group is a list like Waypoints.
  grouped = true;
  const sizesBefore = canvasLog.sizes;
  const attachBefore = galaxyLog.attach;
  map.showTab('group');
  ok(map.tabNow === 'group' && !map.root.querySelector('.tabs .tab[data-tab="group"]').hidden, 'with a group held, the Group tab is offered and shown');
  ok(shown() === 'group' && lit() === 'group', `its body alone shows and its button alone is lit (${shown()}; ${lit()})`);
  ok(raf() === 0 && canvasLog.sizes === sizesBefore && galaxyLog.attach === attachBefore, 'and showing it stops the loop and never touches the canvas');
  ok(told.at(-1) === 'group up', 'and its page is told it is showing');
  // Shutting the window tells the page it has gone, and remembers the tab.
  map.hide();
  ok(!map.open && told.at(-1) === 'group down', 'shutting the window tells the page it has gone');
  map.hide();
  ok(told.filter((t) => t === 'group down').length === 1, 'and shutting it again tells it nothing more');
  ok(store.get(MAP_TAB_KEY) === 'group', 'the window opens on Group next time');
  // The group gone, the kept Group opens Here.
  grouped = false;
  map.show();
  ok(map.tabNow === 'here' && shown() === 'here', 'with the group gone, a window kept on Group opens on Here');
  map.hide();
  // A tab named outright wins over the kept one, as "Show on map" asks for Here.
  store.set(MAP_TAB_KEY, 'waypoints');
  map.show('here');
  ok(map.tabNow === 'here', 'a tab named outright wins over the one kept');
  map.hide();
}

{
  // The keys written on the window follow the bindings: the close button names the map's own key, and each
  // tab's title the key that opens the window on it.
  map.setKeys('M', 'Y', '.');
  ok(map.root.querySelector('.close').textContent === 'Close (M)', "the close button names the map's own key");
  const titles = () => (map.root.querySelectorAll('.tabs .tab') as any[]).map((b) => b.title).join(' | ');
  ok(titles() === 'Here (M) | Galaxy (M) | Waypoints (Y) | Group (.)', `each tab's title names its key (${titles()})`);
  map.setKeys('N', 'K', 'Comma');
  ok(map.root.querySelector('.close').textContent === 'Close (N)', 'and the close button follows a rebind');
  ok(titles() === 'Here (N) | Galaxy (N) | Waypoints (K) | Group (Comma)', `and so do the titles (${titles()})`);
  map.setKeys('M', 'Y', '.');
}

{
  // A window built where storage cannot be read opens on Here.
  storageThrows = true;
  const blind = new MapUi(el() as never, galaxy as never, source as never);
  blind.show();
  ok(blind.tabNow === 'here', 'a window built where storage throws opens on Here');
  blind.hide();
  storageThrows = false;
}

// --- what Y and the full stop do, on the real window -------------------------------------------------------
// The game's keys go through `pressTabKey` with the map, a way to shut it and a way to open it on a tab; the
// same function is driven here on the real window, so a key that does the wrong thing fails here and not on
// the owner's screen.
{
  const shut = () => map.hide();
  const openOn = (tab: string) => map.show(tab as never);
  const press = (tab: 'waypoints' | 'group') => pressTabKey(map, tab, tab !== 'group' || grouped, shut, openOn);
  store.set(MAP_TAB_KEY, 'galaxy');
  grouped = false;
  ok(press('waypoints') === 'open' && map.open && map.tabNow === 'waypoints', 'Y with the map shut opens it on Waypoints, not on the tab kept');
  ok(press('waypoints') === 'close' && !map.open, 'Y again on Waypoints shuts the map');
  map.show('here');
  ok(press('waypoints') === 'switch' && map.open && map.tabNow === 'waypoints', 'Y with the map on Here switches it to Waypoints and leaves it open');
  ok(press('group') === 'none' && map.open && map.tabNow === 'waypoints', 'the full stop with no group held does nothing to the open map');
  map.hide();
  ok(press('group') === 'none' && !map.open, 'nor to a shut one');
  grouped = true;
  ok(press('group') === 'open' && map.open && map.tabNow === 'group', 'with a group held the full stop opens the map on Group');
  ok(press('waypoints') === 'switch' && map.tabNow === 'waypoints' && press('group') === 'switch' && map.tabNow === 'group', 'and Y and the full stop switch between the two lists');
  // The group ends with its tab showing: the full stop still shuts the map from its own tab.
  grouped = false;
  ok(press('group') === 'close' && !map.open, 'the group gone while its tab shows, the full stop on that tab still shuts the map');
  // The opener is the caller's to refuse: nothing opens behind its back.
  ok(pressTabKey(map, 'waypoints', true, shut, () => {}) === 'open' && !map.open, 'and a refused opening leaves the map shut');
}

// --- the real pages, handed to the real window the way the game hands them --------------------------------
// The game hands the map each page's own `shown` and nothing of its own (read below), so the pages are built
// here and handed over the same way, and what the map shows is what the player would see: a page that is not
// hidden while its tab shows, and is hidden again when the tab goes or the map shuts.
{
  const page = new MapUi(el() as never, galaxy as never, source as never);
  const waypoints = new WaypointsUi();
  let asked = 0;
  page.adoptBody('waypoints', waypoints.root, waypoints.shownFrom(() => {
    asked++;
    return { rows: [], count: 0, max: 100, markWhy: '', note: '' };
  }));
  const groups = new Groups(() => 0);
  const roster = new GroupUi(el() as never, {
    groups,
    note: () => {},
    project: () => false,
    anchor: () => false,
    view: () => false,
    peersHere: () => 0,
    canOpen: () => false,
  });
  page.adoptBody('group', roster.panel, roster.shown);
  ok(!waypoints.open && !roster.open, 'both pages start hidden');
  page.show('waypoints');
  ok(waypoints.open && asked === 1 && !roster.open, 'the Waypoints tab shows the waypoints page, drawn from the book as it comes up');
  page.showTab('here');
  ok(!waypoints.open, 'Here hides it again');
  page.showTab('waypoints');
  page.hide();
  ok(!waypoints.open, 'and so does shutting the map');
  grouped = true;
  page.show('group');
  ok(roster.open && !waypoints.open, 'the Group tab shows the roster');
  page.showTab('here');
  ok(!roster.open, 'Here hides it');
  page.show('group');
  page.hide();
  ok(!roster.open, 'and so does shutting the map');
  grouped = false;
  roster.dispose();
}

// --- the wiring, read out of main.ts -----------------------------------------------------------------------
// main.ts cannot be loaded here (it reaches for WebGL in its constructor), so what it hands the window is read.
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  /** A method's body, from its declaration to the closing brace at its own indent; '' when it is not found. */
  const body = (head: string): string => {
    const at = main.indexOf(head);
    ok(at > 0, `${head.trim().replace(/^private /, '').replace(/\(.*/, '')} is found in main.ts`);
    return at < 0 ? '' : main.slice(at, main.indexOf('\n  }\n', at));
  };
  ok(/groupTab: \(\) => this\.groupHeld\(\),/.test(main) && /this\.groupHeld = \(\) => groups\.active;/.test(main), 'the Group tab is offered while a server holds a group for this browser');
  ok(/this\.map\.adoptBody\('waypoints', this\.waypointsUi\.root, this\.waypointsUi\.shownFrom\(\(\) => this\.waypointsModel\(\)\)\);/.test(main), 'the waypoints page is handed to the map with its own shownFrom, drawn from the book');
  ok(/this\.map\.adoptBody\('group', groupUi\.panel, groupUi\.shown\);/.test(main), 'and the roster with its own shown');
  ok(/input\.pressedAction\('waypoints'\)[^\n]*this\.toggleMapTab\('waypoints'\)/.test(main) && /input\.pressedAction\('group'\)[^\n]*this\.toggleMapTab\('group'\)/.test(main), 'Y and the full stop open their tabs through the one rule');
  const toggle = body("  private toggleMapTab(tab: 'waypoints' | 'group'): void {");
  ok(/pressTabKey\(this\.map, tab, tab !== 'group' \|\| this\.groupHeld\(\), \(\) => this\.toggleMap\(\), \(on\) => \{\s*if \(!this\.started \|\| !this\.inWorld \|\| this\.traveling\) return;\s*this\.closePanels\(\);\s*this\.toggleMap\(on\);\s*\}\);/.test(toggle), 'which is pressTabKey: shutting through toggleMap, opening on the tab through toggleMap(on) after the other panels close');
  const toggleMap = body('  private toggleMap(tab?: MapTab): void {');
  ok(/this\.map\.show\(tab\);/.test(toggleMap), 'and toggleMap opens the map on the tab it is handed');
  const showOnMap = body('  private showWaypointOnMap(id: string): void {');
  ok(/if \(w\.f === 'raw'\) this\.map\.showAt\(w\.p\[0\], w\.p\[1\]\);\s*else this\.map\.show\('here'\);/.test(showOnMap), '"Show on map" goes to the Here tab, at the point on a planet');
  ok(!/draggable\([^)]*'waypoints'\)/.test(main) && !/draggable\([^)]*'group'\)/.test(main), 'neither is a window of its own any more');
  // Being tabs, neither is a panel of its own: the map holds the mouse and stops play under both.
  const anyPanel = body('  private anyPanelOpen(): boolean {');
  ok(anyPanel.includes('this.journalUi.open') && !/waypointsUi|groupUi/.test(anyPanel), 'neither list is in anyPanelOpen');
  const close = body('  private closePanels(): void {');
  ok(close.includes('this.journalUi.hide()') && !/waypointsUi\.hide|groupUi\.hide/.test(close), 'nor does closePanels hide either: they go with the map');
  // A panel opened over the map takes the map down with it, on whichever tab it shows, or its own key
  // again would take the pointer with the map still on the screen.
  for (const head of ['  private toggleInventory(tab?: InventoryTab): void {', "  private toggleSpawner(tab?: 'garage' | 'npcs'): void {", '  private toggleJournal(', '  private toggleShipMenu(): void {']) {
    ok(/this\.closePanels\(\);\s*(?:\/\/[^\n]*\n\s*)*this\.map\.hide\(\);/.test(body(head)), `${head.trim().replace(/^private /, '').replace(/\(.*/, '')} shuts the map with the other panels`);
  }
}

console.log(`\n${checks} checks passed`);
