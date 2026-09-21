// The trade window: what you are putting in, what they are, and one button that says you are happy.
//
// Everything on it is ours. The pictures are the ones the converter baked for the backpack, shown as
// `<img>` (no GL, so opening this never compiles a shader), the names are the game's own names for
// the items, and every colour is one of the eighteen in `src/core/palette.ts`, read through
// `var(--name)` with the palette's own value behind it rather than a colour typed in by hand.
//
// It keeps the display's habits: a pool of cells made once, a cell written only when what it shows
// has changed, a count of every write for `__debug.trade()`, and no work at all while there is no
// trade. Nothing here runs in a frame -- a trade is a handful of events and a countdown stepped four
// times a second.
//
// And it decides nothing. The window is drawn from what the server said (src/net/trade.ts holds it),
// a click asks for something, and not one item moves in the backpack until the server's own list
// comes down. The two sides of a trade are therefore always looking at the same thing: whatever the
// server last told them both.

import { COL, PALETTE_FALLBACK } from '../core/palette.ts';
import { GROUP_RANGE, pickLookedAt, type LookCandidate, type PointOut } from '../net/groups.ts';
import { TRADE_TUNE, type Trade, type TradeAsk, type TradeItem, type TradeWindow } from '../net/trade.ts';

/**
 * What this panel invents, live through `__debug.trade({ ui: { ... } })`. The distance a trade
 * reaches is not here: it is the game's own, in `GROUP_RANGE.trade`.
 */
export const TRADE_UI_TUNE = {
  /**
   * Invented: the key that brings the window back after Escape has put it aside. It is a raw code,
   * not one of the game's bindings, and it does nothing at all unless a trade is standing -- so the
   * key keeps whatever else it does in the game every other moment of play.
   */
  panelKey: 'KeyT',
  /** Invented: how many of the backpack's items the window shows at once; the find field is the rest. */
  packCells: 60,
  /**
   * Invented: cells in each of the two offer panes. It is the server's own cap on one side of a
   * trade (`item.offer`, 40), so whatever the server says is in a pane can be shown whole however
   * `TRADE_TUNE.offerMax` is set. The pools are made when the panel is built, so setting this from
   * the console reaches the next page rather than this one.
   */
  offerCells: 40,
  /** Invented: times a second the countdown and the panel's rows are stepped. Nothing here is per frame. */
  hz: 4,
};

/** Every panel built and not disposed, so a number set from the console reaches it. */
const LIVE: Set<TradeUi> = new Set();

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneTradeUi(o: Partial<typeof TRADE_UI_TUNE>): typeof TRADE_UI_TUNE {
  if (typeof o.panelKey === 'string' && /^[A-Za-z0-9]+$/.test(o.panelKey)) TRADE_UI_TUNE.panelKey = o.panelKey;
  if (typeof o.packCells === 'number') TRADE_UI_TUNE.packCells = Math.max(1, Math.min(400, Math.round(o.packCells)));
  if (typeof o.offerCells === 'number') TRADE_UI_TUNE.offerCells = Math.max(1, Math.min(400, Math.round(o.offerCells)));
  if (typeof o.hz === 'number') {
    TRADE_UI_TUNE.hz = Math.max(0.5, Math.min(30, o.hz));
    for (const panel of LIVE) panel.rearm();
  }
  return TRADE_UI_TUNE;
}

/** What the panel is doing, filled in place for the console: never a new object. */
export interface TradeUiStats {
  open: boolean;
  /** Cells showing in each of the three panes. */
  pack: number;
  mine: number;
  theirs: number;
  /** Every write this file has made to the page since it was built. */
  writes: number;
  ticks: number;
}

/** What the panel needs of the game. Everything is a function, so nothing here holds a stale copy. */
export interface TradeUiDeps {
  trade: Trade;
  /** Something for the player to read that is not on the window itself. */
  note: (text: string) => void;
  /** An item's name and the picture the converter baked for it, as the backpack shows them. */
  look: (kind: 'wear' | 'weapon', id: string) => { name: string; icon: string | null };
  /** What this character owns now, and what each one is doing (worn, or in a hand). */
  owned: () => readonly { item: TradeItem; use: 'worn' | 'right' | 'left' | null }[];
  /** Where the eye is and which way it looks, for "the player you are looking at". Filled in place. */
  view: (eye: PointOut, dir: PointOut) => boolean;
  /** The players on this world, filled into the list; the answer is how many were filled. */
  peersHere: (out: LookCandidate[]) => number;
  /** Whether a window may take the screen here: in the world, not travelling, no menu up. */
  canOpen: () => boolean;
  /** The panel wants the mouse (and gives it back): the game's own free-the-mouse. */
  freeMouse: (free: boolean) => void;
  /**
   * Whether something else on the page is holding the mouse now (the backpack, the map, the menu).
   * It is what tells "another panel took the screen, and it will give the mouse back itself" from
   * "the game took the screen away" -- a travel, a jump, a death, going to space -- where nobody
   * will, and this panel handing it back is the only thing between the player and a game with every
   * key dead. It is also what keeps the trade ending from taking the cursor off the backpack the
   * Trade button was pressed on. With none handed in, the mouse is always handed back.
   */
  elseHasMouse?: () => boolean;
}

/** One cell in one of the three panes. */
interface Cell {
  readonly el: HTMLButtonElement;
  readonly pic: HTMLElement;
  readonly name: HTMLElement;
  /** `kind:id`, which is what a click hands back. */
  key: string;
  kind: 'wear' | 'weapon';
  id: string;
  nameText: string;
  icon: string;
  use: string;
  shown: boolean;
}

/** A pane's own state, so a redraw writes only what moved. */
type Pane = 'pack' | 'mine' | 'theirs';

/**
 * The stylesheet. Every colour is one of the palette's names, with the palette's own value behind it
 * as the fallback rather than a literal chosen here, so this file cannot drift from `src/style.css`
 * even where a stylesheet is half loaded.
 */
const col = (i: number, name: string) => `var(--${name}, ${PALETTE_FALLBACK[i]})`;
const INK = col(COL.ink, 'ink');
const MUTED = col(COL.muted, 'muted');
const ACCENT = col(COL.accent, 'accent');
const PANEL = col(COL.panel, 'panel');
const PLATE = col(COL.plate, 'plate');
const RULE = col(COL.rule, 'rule');
const EDGE = col(COL.edge, 'edge');
const GOOD = col(COL.good, 'good');
const WARN = col(COL.warn, 'warn');

const CSS = `
.trade-panel {
  position: absolute;
  left: 50%;
  top: calc(90px * var(--hud-scale, 1));
  transform: translateX(-50%);
  width: min(calc(760px * var(--hud-scale, 1)), 94vw);
  padding: calc(10px * var(--hud-scale, 1));
  border-radius: 6px;
  background: ${PANEL};
  border: 1px solid ${EDGE};
  font: 500 calc(12px * var(--hud-scale, 1))/1.4 system-ui, sans-serif;
  color: ${INK};
  pointer-events: auto;
  z-index: 7;
}
.trade-panel.hidden { display: none; }
.trade-panel h3 { margin: 0 0 6px; font-size: calc(13px * var(--hud-scale, 1)); color: ${ACCENT}; }
.trade-head { display: flex; align-items: baseline; gap: 8px; }
.trade-head .find { flex: 1 1 auto; min-width: 60px; background: ${PLATE}; color: inherit; border: 1px solid ${RULE}; border-radius: 3px; padding: 2px 6px; font: inherit; }
.trade-panes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: calc(8px * var(--hud-scale, 1)); margin-top: 6px; }
.trade-pane { border: 1px solid ${RULE}; border-radius: 4px; padding: 4px; min-height: calc(120px * var(--hud-scale, 1)); }
.trade-pane > h4 { margin: 0 0 4px; font: 600 calc(11px * var(--hud-scale, 1))/1.3 system-ui, sans-serif; color: ${MUTED}; }
.trade-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(64px * var(--hud-scale, 1)), 1fr)); gap: 4px; max-height: calc(220px * var(--hud-scale, 1)); overflow-y: auto; }
.trade-cell {
  display: block;
  background: ${PLATE};
  border: 1px solid ${RULE};
  border-radius: 3px;
  padding: 3px;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: pointer;
}
.trade-cell.hidden { display: none; }
.trade-cell:hover { border-color: ${ACCENT}; }
.trade-cell.used { opacity: 0.55; border-style: dashed; }
.trade-cell .pic { display: block; height: calc(40px * var(--hud-scale, 1)); line-height: calc(40px * var(--hud-scale, 1)); }
.trade-cell .pic img { max-width: 100%; max-height: 100%; vertical-align: middle; }
.trade-cell .initials { color: ${MUTED}; font-weight: 600; }
.trade-cell .name { display: block; font-size: calc(10px * var(--hud-scale, 1)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trade-empty { color: ${MUTED}; font-size: calc(11px * var(--hud-scale, 1)); padding: 6px 2px; }
.trade-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.trade-state { color: ${MUTED}; }
.trade-state.ready { color: ${GOOD}; }
.trade-state.waiting { color: ${WARN}; }
.trade-panel .hint { color: ${MUTED}; font-size: calc(11px * var(--hud-scale, 1)); margin: 6px 0 0; }
.trade-panel button, .trade-ask button {
  background: ${PLATE};
  color: inherit;
  border: 1px solid ${EDGE};
  border-radius: 3px;
  padding: 3px 10px;
  font: inherit;
  cursor: pointer;
}
.trade-panel button:hover, .trade-ask button:hover { border-color: ${ACCENT}; }
.trade-panel button.on { border-color: ${GOOD}; color: ${GOOD}; }
.trade-ask {
  position: absolute;
  left: 50%;
  top: calc(180px * var(--hud-scale, 1));
  transform: translateX(-50%);
  padding: calc(8px * var(--hud-scale, 1)) calc(12px * var(--hud-scale, 1));
  border-radius: 6px;
  background: ${PANEL};
  border: 1px solid ${ACCENT};
  font: 500 calc(13px * var(--hud-scale, 1))/1.4 system-ui, sans-serif;
  color: ${INK};
  text-align: center;
  pointer-events: auto;
  z-index: 8;
}
.trade-ask.hidden { display: none; }
.trade-ask .acts { display: flex; gap: 6px; justify-content: center; margin-top: 6px; }
`;

export class TradeUi {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly grids: Record<Pane, HTMLElement>;
  private readonly empties: Record<Pane, HTMLElement>;
  private readonly cells: Record<Pane, Cell[]>;
  private readonly heads: Record<Pane, HTMLElement>;
  private readonly readyBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly state: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly ask: HTMLElement;
  private readonly askText: HTMLElement;
  private readonly askYes: HTMLButtonElement;
  private readonly askNo: HTMLButtonElement;
  private readonly eye: PointOut = { x: 0, y: 0, z: 0 };
  private readonly dir: PointOut = { x: 0, y: 0, z: 0 };
  private readonly candidates: LookCandidate[] = [];
  private timer = 0;
  private lastTick = 0;
  private titleText = '';
  private stateText = '';
  private stateClass = '';
  private readyText = '';
  private readyOn = false;
  private hintText = '';
  private askText0 = '';
  /** Put aside with Escape while the trade is still standing, so a redraw does not bring it back. */
  private setAside = false;
  /** Whether this panel is what took the mouse, so it is never handed back twice or by mistake. */
  private heldMouse = false;
  private readonly stat: TradeUiStats = { open: false, pack: 0, mine: 0, theirs: 0, writes: 0, ticks: 0 };
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onLock: () => void;
  /** The trade module's handlers as they were before this panel chained onto them, and this panel's own. */
  private hadWindow: (w: TradeWindow | null) => void = () => {};
  private hadAsk: (a: TradeAsk | null) => void = () => {};
  private hadWant: () => void = () => {};
  private mineWindow: (w: TradeWindow | null) => void = () => {};
  private mineAsk: (a: TradeAsk | null) => void = () => {};
  private mineWant: () => void = () => {};
  /**
   * What this panel needs of the game. It is assigned in the body rather than written as a parameter
   * property, because a node test runs this file as it is -- node strips the types and nothing else.
   */
  private readonly deps: TradeUiDeps;

  constructor(parent: HTMLElement, deps: TradeUiDeps) {
    this.deps = deps;
    if (!document.getElementById('trade-style')) {
      const style = document.createElement('style');
      style.id = 'trade-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'trade-root';
    parent.appendChild(this.root);

    this.panel = document.createElement('div');
    this.panel.className = 'trade-panel hidden';
    this.panel.innerHTML = `
      <div class="trade-head"><h3></h3><input class="find" placeholder="find" /></div>
      <div class="trade-panes">
        <section class="trade-pane" data-pane="pack"><h4>Your backpack</h4><div class="trade-grid"></div><div class="trade-empty hidden"></div></section>
        <section class="trade-pane" data-pane="mine"><h4>You offer</h4><div class="trade-grid"></div><div class="trade-empty hidden"></div></section>
        <section class="trade-pane" data-pane="theirs"><h4>They offer</h4><div class="trade-grid"></div><div class="trade-empty hidden"></div></section>
      </div>
      <div class="trade-foot">
        <button type="button" class="ready">I am happy with this</button>
        <button type="button" class="cancel">Break it off</button>
        <span class="trade-state"></span>
      </div>
      <p class="hint"></p>`;
    this.root.appendChild(this.panel);
    this.title = this.panel.querySelector<HTMLElement>('h3')!;
    this.find = this.panel.querySelector<HTMLInputElement>('.find')!;
    this.readyBtn = this.panel.querySelector<HTMLButtonElement>('.ready')!;
    this.cancelBtn = this.panel.querySelector<HTMLButtonElement>('.cancel')!;
    this.state = this.panel.querySelector<HTMLElement>('.trade-state')!;
    this.hint = this.panel.querySelector<HTMLElement>('.hint')!;
    const grid = (pane: Pane) => this.panel.querySelector<HTMLElement>(`[data-pane="${pane}"] .trade-grid`)!;
    const empty = (pane: Pane) => this.panel.querySelector<HTMLElement>(`[data-pane="${pane}"] .trade-empty`)!;
    const head = (pane: Pane) => this.panel.querySelector<HTMLElement>(`[data-pane="${pane}"] h4`)!;
    this.grids = { pack: grid('pack'), mine: grid('mine'), theirs: grid('theirs') };
    this.empties = { pack: empty('pack'), mine: empty('mine'), theirs: empty('theirs') };
    this.heads = { pack: head('pack'), mine: head('mine'), theirs: head('theirs') };
    // The pools, made once: the two offer panes hold what a trade holds, and the backpack pane holds
    // as much of the backpack as the window shows, which the find field walks through. Nothing here
    // ever makes a cell in a tick.
    // The offer panes hold what the *server* lets one side put up, not what this browser lets the
    // player add: `TRADE_TUNE.offerMax` is live from the console and the panes are the server's own
    // state, so a pane sized by it would hide rows the trade really holds.
    const offerCells = Math.max(TRADE_UI_TUNE.offerCells, TRADE_TUNE.offerMax);
    this.cells = {
      pack: this.pool('pack', TRADE_UI_TUNE.packCells),
      mine: this.pool('mine', offerCells),
      theirs: this.pool('theirs', offerCells),
    };
    this.readyBtn.addEventListener('click', () => this.press());
    this.cancelBtn.addEventListener('click', () => this.deps.trade.cancel());
    this.find.addEventListener('input', () => this.draw());
    // A picture that will not load shows the name's initials instead (error events do not bubble).
    this.root.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLElement;
        if (img.tagName !== 'IMG' || !img.parentElement) return;
        const cell = img.closest<HTMLElement>('.trade-cell');
        img.replaceWith(initials(cell?.dataset.name ?? ''));
      },
      true,
    );

    this.ask = document.createElement('div');
    this.ask.className = 'trade-ask hidden';
    this.ask.innerHTML = '<div class="what"></div><div class="acts"><button type="button" class="yes">Trade</button><button type="button" class="no">No thanks</button></div>';
    this.root.appendChild(this.ask);
    this.askText = this.ask.querySelector<HTMLElement>('.what')!;
    this.askYes = this.ask.querySelector<HTMLButtonElement>('.yes')!;
    this.askNo = this.ask.querySelector<HTMLButtonElement>('.no')!;
    this.askYes.addEventListener('click', () => this.deps.trade.accept());
    this.askNo.addEventListener('click', () => this.deps.trade.decline());

    // The window moved, or somebody asked: each writes to the page once. Whatever was listening
    // before still is, so a display that grows a trade line of its own is not silently unplugged.
    this.hadWindow = deps.trade.onWindow;
    this.hadAsk = deps.trade.onAsk;
    this.hadWant = deps.trade.onWant;
    this.mineWindow = (w) => {
      this.hadWindow(w);
      this.windowed(w);
    };
    this.mineAsk = (a) => {
      this.hadAsk(a);
      this.asked(a);
    };
    // A list waited on is the one thing that moves the backpack, and this panel's slow step is what
    // asks for it again when it never comes. The first wait of a session is the claim being
    // answered -- no window, no question, nothing else here to wake the step -- so the ledger says
    // it is waiting and the step starts from that.
    this.mineWant = () => {
      this.hadWant();
      this.wake();
    };
    deps.trade.onWindow = this.mineWindow;
    deps.trade.onAsk = this.mineAsk;
    deps.trade.onWant = this.mineWant;

    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    // Clicking the world asks for the pointer back, and this panel holds the mouse while it is up.
    this.onLock = () => this.lockTaken();
    document.addEventListener?.('pointerlockchange', this.onLock);
    LIVE.add(this);
  }

  /** A pane's cells, made once and reused for the life of the page. */
  private pool(pane: Pane, n: number): Cell[] {
    const out: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'trade-cell hidden';
      el.innerHTML = '<span class="pic"></span><span class="name"></span>';
      this.grids[pane].appendChild(el);
      const cell: Cell = {
        el,
        pic: el.querySelector<HTMLElement>('.pic')!,
        name: el.querySelector<HTMLElement>('.name')!,
        key: '',
        kind: 'wear',
        id: '',
        nameText: '',
        icon: '',
        use: '',
        shown: true,
      };
      el.addEventListener('click', () => this.clicked(pane, cell));
      out.push(cell);
    }
    return out;
  }

  // ---- what the player presses ---------------------------------------------------------------------

  private clicked(pane: Pane, cell: Cell): void {
    if (!cell.id) return;
    const t = this.deps.trade;
    if (pane === 'pack') {
      const why = t.putIn(cell.kind, cell.id);
      if (why) this.deps.note(why);
      return;
    }
    if (pane === 'mine') {
      const why = t.takeOut(cell.kind, cell.id);
      if (why) this.deps.note(why);
      return;
    }
    // Their side is theirs: a click on it says so rather than doing nothing at all.
    this.deps.note('that is theirs to put in and take out');
  }

  private press(): void {
    const w = this.deps.trade.window;
    if (!w) return;
    const why = this.deps.trade.setReady(!w.youReady);
    if (why) this.deps.note(why);
  }

  /**
   * Ask whoever is in the middle of the view to trade, within the game's own 8 m. It is what the
   * backpack's own button, the group roster's and `/trade` all come to, so there is one rule about
   * who is being asked and one place that says why nothing happened.
   */
  askLookedAt(): string {
    if (!this.deps.view(this.eye, this.dir)) return 'nothing to look along yet';
    const n = this.deps.peersHere(this.candidates);
    // Whoever is being looked at, at the distance the same rule already uses for an invitation; how
    // far a trade may reach is not decided here at all. `askTrade` measures the game's own 8 m and
    // says how far off they are when it refuses, which is a better answer to "why not?" than a
    // button that finds nobody because the player is a metre too far away.
    const id = pickLookedAt(this.candidates, n, this.eye.x, this.eye.y, this.eye.z, this.dir.x, this.dir.y, this.dir.z);
    if (!id) return `stand by the player you want to trade with, within ${GROUP_RANGE.trade} m, and look at them`;
    let name = '';
    for (let i = 0; i < n; i++) if (this.candidates[i].id === id) name = this.candidates[i].name;
    const why = this.deps.trade.askTrade(id, name);
    return why || `asked ${name || 'them'} to trade`;
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // Escape puts the window aside without breaking the trade off: the items are the server's and
    // nothing has moved, so there is nothing to undo, and the key that brings it back says so.
    if (e.code === 'Escape') {
      if (!this.open) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.setAside = true;
      this.shut();
      if (this.deps.trade.window) this.deps.note(`the trade is still open: press ${plainKey(TRADE_UI_TUNE.panelKey)} to bring it back, or break it off there`);
      return;
    }
    if (e.code !== TRADE_UI_TUNE.panelKey) return;
    // With no trade standing the key is not this panel's at all, so whatever else the game does with
    // it goes on happening every other moment of play.
    if (!this.deps.trade.window) return;
    e.preventDefault();
    if (this.open) {
      this.setAside = true;
      this.shut();
      return;
    }
    this.setAside = false;
    if (!this.show()) this.deps.note('not while this is on the screen: the trade is still standing');
  }

  private lockTaken(): void {
    if (this.open && typeof document !== 'undefined' && document.pointerLockElement) this.shut();
  }

  /** Arm the slow step again at whatever `TRADE_UI_TUNE.hz` now says, if it is running. */
  rearm(): void {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.wake();
  }

  // ---- the window -----------------------------------------------------------------------------------

  get open(): boolean {
    return !this.panel.classList.contains('hidden');
  }

  /**
   * Put it up. It is refused where the game says no window may take the screen -- travelling, dead,
   * in the menu or the map, not in the world at all -- because taking the mouse there is taking it
   * with nobody to give it back to. The answer is whether it went up, so a key press can say why.
   */
  show(): boolean {
    if (this.open) return true;
    if (!this.deps.canOpen()) return false;
    this.panel.classList.remove('hidden');
    this.stat.open = true;
    this.stat.writes++;
    this.heldMouse = true;
    this.deps.freeMouse(true);
    this.draw();
    this.wake();
    return true;
  }

  /** Shut it, and give the mouse back. */
  private shut(): void {
    if (!this.open) return;
    this.panel.classList.add('hidden');
    this.stat.open = false;
    this.stat.writes++;
    this.handBack();
  }

  /**
   * Give the mouse back, where this panel is what took it and nothing else is holding it now.
   *
   * Both halves matter. Not handing it back is how the game is left with every key and the wheel
   * dead: `freeMouse(true)` sets the input's `captured`, and nothing else clears it -- so a window
   * shut because the game took the screen (a travel, a jump, a death, going up to space) would
   * leave the player unable to walk, look or press anything, with nothing on the screen to say why.
   * Handing it back over another panel's head is the other side of the same coin: the Trade button
   * is on the backpack, so a trade that ends while the backpack is still up must leave the cursor
   * where it is rather than locking the pointer back to the game under an open panel.
   */
  private handBack(): void {
    if (!this.heldMouse) return;
    this.heldMouse = false;
    if (this.deps.elseHasMouse?.()) return;
    this.deps.freeMouse(false);
  }

  private windowed(w: TradeWindow | null): void {
    if (!w) {
      this.setAside = false;
      this.shut();
      this.wake();
      return;
    }
    // `show` refuses where no window may take the screen; the slow step puts it up as soon as one
    // may, so a trade opened as the player walked into a lift or a loading screen is not lost.
    if (!this.open && !this.setAside) this.show();
    else if (this.open) this.draw();
    this.wake();
  }

  private asked(a: TradeAsk | null): void {
    if (!a) {
      this.showAsk('');
      return;
    }
    this.showAsk(`${a.name} would like to trade`);
    this.wake();
  }

  private showAsk(text: string): void {
    if (!text) {
      if (!this.ask.classList.contains('hidden')) {
        this.ask.classList.add('hidden');
        this.stat.writes++;
      }
      this.askText0 = '';
      return;
    }
    if (text !== this.askText0) {
      this.askText0 = text;
      this.askText.textContent = text;
      this.stat.writes++;
    }
    if (this.ask.classList.contains('hidden')) {
      this.ask.classList.remove('hidden');
      this.stat.writes++;
    }
  }

  /** The three panes and the foot, written only where what they show has changed. */
  private draw(): void {
    const w = this.deps.trade.window;
    if (!w) return;
    const title = `Trade with ${w.name}`;
    if (title !== this.titleText) {
      this.titleText = title;
      this.title.textContent = title;
      this.stat.writes++;
    }
    const offered = new Set(w.mine.map((o) => `${o.kind}:${o.id}`));
    const find = this.find.value.trim().toLowerCase();
    // The backpack pane: what is owned, less what is already in the trade. What is being worn or
    // held stays on it, dimmed, because a player looking for a shirt they are wearing must be told
    // why it will not go in rather than left hunting for a cell that is not there.
    const pack: { item: TradeItem; use: string }[] = [];
    for (const row of this.deps.owned()) {
      const key = `${row.item.kind}:${row.item.id}`;
      if (offered.has(key)) continue;
      if (find) {
        const name = this.deps.look(row.item.kind, row.item.id).name.toLowerCase();
        if (!name.includes(find) && !row.item.id.toLowerCase().includes(find)) continue;
      }
      pack.push({ item: row.item, use: row.use ?? '' });
      if (pack.length >= this.cells.pack.length) break;
    }
    this.fill('pack', pack, 'nothing in the backpack to trade');
    this.fill('mine', w.mine.map((item) => ({ item, use: '' })), 'nothing in yet');
    this.fill('theirs', w.theirs.map((item) => ({ item, use: '' })), 'nothing in yet');
    this.head('mine', `You offer (${w.mine.length})`);
    this.head('theirs', `They offer (${w.theirs.length})`);
    this.head('pack', 'Your backpack');
    // The foot: the one button, and a line saying what the other side has done.
    const ready = w.youReady ? 'Take that back' : 'I am happy with this';
    if (ready !== this.readyText) {
      this.readyText = ready;
      this.readyBtn.textContent = ready;
      this.stat.writes++;
    }
    if (w.youReady !== this.readyOn) {
      this.readyOn = w.youReady;
      this.readyBtn.classList.toggle('on', w.youReady);
      this.stat.writes++;
    }
    const said = w.youReady && w.themReady ? 'you are both happy: the swap is going through' : w.themReady ? `${w.name} is happy with this` : w.youReady ? `waiting for ${w.name}` : 'neither of you has said yes yet';
    const cls = w.youReady && w.themReady ? 'ready' : w.themReady || w.youReady ? 'waiting' : '';
    if (said !== this.stateText) {
      this.stateText = said;
      this.state.textContent = said;
      this.stat.writes++;
    }
    if (cls !== this.stateClass) {
      this.stateClass = cls;
      this.state.className = `trade-state${cls ? ` ${cls}` : ''}`;
      this.stat.writes++;
    }
    const hint = `Click something of yours to put it in, and click it again on your side to take it out. A trade reaches ${GROUP_RANGE.trade} m, which is the game's own. Nothing changes hands until you have both said yes, and then it all changes hands at once.`;
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hint.textContent = hint;
      this.stat.writes++;
    }
  }

  private head(pane: Pane, text: string): void {
    const el = this.heads[pane];
    if (el.textContent === text) return;
    el.textContent = text;
    this.stat.writes++;
  }

  /** One pane's cells against what it should be showing; a cell is written only where it differs. */
  private fill(pane: Pane, rows: readonly { item: TradeItem; use: string }[], emptyWords: string): void {
    const cells = this.cells[pane];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const row = i < rows.length ? rows[i] : null;
      if (!row) {
        if (cell.shown) {
          cell.el.classList.add('hidden');
          cell.shown = false;
          cell.key = '';
          cell.id = '';
          this.stat.writes++;
        }
        continue;
      }
      if (!cell.shown) {
        cell.el.classList.remove('hidden');
        cell.shown = true;
        this.stat.writes++;
      }
      const key = `${row.item.kind}:${row.item.id}`;
      if (key !== cell.key) {
        cell.key = key;
        cell.kind = row.item.kind;
        cell.id = row.item.id;
        const look = this.deps.look(row.item.kind, row.item.id);
        if (look.name !== cell.nameText) {
          cell.nameText = look.name;
          cell.name.textContent = look.name;
          cell.el.dataset.name = look.name;
          this.stat.writes++;
        }
        const icon = look.icon ?? '';
        if (icon !== cell.icon) {
          cell.icon = icon;
          cell.pic.textContent = '';
          if (icon) {
            const img = document.createElement('img');
            img.src = icon;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            cell.pic.appendChild(img);
          } else cell.pic.appendChild(initials(look.name));
          this.stat.writes++;
        }
      }
      if (row.use !== cell.use) {
        cell.use = row.use;
        cell.el.classList.toggle('used', !!row.use);
        cell.el.title = row.use === 'worn' ? 'worn: take it off to trade it' : row.use ? `in your ${row.use} hand: put it away to trade it` : cell.nameText;
        this.stat.writes++;
      }
    }
    const none = rows.length === 0;
    const empty = this.empties[pane];
    if (none && empty.classList.contains('hidden')) {
      empty.textContent = emptyWords;
      empty.classList.remove('hidden');
      this.stat.writes++;
    } else if (!none && !empty.classList.contains('hidden')) {
      empty.classList.add('hidden');
      this.stat.writes++;
    }
    this.stat[pane] = rows.length;
  }

  // ---- the slow step ---------------------------------------------------------------------------------

  /** Start the slow step when there is something to keep up with, and stop it when there is not. */
  private wake(): void {
    const t = this.deps.trade;
    // A list asked for and not yet arrived counts: it is the only thing that moves the backpack, so
    // the step that asks for it again has to go on running after the window has closed.
    const wanted = !!t.window || !!t.asked || t.wantsList || this.open;
    if (!wanted) {
      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = 0;
      }
      return;
    }
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), Math.round(1000 / Math.max(0.5, TRADE_UI_TUNE.hz)));
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(2, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    this.stat.ticks++;
    // The menu, the map or another panel has taken the screen, or the game has taken it away
    // (travelling, dead, up to space): stand aside. `shut` hands the mouse back unless something
    // else is holding it, which is what keeps the keyboard alive when it was the game rather than a
    // panel that said no -- there is nobody else to give it back in that case. The trade itself is
    // untouched: it is the server's, not the panel's.
    if (this.open && !this.deps.canOpen()) this.shut();
    // And back up again the moment a window may take the screen once more, unless the player put it
    // aside themselves. A trade that opened during a travel is not lost with the loading screen.
    else if (!this.open && !this.setAside && this.deps.trade.window) this.show();
    this.lockTaken();
    const moved = this.deps.trade.step(dt);
    const ask = this.deps.trade.asked;
    if (ask) this.showAsk(`${ask.name} would like to trade (${Math.ceil(ask.left)} s)`);
    if (moved && this.open) this.draw();
    this.wake();
  }

  /**
   * Draw it again where it is up: what the pictures and the names are read from (the backpack's own
   * catalogues) is fetched when a window opens, and the panel is drawn before it arrives, so
   * whoever fetches it says so when it lands rather than leaving raw ids on the screen until the
   * other side happens to move something.
   */
  refresh(): void {
    if (this.open) this.draw();
  }

  /** Everything down: the window shut, the question gone. The trade itself is the server's. */
  clearAll(): void {
    this.setAside = false;
    this.shut();
    this.showAsk('');
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  debug(): TradeUiStats {
    this.stat.open = this.open;
    return this.stat;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener?.('pointerlockchange', this.onLock);
    const t = this.deps.trade;
    // Only where this panel's wrapper is still the one hanging there: somebody who chained onto ours
    // after we were built owns the hook now, and putting ours back would unplug them.
    if (t.onWindow === this.mineWindow) t.onWindow = this.hadWindow;
    if (t.onAsk === this.mineAsk) t.onAsk = this.hadAsk;
    if (t.onWant === this.mineWant) t.onWant = this.hadWant;
    this.clearAll();
    this.root.remove();
    LIVE.delete(this);
  }
}

/** A name's initials, where there is no picture (the backpack's own stand-in). */
function initials(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'initials';
  const words = name.split(/[\s_-]+/).filter((w) => /[A-Za-z0-9]/.test(w));
  el.textContent = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  return el;
}

/** `KeyT` as the player reads it on their own keyboard. */
function plainKey(code: string): string {
  return code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code;
}
