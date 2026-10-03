// The quiet line on the display that says the world is not running by its own rules just now: the
// weather or the day held or forced (`Weather.heldNote`, the day's half from the shared clock), god
// mode on, and the draw distance held past the page from the console. Each is a kept string, and the
// joined line is made again only when one of them changes, so asking for it every frame allocates
// nothing.
//
// Pure: no DOM, so the node test runs it.

/** While god mode is on (`__debug.god`). */
export const GOD_NOTE = 'God mode: nothing hurts you or what you ride';
/** While `__debug.reach` holds any axis. */
export const REACH_NOTE = 'Draw distance held from the console';

export class HeldNotes {
  private base = '';
  private god = false;
  private reach = false;
  private text = '';

  /** The line: the weather's and the day's, then god mode, then the reach; the same string while nothing changed. */
  join(base: string, god: boolean, reach: boolean): string {
    if (base === this.base && god === this.god && reach === this.reach) return this.text;
    this.base = base;
    this.god = god;
    this.reach = reach;
    let t = base;
    if (god) t = t ? `${t} · ${GOD_NOTE}` : GOD_NOTE;
    if (reach) t = t ? `${t} · ${REACH_NOTE}` : REACH_NOTE;
    this.text = t;
    return t;
  }
}
