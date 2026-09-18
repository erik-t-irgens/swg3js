// The lists things are picked from (the weapons rack, the garage, the NPCs) share one shape: groups
// that fold, each with its count in the heading, a grid of short entries inside, and names read out
// of the ids rather than the ids themselves. A search opens every group it finds something in; a
// group the player opened or closed by hand stays that way while the panel lives.

/** Prefixes that only say which list an id is in, dropped from its name. */
const CLASS_PREFIX = /^(generic_sword_lightsaber_|sword_lightsaber_(one_handed|two_handed|polearm)_|sword_lightsaber_|2h_sword_|sword_|knife_|lance_|carbine_|pistol_|rifle_|heavy_)/;
/** Tokens that mark a variant rather than name the thing: shown small after the name. */
const TAGS = new Set(['npe', 'quest', 'static', 'generic', 'noob', 'decorative', 'crafted', 'heroic', 'must', 'pvp', 'gcw', 'bf', 'loot', 'ep3', 'som', 'event', 'avatar', 'combined']);
/** Model codes are upper case: dl44, e11, dc15, t21, kyd21, cr1, ee3, fwg5. */
const CODE = /^[a-z]{1,3}\d+[a-z]?$/;

export interface Named {
  name: string;
  tags: string[];
}

/** "sword_lightsaber_one_handed_gen4_must" reads as "Gen 4" tagged "must"; "carbine_dc15" as "DC15". */
export function prettyName(id: string): Named {
  const rest = id.replace(CLASS_PREFIX, '');
  const words: string[] = [];
  const tags: string[] = [];
  for (const t of rest.split('_').filter(Boolean)) {
    if (TAGS.has(t)) tags.push(t);
    else if (/^gen\d$/.test(t)) words.push(`gen ${t.slice(3)}`);
    else if (/^s\d{1,2}$/.test(t)) words.push(`s${t.slice(1)}`);
    else if (CODE.test(t)) words.push(t.toUpperCase());
    else words.push(t);
  }
  if (!words.length) words.push(...tags.splice(0));
  const name = words.join(' ');
  return { name: name.charAt(0).toUpperCase() + name.slice(1), tags };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A folding group: its heading with the count and a note, the entries inside as a grid. */
export function groupHtml(key: string, label: string, count: number, note: string, open: boolean, inner: string): string {
  return `<details class="cat-group" data-key="${escapeHtml(key)}"${open ? ' open' : ''}><summary><span class="cat-label">${escapeHtml(label)}</span><span class="cat-count">${count}</span>${note ? `<span class="cat-note">${escapeHtml(note)}</span>` : ''}</summary><div class="cat-grid">${inner}</div></details>`;
}

/**
 * A folding group whose entries are put in later: the heading with the count, a note and any
 * buttons of its own (`actions`, markup that goes in the heading after the note), and an empty
 * grid marked `data-body` for the caller to fill the first time it is opened. A list of thousands
 * renders its headings alone and builds a group's rows only when someone looks.
 */
export function groupShell(key: string, label: string, count: number, note: string, open: boolean, actions = ''): string {
  const k = escapeHtml(key);
  return `<details class="cat-group" data-key="${k}"${open ? ' open' : ''}><summary><span class="cat-label">${escapeHtml(label)}</span><span class="cat-count">${count}</span>${note ? `<span class="cat-note">${escapeHtml(note)}</span>` : '<span class="cat-note"></span>'}${actions}</summary><div class="cat-grid" data-body="${k}"></div></details>`;
}

/** Which groups the player has opened or closed by hand, so a render keeps them that way. */
export class GroupState {
  private readonly byHand = new Map<string, boolean>();

  /** Open when the player said so; else as the caller wants (a search open, a held item's group open). */
  isOpen(key: string, wanted: boolean): boolean {
    return this.byHand.get(key) ?? wanted;
  }

  /** Remember toggles made on the rendered groups. */
  wire(body: HTMLElement): void {
    for (const d of body.querySelectorAll<HTMLDetailsElement>('details.cat-group')) {
      d.addEventListener('toggle', () => this.byHand.set(d.dataset.key!, d.open));
    }
  }

  /** A search opens what it finds: hand-made choices are dropped while it lasts. */
  clear(): void {
    this.byHand.clear();
  }
}
