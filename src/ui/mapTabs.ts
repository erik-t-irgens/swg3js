// The map window's four tabs, and the rules about them that need no page: which tab a key of its own does
// what to, which tab the window opens on when it is opened plainly, and how the last one is remembered.
// Here and Galaxy are pictures drawn on the window's one WebGL canvas; Waypoints and Group are lists, pages
// of the window's own that never touch that canvas (`isListTab`). Group is offered only while a server
// holds a group for this browser, and a window asked to show it otherwise shows Here.
//
// Pure, so the node tests run the rules `MapUi` and the game's keys run.

/** The window's tabs, in the order they stand in its header. */
export type MapTab = 'here' | 'galaxy' | 'waypoints' | 'group';

export const MAP_TABS: readonly MapTab[] = ['here', 'galaxy', 'waypoints', 'group'];

/** Whether something read from storage, the console or a click is one of the tabs. */
export function isMapTab(v: unknown): v is MapTab {
  return typeof v === 'string' && (MAP_TABS as readonly string[]).includes(v);
}

/** A list tab is a page of the window's own: no picture, no frame loop, and the shared canvas left where it is. */
export function isListTab(tab: MapTab): boolean {
  return tab === 'waypoints' || tab === 'group';
}

/** The tab that is shown when `want` is asked for: Group with no group to show is Here. */
export function tabShown(want: MapTab, groupOn: boolean): MapTab {
  return want === 'group' && !groupOn ? 'here' : want;
}

/**
 * What a tab's own key does (Y, the full stop): opens the window on that tab when it is shut, switches to
 * it when the window is open on another, and shuts the window when it is already showing it -- whether or
 * not the tab is still on offer, so a Group tab left showing when the group ended is shut by its own key
 * like any other. A tab that is not on offer (Group with no group held) otherwise makes its key do nothing
 * at all, as the group panel's own key always did with no server.
 */
export function tabKey(open: boolean, showing: MapTab, want: MapTab, offered: boolean): 'open' | 'switch' | 'close' | 'none' {
  if (open && showing === want) return 'close';
  if (!offered) return 'none';
  return open ? 'switch' : 'open';
}

/** The map as a tab's key sees it: whether it is open, the tab it is on, and a way to change tabs. */
export interface TabbedMap {
  readonly open: boolean;
  readonly tabNow: MapTab;
  showTab(tab: MapTab): void;
}

/**
 * A tab's own key pressed, carried out on the map by `tabKey`'s rule: `shut` shuts the window (and gives
 * the game its mouse back), a switch is the map's own `showTab`, and `openOn` opens the shut window on the
 * tab, which is the caller's to refuse (out of the world, travelling). The answer is what was asked for.
 * The game's keys and the node test run this one function, so the test drives what Y and the full stop do.
 */
export function pressTabKey(map: TabbedMap, tab: MapTab, offered: boolean, shut: () => void, openOn: (tab: MapTab) => void): 'open' | 'switch' | 'close' | 'none' {
  const what = tabKey(map.open, map.tabNow, tab, offered);
  if (what === 'close') shut();
  else if (what === 'switch') map.showTab(tab);
  else if (what === 'open') openOn(tab);
  return what;
}

/** Where the last tab used is kept, so M opens the window where it was left after a reload too. */
export const MAP_TAB_KEY = 'swg3js.mapTab';

/** The page's storage, or null where it cannot be had: asking for it can throw in a locked-down page. */
function storage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The tab last used, or null for none kept, a value that is not a tab, or storage that cannot be read. */
export function recallTab(): MapTab | null {
  try {
    const v = storage()?.getItem(MAP_TAB_KEY);
    return isMapTab(v) ? v : null;
  } catch {
    return null;
  }
}

/** Keep the tab last used. Storage that cannot be written costs the memory across a reload and nothing else. */
export function rememberTab(tab: MapTab): void {
  try {
    storage()?.setItem(MAP_TAB_KEY, tab);
  } catch {
    // No storage: the tab is remembered for this session only.
  }
}
