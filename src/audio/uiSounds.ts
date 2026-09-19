/**
 * The interface's clicks. The game's own table (`datatables/player/sounds.iff`) gives 31 rows of
 * name to sound; the converter writes it beside the templates and the names below are that table's
 * own, read from the archives. Which panel action plays which row is ours (INVENTED) -- the table
 * says what the sounds are called, never where the client used them.
 *
 * Everything is a non-positional voice on the interface's own slots, so a click is never crowded
 * out by a fight. A row the pack does not carry simply makes that action silent, and the action is
 * listed as unresolved in the report, which is how a hidden tab checks the wiring.
 */

export type UiAction =
  | 'panelOpen'
  | 'panelClose'
  | 'confirm'
  | 'back'
  | 'forward'
  | 'rollover'
  | 'select'
  | 'negative'
  | 'warning'
  | 'equipWeapon'
  | 'wheelOpen'
  | 'wheelPick'
  | 'increment';

/** The action to the table row it plays. The rows are the game's; the pairing is ours. */
export const UI_ROWS: Record<UiAction, string> = {
  panelOpen: 'backpack_open',
  panelClose: 'backpack_close',
  confirm: 'button_confirm',
  back: 'button_arrow_back',
  forward: 'button_arrow_forward',
  rollover: 'rollover',
  select: 'select',
  negative: 'negative',
  warning: 'dialog_warning',
  equipWeapon: 'equip_blaster',
  wheelOpen: 'radial_create',
  wheelPick: 'radial_complete',
  increment: 'increment_small',
};

/** INVENTED: the least seconds between two of the same action, so a list hover does not chatter. */
export const UI_THROTTLE: Partial<Record<UiAction, number>> = { rollover: 0.06, select: 0.04, increment: 0.03 };

/**
 * The actions nothing in the game plays yet. They have rows and throttles so the wiring is one
 * edit when the panel that wants them is built; until then `report` says so rather than listing
 * them as though they were hooked up.
 */
export const UI_NO_CALLER: readonly UiAction[] = ['negative', 'warning', 'equipWeapon', 'wheelOpen', 'wheelPick', 'back', 'forward'];

/** What the converter writes for the table: row name to template id. */
export type UiTable = Record<string, string>;

export class UiSounds {
  private table: UiTable | null = null;
  /**
   * When each sound was last played, keyed by the template it resolved to and not by the action:
   * the game's own table points more than one row at one sound (the radial menu's row is
   * `ui_rollover`, the same sample a list hover uses), and a throttle per action would let two
   * actions play the same click twice in a frame.
   */
  private readonly last = new Map<string, number>();
  /** The gap each sound keeps: the longest any action that resolves to it asks for. */
  private readonly soundGap = new Map<string, number>();
  private readonly plays = new Map<UiAction, number>();
  private readonly now: () => number;
  private readonly start: (id: string) => boolean;
  /** Counters for the headless report. */
  readonly counts = { played: 0, throttled: 0, unresolved: 0 };

  /**
   * `now` is the audio clock, handed in by the system so nothing here reads a clock of its own;
   * `start` plays a template id and says whether a voice actually began.
   */
  constructor(now: () => number, start: (id: string) => boolean) {
    this.now = now;
    this.start = start;
  }

  /** The converted table. Until it arrives every action is silent and says so. */
  attach(table: UiTable | null): void {
    this.table = table;
    this.last.clear();
    this.soundGap.clear();
    // The throttles are worked out per sound once the table says what each action resolves to,
    // because the game's own table points more than one row at one sample.
    for (const action of Object.keys(UI_ROWS) as UiAction[]) {
      const gap = UI_THROTTLE[action];
      const id = this.soundFor(action);
      if (gap === undefined || !id) continue;
      this.soundGap.set(id, Math.max(this.soundGap.get(id) ?? 0, gap));
    }
  }

  get ready(): boolean {
    return !!this.table;
  }

  soundFor(action: UiAction): string | null {
    return this.table?.[UI_ROWS[action]] ?? null;
  }

  /** Play one. False when there is no table, the row is missing, or it came too soon after the last. */
  play(action: UiAction): boolean {
    const id = this.soundFor(action);
    if (!id) {
      this.counts.unresolved++;
      return false;
    }
    const gap = this.soundGap.get(id) ?? UI_THROTTLE[action];
    if (gap !== undefined) {
      const t = this.now();
      const was = this.last.get(id);
      if (was !== undefined && t - was < gap) {
        this.counts.throttled++;
        return false;
      }
      this.last.set(id, t);
    }
    const ok = this.start(id);
    if (ok) {
      this.counts.played++;
      this.plays.set(action, (this.plays.get(action) ?? 0) + 1);
    }
    return ok;
  }

  /**
   * Every action with the row it takes, the template it resolved to, how many times it has played
   * and whether anything in the game plays it yet: the headless check of the wiring, which must not
   * read as though an action with a row were hooked up.
   */
  report(): { action: UiAction; row: string; sound: string | null; played: number; wired: boolean }[] {
    return (Object.keys(UI_ROWS) as UiAction[]).map((action) => ({
      action,
      row: UI_ROWS[action],
      sound: this.soundFor(action),
      played: this.plays.get(action) ?? 0,
      wired: !UI_NO_CALLER.includes(action),
    }));
  }
}
