// The group's panel: who is with you, how far off and how they are doing, and the asking -- invite the
// player you are looking at, take someone in or turn them down, hand the lead over, put someone out,
// leave. The wording and the distances are the game's own radial menu (an invitation reaches 90 m);
// the panel and everything about how it looks are ours.
//
// It is DOM, and it keeps the display's habits: a fixed pool of rows made once, a row written only
// when what it shows has changed, and no work at all while there is no group and nobody asking. The
// chevrons over distant members follow the camera, so they run on a loop of their own that starts when
// the first one is needed and stops when the last one goes.
//
// Nothing here decides anything: the server holds the group and this panel shows what it was handed
// and asks for what the player pressed. With no server it never opens and its key does nothing.

import { GROUP_RANGE, GROUP_TUNE, Groups, type GroupInvite, type GroupMember, type GroupRoster, type GroupTrip, type LookCandidate, type PointOut, pickLookedAt } from '../net/groups.ts';

/** Where a world point landed on the screen, in pixels from the top left. Filled in place. */
export interface GroupScreenPoint {
  x: number;
  y: number;
}

/**
 * What this panel invents, live through `__debug.group({ ui: { ... } })`. The distances it shows are
 * not here: they are the game's, in `GROUP_RANGE`.
 */
export const GROUP_UI_TUNE = {
  /** Invented: the key that opens the panel. It is a raw code, not one of the game's bindings. */
  panelKey: 'KeyY',
  /** Invented: whether a chevron is drawn over a member who is far off. */
  chevrons: true,
  /** Invented: how high over a member's feet their chevron hangs, in metres. */
  chevronLift: 2.6,
  /** Invented: times a second the panel's rows and the countdowns are stepped. Nothing here is per frame. */
  hz: 4,
};

/** Every panel that has been built and not disposed, so that a number set from the console reaches it. */
const LIVE: Set<GroupUi> = new Set();

/**
 * Set any of those, clamped to what makes sense; the answer is the table as it now stands. `hz` is
 * read when the slow step is armed, so a panel already running is armed again at the new rate rather
 * than waiting for the group to end and start.
 *
 * Two of the numbers this file and the group module share are read once, when the panel is built, and
 * cannot be moved afterwards: `GROUP_TUNE.max` sizes the pool of rows and of chevrons, and
 * `CHAT_TUNE.pool` sizes the bubbles. That is what a fixed pool means, and it is said here rather
 * than left for someone to find by setting one and seeing nothing happen.
 */
export function tuneGroupUi(o: Partial<typeof GROUP_UI_TUNE>): typeof GROUP_UI_TUNE {
  if (typeof o.panelKey === 'string' && /^[A-Za-z0-9]+$/.test(o.panelKey)) GROUP_UI_TUNE.panelKey = o.panelKey;
  if (typeof o.chevrons === 'boolean') GROUP_UI_TUNE.chevrons = o.chevrons;
  if (typeof o.chevronLift === 'number') GROUP_UI_TUNE.chevronLift = Math.max(0, Math.min(20, o.chevronLift));
  if (typeof o.hz === 'number') {
    GROUP_UI_TUNE.hz = Math.max(0.5, Math.min(30, o.hz));
    for (const panel of LIVE) panel.rearm();
  }
  return GROUP_UI_TUNE;
}

/** What the panel is doing, filled in place for the console: never a new object. */
export interface GroupUiStats {
  open: boolean;
  rows: number;
  chevrons: number;
  /** Every write this file has made to the page since it was built. */
  writes: number;
  /** Ticks of the slow step, and frames of the chevron loop. */
  ticks: number;
  frames: number;
}

/** What the panel needs of the game. Everything is a function, so nothing here holds a stale copy. */
export interface GroupUiDeps {
  groups: Groups;
  /** Something for the player to read that is not a line of chat. */
  note: (text: string) => void;
  /** A world point onto this frame's screen; false when it is behind the camera. */
  project: (x: number, y: number, z: number, out: GroupScreenPoint) => boolean;
  /** Where a player's figure is; false when they are not on this world. */
  anchor: (id: number, out: PointOut) => boolean;
  /** Where the eye is and which way it looks, for "the player you are looking at". Filled in place. */
  view: (eye: PointOut, dir: PointOut) => boolean;
  /** The players on this world, filled into the list; the answer is how many were filled. */
  peersHere: (out: LookCandidate[]) => number;
  /** Whether the key should work here: in the world, no other panel up, not travelling. */
  canOpen: () => boolean;
  /** The panel wants the mouse (and gives it back): the game's own free-the-mouse. */
  freeMouse: (free: boolean) => void;
  /**
   * Ask a member of the group to trade, by the connection they are on. It is handed in rather than
   * imported because the ledger is wired after this panel is built; the answer is what to tell the
   * player, and '' when the asking went out.
   */
  trade?: (id: number, name: string) => string;
}

interface Row {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly where: HTMLElement;
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
  readonly trade: HTMLButtonElement;
  readonly promote: HTMLButtonElement;
  readonly kick: HTMLButtonElement;
  /** The member id the roster gives, which is what a kick or a promotion names. */
  mid: string;
  /** The connection the member is on now, which is what a trade names them by; 0 while they are away. */
  id: number;
  /** The member's plain name, without the leader's mark or the "(you)", which is what a trade says. */
  who: string;
  nameText: string;
  whereText: string;
  hp: number;
  buttons: boolean;
  canTrade: boolean;
  shown: boolean;
}

interface Chevron {
  readonly el: HTMLElement;
  id: number;
  x: number;
  y: number;
  shown: boolean;
}

// Every colour is one of the palette's eighteen names (`src/style.css`, `src/core/palette.ts`), as a
// name or as that name at an alpha, and never a value typed here: `hudPage.test.ts` reads this string
// out of the file and holds it to the same rule as the stylesheet. The panel's backing was a near-black
// at 0.78 and is `void` at 78%; the buttons' fill was a blue-grey at 0.9 and is `plate`, as the trade
// window's buttons already are; the health bar's track was white at 0.12 and is `ink` at 12%.
//
// A window somebody has sized (`win-sized`, from `src/ui/drag.ts`) lays its rows out down the frame
// and scrolls them, the header and the foot keeping their room.
const CSS = `
.group-panel {
  position: absolute;
  right: calc(14px * var(--hud-scale, 1));
  top: calc(120px * var(--hud-scale, 1));
  width: calc(260px * var(--hud-scale, 1));
  padding: calc(8px * var(--hud-scale, 1));
  border-radius: 6px;
  background: color-mix(in srgb, var(--void) 78%, transparent);
  border: 1px solid var(--rule);
  font: 500 calc(12px * var(--hud-scale, 1))/1.4 system-ui, sans-serif;
  color: var(--ink);
  pointer-events: auto;
  z-index: 6;
}
.group-panel.hidden { display: none; }
.group-panel.win-sized:not(.hidden) { display: flex; flex-direction: column; }
.group-panel.win-sized .rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.group-panel.win-sized .foot, .group-panel.win-sized .hint, .group-panel.win-sized h3 { flex: none; }
.group-panel h3 { margin: 0 0 6px; font-size: calc(13px * var(--hud-scale, 1)); color: var(--accent); }
.group-row { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; padding: 4px 0; border-top: 1px solid var(--rule); }
.group-row.hidden { display: none; }
.group-row .who { font-weight: 600; }
.group-row .where { color: var(--muted); font-size: calc(11px * var(--hud-scale, 1)); }
.group-row .hp { grid-column: 1 / -1; height: 3px; background: color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 2px; overflow: hidden; }
.group-row .hp.hidden { display: none; }
.group-row .hp > i { display: block; height: 100%; background: var(--good); transform-origin: left center; transform: scaleX(1); }
.group-row .acts { grid-column: 2; display: flex; gap: 4px; }
.group-panel button {
  background: var(--plate);
  color: inherit;
  border: 1px solid var(--edge);
  border-radius: 3px;
  padding: 2px 6px;
  font: inherit;
  cursor: pointer;
}
.group-panel button.hidden { display: none; }
.group-panel button:hover { border-color: var(--accent); }
.group-panel .foot { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.group-panel .hint { color: var(--muted); font-size: calc(11px * var(--hud-scale, 1)); margin: 6px 0 0; }
.group-ask {
  position: absolute;
  left: 50%;
  top: calc(140px * var(--hud-scale, 1));
  transform: translateX(-50%);
  padding: calc(8px * var(--hud-scale, 1)) calc(12px * var(--hud-scale, 1));
  border-radius: 6px;
  background: color-mix(in srgb, var(--void) 85%, transparent);
  border: 1px solid var(--accent);
  font: 500 calc(13px * var(--hud-scale, 1))/1.4 system-ui, sans-serif;
  color: var(--ink);
  text-align: center;
  pointer-events: auto;
  z-index: 7;
}
.group-ask.hidden { display: none; }
.group-ask .acts { display: flex; gap: 6px; justify-content: center; margin-top: 6px; }
.group-ask button {
  background: var(--plate);
  color: inherit;
  border: 1px solid var(--edge);
  border-radius: 3px;
  padding: 3px 10px;
  font: inherit;
  cursor: pointer;
}
.group-marks { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 5; }
.group-mark {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--accent);
  font: 600 14px/1 system-ui, sans-serif;
  text-shadow: 0 0 3px color-mix(in srgb, var(--void) 80%, transparent);
  white-space: nowrap;
  will-change: transform;
}
.group-mark.hidden { display: none; }
`;

export class GroupUi {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly inviteBtn: HTMLButtonElement;
  private readonly leaveBtn: HTMLButtonElement;
  private readonly disbandBtn: HTMLButtonElement;
  private readonly ask: HTMLElement;
  private readonly askText: HTMLElement;
  private readonly askYes: HTMLButtonElement;
  private readonly askNo: HTMLButtonElement;
  private readonly marks: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly chevrons: Chevron[] = [];
  private readonly at: GroupScreenPoint = { x: 0, y: 0 };
  private readonly where: PointOut = { x: 0, y: 0, z: 0 };
  private readonly eye: PointOut = { x: 0, y: 0, z: 0 };
  private readonly dir: PointOut = { x: 0, y: 0, z: 0 };
  private readonly candidates: LookCandidate[] = [];
  private timer = 0;
  private raf = 0;
  private lastTick = 0;
  private lastFrame = 0;
  private askText0 = '';
  private titleText = '';
  private hintText = '';
  /** What the two foot buttons are showing now, so neither is written when nothing has changed. */
  private leaveShown = true;
  private disbandShown = false;
  /** Whether anybody is far enough off to need a chevron: worked out by the slow step, read by the frame. */
  private chevronsWanted = false;
  private readonly stat: GroupUiStats = { open: false, rows: 0, chevrons: 0, writes: 0, ticks: 0, frames: 0 };
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onLock: () => void;
  /**
   * The chevron loop's callback, made once and used for every frame: a fresh closure per frame is an
   * allocation per frame, which is the one thing nothing in this game is allowed to do.
   */
  private readonly onFrame: () => void = () => this.markFrame();
  /** The group module's handlers as they were before this panel chained onto them, and this panel's own. */
  private hadRoster: (g: GroupRoster | null) => void = () => {};
  private hadInvite: (i: GroupInvite | null) => void = () => {};
  private hadTrip: (t: GroupTrip | null) => void = () => {};
  private mineRoster: (g: GroupRoster | null) => void = () => {};
  private mineInvite: (i: GroupInvite | null) => void = () => {};
  private mineTrip: (t: GroupTrip | null) => void = () => {};
  /**
   * What this panel needs of the game. It is assigned in the body rather than written as a parameter
   * property, because a node test runs this file as it is -- node strips the types and nothing else,
   * and a parameter property is not something it can strip.
   */
  private readonly deps: GroupUiDeps;

  constructor(parent: HTMLElement, deps: GroupUiDeps) {
    this.deps = deps;
    if (!document.getElementById('group-style')) {
      const style = document.createElement('style');
      style.id = 'group-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'group-root';
    parent.appendChild(this.root);

    this.marks = document.createElement('div');
    this.marks.className = 'group-marks';
    this.root.appendChild(this.marks);

    this.panel = document.createElement('div');
    this.panel.className = 'group-panel hidden';
    this.panel.innerHTML = `
      <h3>Group</h3>
      <div class="rows"></div>
      <div class="foot">
        <button type="button" class="invite">Invite whoever you are looking at</button>
        <button type="button" class="leave">Leave</button>
        <button type="button" class="disband hidden">Disband</button>
      </div>
      <p class="hint"></p>`;
    this.root.appendChild(this.panel);
    this.title = this.panel.querySelector<HTMLElement>('h3')!;
    this.list = this.panel.querySelector<HTMLElement>('.rows')!;
    this.hint = this.panel.querySelector<HTMLElement>('.hint')!;
    this.inviteBtn = this.panel.querySelector<HTMLButtonElement>('.invite')!;
    this.leaveBtn = this.panel.querySelector<HTMLButtonElement>('.leave')!;
    this.disbandBtn = this.panel.querySelector<HTMLButtonElement>('.disband')!;
    this.inviteBtn.addEventListener('click', () => this.inviteLookedAt());
    this.leaveBtn.addEventListener('click', () => this.deps.groups.leave());
    this.disbandBtn.addEventListener('click', () => this.deps.groups.disband());

    // A pool of rows, made once: eight is the group's own size, and none is ever made in a tick.
    for (let i = 0; i < GROUP_TUNE.max; i++) {
      const el = document.createElement('div');
      el.className = 'group-row hidden';
      el.innerHTML = '<span class="who"></span><span class="acts"><button type="button" class="trade">Trade</button><button type="button" class="promote">Lead</button><button type="button" class="kick">Remove</button></span><span class="where"></span><span class="hp"><i></i></span>';
      this.list.appendChild(el);
      const row: Row = {
        el,
        name: el.querySelector<HTMLElement>('.who')!,
        where: el.querySelector<HTMLElement>('.where')!,
        bar: el.querySelector<HTMLElement>('.hp')!,
        fill: el.querySelector<HTMLElement>('.hp > i')!,
        trade: el.querySelector<HTMLButtonElement>('.trade')!,
        promote: el.querySelector<HTMLButtonElement>('.promote')!,
        kick: el.querySelector<HTMLButtonElement>('.kick')!,
        mid: '',
        id: 0,
        who: '',
        nameText: '',
        whereText: '',
        hp: -2,
        buttons: true,
        canTrade: true,
        shown: true,
      };
      row.trade.addEventListener('click', () => {
        if (!row.id || !this.deps.trade) return;
        this.deps.note(this.deps.trade(row.id, row.who) || `asked ${row.who} to trade`);
      });
      row.promote.addEventListener('click', () => {
        if (row.mid) this.deps.groups.promote(row.mid);
      });
      row.kick.addEventListener('click', () => {
        if (row.mid) this.deps.groups.kick(row.mid);
      });
      this.rows.push(row);
    }

    this.ask = document.createElement('div');
    this.ask.className = 'group-ask hidden';
    this.ask.innerHTML = '<div class="what"></div><div class="acts"><button type="button" class="yes">Accept</button><button type="button" class="no">Decline</button></div>';
    this.root.appendChild(this.ask);
    this.askText = this.ask.querySelector<HTMLElement>('.what')!;
    this.askYes = this.ask.querySelector<HTMLButtonElement>('.yes')!;
    this.askNo = this.ask.querySelector<HTMLButtonElement>('.no')!;
    this.askYes.addEventListener('click', () => this.answer(true));
    this.askNo.addEventListener('click', () => this.answer(false));

    for (let i = 0; i < GROUP_TUNE.max; i++) {
      const el = document.createElement('div');
      el.className = 'group-mark hidden';
      el.textContent = '▲';
      this.marks.appendChild(el);
      this.chevrons.push({ el, id: 0, x: -1e6, y: -1e6, shown: false });
    }

    // The group changed, somebody asked, a leader is going somewhere: each writes to the page once.
    // Whatever was listening before still is, so a display that grows a roster of its own is not
    // silently unplugged by this panel being built.
    // Each wrapper and what it wrapped are kept, so that `dispose` can put the chain back the way it
    // was -- but only where this panel's wrapper is still the one hanging there. Somebody who chained
    // onto ours after we were built owns the hook now, and putting ours back would unplug them.
    this.hadRoster = deps.groups.onRoster;
    this.hadInvite = deps.groups.onInvite;
    this.hadTrip = deps.groups.onTrip;
    this.mineRoster = (g) => {
      this.hadRoster(g);
      this.roster(g);
    };
    this.mineInvite = (i) => {
      this.hadInvite(i);
      this.invited(i);
    };
    this.mineTrip = (t) => {
      this.hadTrip(t);
      this.tripped(t);
    };
    deps.groups.onRoster = this.mineRoster;
    deps.groups.onInvite = this.mineInvite;
    deps.groups.onTrip = this.mineTrip;

    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    // Clicking the world asks for the pointer back, and this panel holds the mouse while it is open:
    // with the lock taken the cursor is gone and the game's own input is still standing aside, which
    // reads as the game having half-hung. A click on the world means "I want to play", so the panel
    // shuts and gives the keys back. The slow step checks the same thing, in case nothing listens.
    this.onLock = () => this.lockTaken();
    document.addEventListener?.('pointerlockchange', this.onLock);
    LIVE.add(this);
  }

  /** The pointer lock went to something else while this panel was up: stand down and let play go on. */
  private lockTaken(): void {
    if (this.open && typeof document !== 'undefined' && document.pointerLockElement) this.hide();
  }

  /** Arm the slow step again at whatever `GROUP_UI_TUNE.hz` now says, if it is running. */
  rearm(): void {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.wake();
  }

  // ---- the panel -----------------------------------------------------------------------------------

  get open(): boolean {
    return !this.panel.classList.contains('hidden');
  }

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // Escape shuts this panel and nothing else: the game's own Escape would open the menu instead,
    // and it is listening on the same window, so the press has to stop here. This panel is built
    // before that listener is put on, so this one is asked first.
    if (e.code === 'Escape') {
      if (!this.open) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.hide();
      return;
    }
    if (e.code !== GROUP_UI_TUNE.panelKey) return;
    if (this.open) {
      this.hide();
      return;
    }
    // With no server there is no group to keep, and a game played alone must be the game it was: the
    // key does nothing at all rather than opening a panel to say so. The console can still open it.
    if (!this.deps.groups.active) return;
    if (!this.deps.canOpen()) return;
    this.show();
  }

  show(): void {
    if (this.open) return;
    this.panel.classList.remove('hidden');
    this.stat.open = true;
    this.deps.freeMouse(true);
    this.draw();
    this.wake();
  }

  hide(): void {
    this.shut(true);
  }

  /**
   * Shut the panel. The mouse goes back to the game only when this panel is what was holding it: a
   * panel that has stood aside because another one opened must not take the mouse off it.
   */
  private shut(giveBackMouse: boolean): void {
    if (!this.open) return;
    this.panel.classList.add('hidden');
    this.stat.open = false;
    if (giveBackMouse) this.deps.freeMouse(false);
  }

  /** Ask in whoever is in the middle of the view, within the game's own 90 m. */
  private inviteLookedAt(): void {
    if (!this.deps.view(this.eye, this.dir)) {
      this.deps.note('nothing to look along yet');
      return;
    }
    const n = this.deps.peersHere(this.candidates);
    const id = pickLookedAt(this.candidates, n, this.eye.x, this.eye.y, this.eye.z, this.dir.x, this.dir.y, this.dir.z);
    if (!id) {
      this.deps.note(`look at the player you want, within ${GROUP_RANGE.invite} m`);
      return;
    }
    let name = '';
    for (let i = 0; i < n; i++) if (this.candidates[i].id === id) name = this.candidates[i].name;
    const why = this.deps.groups.askInvite(id, name);
    this.deps.note(why || `asked ${name || 'them'} into the group`);
  }

  private answer(yes: boolean): void {
    const g = this.deps.groups;
    if (g.invite) {
      if (yes) g.accept();
      else g.decline();
      return;
    }
    if (g.trip) {
      if (yes) g.acceptTrip();
      else g.declineTrip();
    }
  }

  // ---- what the server said ------------------------------------------------------------------------

  private roster(g: GroupRoster | null): void {
    if (!g) {
      this.hide();
      this.dropChevrons();
    }
    this.draw();
    this.wake();
  }

  private invited(i: GroupInvite | null): void {
    if (!i) {
      this.showAsk('');
      return;
    }
    this.showAsk(`${i.name} asks you into their group`);
    this.wake();
  }

  private tripped(t: GroupTrip | null): void {
    if (!t) {
      if (!this.deps.groups.invite) this.showAsk('');
      return;
    }
    this.showAsk(`${t.name} is going to ${t.planet || 'somewhere else'}. Go with them?`);
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

  /** The panel's rows, written only where what they show has changed. */
  private draw(): void {
    const g = this.deps.groups.roster;
    const leading = this.deps.groups.leading;
    const title = g ? `Group (${g.members.length} of ${GROUP_TUNE.max})` : 'Group';
    if (title !== this.titleText) {
      this.titleText = title;
      this.title.textContent = title;
      this.stat.writes++;
    }
    const members = g ? g.members : null;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const m = members && i < members.length ? members[i] : null;
      if (!m) {
        if (row.shown) {
          row.el.classList.add('hidden');
          row.shown = false;
          row.mid = '';
          row.id = 0;
          row.who = '';
          this.stat.writes++;
        }
        continue;
      }
      if (!row.shown) {
        row.el.classList.remove('hidden');
        row.shown = true;
        this.stat.writes++;
      }
      row.mid = m.mid;
      row.id = m.id;
      row.who = m.name;
      const name = `${m.leader ? '★ ' : ''}${m.name}${m.me ? ' (you)' : ''}`;
      if (name !== row.nameText) {
        row.nameText = name;
        row.name.textContent = name;
        this.stat.writes++;
      }
      const where = this.whereOf(m);
      if (where !== row.whereText) {
        row.whereText = where;
        row.where.textContent = where;
        this.stat.writes++;
      }
      if (m.hp !== row.hp) {
        row.hp = m.hp;
        if (m.hp < 0) row.bar.classList.add('hidden');
        else {
          row.bar.classList.remove('hidden');
          row.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, m.hp)).toFixed(2)})`;
        }
        this.stat.writes++;
      }
      // The leader's own buttons, and never against their own row.
      const buttons = leading && !m.me;
      if (buttons !== row.buttons) {
        row.buttons = buttons;
        row.promote.classList.toggle('hidden', !buttons);
        row.kick.classList.toggle('hidden', !buttons);
        this.stat.writes++;
      }
      // Trading is nobody's privilege: any member may ask any other, and the ledger refuses it past
      // the game's own 8 m. It is hidden for your own row and for anybody who is not here.
      const canTrade = !m.me && m.here && !!this.deps.trade;
      if (canTrade !== row.canTrade) {
        row.canTrade = canTrade;
        row.trade.classList.toggle('hidden', !canTrade);
        this.stat.writes++;
      }
    }
    this.stat.rows = members ? members.length : 0;
    const hint = g
      ? `An invitation reaches ${GROUP_RANGE.invite} m, which is the game's own. Type /g to talk to the group.`
      : `Nobody yet. Look at a player within ${GROUP_RANGE.invite} m and ask them in, or type /invite <name>.`;
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hint.textContent = hint;
      this.stat.writes++;
    }
    const leave = !!g;
    if (leave !== this.leaveShown) {
      this.leaveShown = leave;
      this.leaveBtn.classList.toggle('hidden', !leave);
      this.stat.writes++;
    }
    if (leading !== this.disbandShown) {
      this.disbandShown = leading;
      this.disbandBtn.classList.toggle('hidden', !leading);
      this.stat.writes++;
    }
  }

  /** What a row says about where a member is: their distance here, or the world they are on. */
  private whereOf(m: GroupMember): string {
    if (m.me) return 'here';
    // A member whose line has closed keeps their place for a while; they are not gone, they are away.
    if (!m.here) return 'away';
    if (m.distance >= 0) return `${m.distance} m`;
    return m.planet ? `on ${m.planet}${m.zone && m.zone !== m.planet ? ` · ${m.zone}` : ''}` : 'somewhere else';
  }

  // ---- the slow step and the chevrons ---------------------------------------------------------------

  /** Start the slow step when there is something to keep up with, and stop it when there is not. */
  private wake(): void {
    const g = this.deps.groups;
    // The panel being open counts: it is what notices that something else has taken the screen.
    const wanted = !!g.roster || !!g.invite || !!g.trip || this.open;
    if (!wanted) {
      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = 0;
      }
      this.dropChevrons();
      return;
    }
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), Math.round(1000 / Math.max(0.5, GROUP_UI_TUNE.hz)));
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(2, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    this.stat.ticks++;
    // The menu, the map or another panel has taken the screen: this one stands aside without taking
    // the mouse back off whatever took it. It is noticed here because nothing tells a panel directly.
    if (this.open && !this.deps.canOpen()) this.shut(false);
    // The backstop for the pointer going back to the game without a word being sent about it.
    this.lockTaken();
    const moved = this.deps.groups.step(dt);
    if (moved && this.open) this.draw();
    // The countdown on an invitation, written once a second's worth of steps.
    const inv = this.deps.groups.invite;
    const trip = this.deps.groups.trip;
    if (inv) this.showAsk(`${inv.name} asks you into their group (${Math.ceil(inv.left)} s)`);
    else if (trip) this.showAsk(`${trip.name} is going to ${trip.planet || 'somewhere else'} (${Math.ceil(trip.left)} s)`);
    // Whether a frame loop is worth running at all: not "there is a group", which would run one for
    // as long as anybody was in one and draw nothing, but "somebody is far enough off to need a
    // chevron, and the world is what is on the screen". The distances were all just worked out, so
    // this costs nothing. The menu, the map or another panel having the screen stops it; this panel
    // having it does not, and that is what `this.open` is doing in the test.
    const g2 = this.deps.groups.roster;
    let wanted = false;
    if (GROUP_UI_TUNE.chevrons && g2 && (this.deps.canOpen() || this.open)) {
      for (const m of g2.members) {
        if (!m.me && m.here && m.distance > GROUP_TUNE.chevron) {
          wanted = true;
          break;
        }
      }
    }
    this.chevronsWanted = wanted;
    if (wanted) this.startMarks();
    else this.dropChevrons();
    this.wake();
  }

  private startMarks(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.onFrame);
  }

  /** The chevrons follow the camera, so they are the one thing here that runs in a frame. */
  private markFrame(): void {
    this.raf = 0;
    this.stat.frames++;
    const g = this.deps.groups.roster;
    let live = 0;
    for (let i = 0; i < this.chevrons.length; i++) {
      const c = this.chevrons[i];
      const m = g && i < g.members.length ? g.members[i] : null;
      const far = !!m && !m.me && m.distance > GROUP_TUNE.chevron && this.deps.anchor(m.id, this.where) && this.deps.project(this.where.x, this.where.y + GROUP_UI_TUNE.chevronLift, this.where.z, this.at);
      if (!far) {
        if (c.shown) {
          c.el.classList.add('hidden');
          c.shown = false;
          this.stat.writes++;
        }
        continue;
      }
      live++;
      if (!c.shown) {
        c.el.classList.remove('hidden');
        c.shown = true;
        this.stat.writes++;
      }
      if (c.id !== m!.id) {
        c.id = m!.id;
        c.el.textContent = `▲ ${m!.name}`;
        this.stat.writes++;
      }
      const x = Math.round(this.at.x);
      const y = Math.round(this.at.y);
      if (x !== c.x || y !== c.y) {
        c.x = x;
        c.y = y;
        c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        this.stat.writes++;
      }
    }
    this.stat.chevrons = live;
    // Kept running only while the slow step says there is a chevron to carry: when the last member
    // walks back in, or something else takes the screen, the loop ends with this frame.
    if (this.chevronsWanted) this.raf = requestAnimationFrame(this.onFrame);
  }

  private dropChevrons(): void {
    this.chevronsWanted = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    for (const c of this.chevrons) {
      c.id = 0;
      c.x = -1e6;
      c.y = -1e6;
      if (c.shown) {
        c.el.classList.add('hidden');
        c.shown = false;
        this.stat.writes++;
      }
    }
    this.stat.chevrons = 0;
  }

  /** Everything down: the panel shut, the question gone, the chevrons taken away. */
  clearAll(): void {
    this.hide();
    this.showAsk('');
    this.dropChevrons();
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  debug(): GroupUiStats {
    this.stat.open = this.open;
    return this.stat;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener?.('pointerlockchange', this.onLock);
    const g = this.deps.groups;
    if (g.onRoster === this.mineRoster) g.onRoster = this.hadRoster;
    if (g.onInvite === this.mineInvite) g.onInvite = this.hadInvite;
    if (g.onTrip === this.mineTrip) g.onTrip = this.hadTrip;
    LIVE.delete(this);
    this.clearAll();
    this.root.remove();
  }
}
