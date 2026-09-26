// The give screens' display rules: how a converted catalogue becomes the cells the Clothes (give)
// and Weapons (give) tabs draw.
//
// It lives apart from the two panels because it is the half that can be checked without a browser.
// Which entries are listed at all and which are left out; which slot each is listed under; what a
// cell is called when two items share the game's name; and -- the one that decides whether the
// screens look broken -- what a cell shows when the converter drew no picture for it.
//
// That last one is not a rare accident. Counted on the owner's own packs with the two switches as the
// panel opens them, the human folders list 915 and 964 items and every one has a picture; the Ithorian
// folders list 519 and 522 of which 172 have none, and every one of those is a row the client's
// appearance table marks `:hide` for that species: the converter wrote no meshes for it (`parts`
// empty, `sat` null), so there was nothing to draw. Such a piece draws nothing on the body either, so
// its cell says "worn unseen" rather than falling back to initials by accident.
//
// It also builds the cell's markup, because both panels must draw exactly the same cell and because a
// string is something a node test can read. No document is touched: no DOM, no three, and only the
// inventory rules, the name maker and the escaper imported, all with their extensions, so a plain
// node test loads this file as it stands.
import { OTHER_GROUP, SLOT_GROUPS, fitFor, slotGroupOf, slotWords, speciesWords } from '../core/inventory.ts';
import type { Fit, ItemFit } from '../core/inventory.ts';
import { escapeHtml, prettyName } from './catalogue.ts';

/**
 * Every number the two give screens invent, in one place so the console can move them
 * (`__debug.giveScreens({ page: 60 })`) and one node test can sweep them.
 *
 * - `page`: cells a group draws at a time, the rest behind a "show the next N" button, exactly as the
 *   NPC tab's rows do -- its own number. Measured on the owner's packs with the switches as the panel
 *   opens them, two of a human wardrobe's thirteen groups run past it (the chest's 175 and 206, and
 *   Other's 124 and 127) and one of the Ithorian's (Other's 123), so a page button is an ordinary
 *   sight and not a once-in-the-panel thing.
 * - `openCells`: how many cells the groups that open on their own may draw between them on the first
 *   paint. Opening every group that holds something worn is thirteen groups and 856 cells on a
 *   dressed human, which is the paging thrown away; the groups past the budget stay folded and their
 *   headings still say what is worn in them.
 * - `nameChars` / `markChars`: how much of a name a 76-pixel cell really shows, and how long the
 *   id's own part beside it may be. Both are read off the cell's width, font and line count rather
 *   than measured in a browser, which is why they are knobs: see `markCells` below.
 * - `findMs`: the find box's debounce, the NPC tab's own number.
 */
export const GIVE_TUNE = {
  page: 120,
  openCells: 360,
  nameChars: 28,
  markChars: 22,
  findMs: 140,
};

/**
 * What a cell shows where the picture goes.
 * - `icon`: the picture the converter baked.
 * - `unseen`: nothing was drawn because there is nothing to draw -- this species wears the piece
 *   unseen and the entry carries no meshes at all.
 * - `blank`: there is a mesh but no picture; the initials stand in, as the backpack's do.
 */
export type Picture = 'icon' | 'unseen' | 'blank';

/** A name's initials, for a cell with no picture (the backpack's own rule). */
export function initialsOf(name: string): string {
  const words = name.split(/[\s_-]+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const pick = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return pick.toUpperCase();
}

/** "armor_mandalorian_chest_plate" reads better as "Mandalorian chest plate". */
export function wearName(id: string): string {
  const words = id.replace(/^(armor|hair)_/, '').split('_');
  const text = words.join(' ').replace(/\bs(\d+)\b/g, '$1').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A weapon's name: the game's own where the pack carries it, the variant tags from the id beside it. */
export function weaponName(w: { id: string; name?: string | null }): { name: string; tags: string[] } {
  const made = prettyName(w.id);
  const name = w.name?.trim();
  return name ? { name, tags: made.tags } : made;
}

/** As much of a `wardrobe.json` entry as the give screen reads. */
export interface WardrobeRow {
  id: string;
  kind?: string;
  gender?: string;
  name?: string | null;
  description?: string | null;
  icon?: string | null;
  slots?: string[][] | null;
  parts?: readonly unknown[];
  fit?: ItemFit;
}

/** As much of a weapon's manifest entry as the give screen reads. */
export interface WeaponRow {
  id: string;
  class: string;
  name?: string | null;
  description?: string | null;
  length?: number;
  icon?: string | null;
}

/** One picture cell. */
export interface GiveCell {
  id: string;
  /** The game's name, else words made from the id. */
  name: string;
  /** What the cell's name line prints. The same as `name`; kept apart because the sort and find read it. */
  label: string;
  /**
   * The id's own part, on a line of its own under the name, when the name alone would not tell this
   * cell from a neighbour in its group; '' otherwise. See `markCells`.
   */
  mark: string;
  /** A word above the name (`right hand`), or ''. */
  tag: string;
  /** Its picture as a URL the panel can put in an `<img>`, or null. */
  icon: string | null;
  picture: Picture;
  /** Shown where the picture would be when there is none. */
  initials: string;
  /** On the body, or in a hand. */
  on: boolean;
  /**
   * This species wears the piece and nothing of it is drawn. The cell dims and wears a corner mark,
   * and the examine strip says so in words -- one field, so the two can never disagree (the corner
   * mark used to read the picture and the words the fit, and a `:hide` row that did have a picture
   * got the words and no mark).
   */
  unseen: boolean;
  fit: Fit;
  /** Authored for the other gender's body. */
  other: boolean;
  /** The group it is listed under (a slot for clothes, a class for weapons). */
  group: string;
  /** The hover text: everything that will not fit on a 76-pixel cell. */
  title: string;
  /** The line under the name in the examine strip, or ''. */
  note: string;
  description: string;
}

export interface GiveGroup {
  id: string;
  label: string;
  /** A heading note: what is worn or held out of this group now, by name. */
  wearing: string[];
  cells: GiveCell[];
}

export interface GiveView {
  groups: GiveGroup[];
  /** How many the panel would list before the find box. */
  listed: number;
  /** How many the find box kept (equal to `listed` when it is empty). */
  shown: number;
  /** Cells with no picture, and how many of those are worn unseen. */
  noPicture: number;
  unseen: number;
  /** How many of the cells shown carry the id's own part because their names alone would not do. */
  marked: number;
  /** How many different pictures the cells shown carry (weapons share models: 587 weapons, 224 pictures). */
  pictures: number;
}

export interface WardrobeOptions {
  /** 'm' or 'f': the body this character has. */
  own: string;
  /** The species id the appearance table's `fit` lists (`wookiee_male`). */
  species: string;
  /** List pieces authored for the other gender's body. */
  mixed: boolean;
  /** List pieces the appearance table says this species cannot wear. */
  blocked: boolean;
  /** The find box, already lower-cased and trimmed. */
  find: string;
  /** Catalogue ids worn now (every worn piece, not one per slot). */
  worn: ReadonlySet<string>;
  /** The wardrobe folder's URL, ending in '/', which each item's picture is relative to; null before it is known. */
  dir: string | null;
  /** Whether the species' own parts pack carries this item, which makes it wearable whatever the table says. */
  packPart: (id: string) => boolean;
}

/** What the wardrobe view leaves out, for the count line. */
export interface WardrobeView extends GiveView {
  /** Left out for being the other gender's. */
  hidden: number;
  /** Left out for being blocked for this species. */
  blocked: number;
}

/**
 * The Clothes (give) tab's groups. The rules are the panel's own from before the pictures, kept to
 * the letter: hair belongs to the Appearance tab and is never listed, a repeated id is one item (the
 * first entry wins, which is the entry `wearItem` would dress with), a piece authored for the other
 * gender or one this species cannot wear stays out unless asked for -- unless it is on the body now,
 * in which case the panel must show what it is describing.
 */
export function buildWardrobeView(items: readonly WardrobeRow[], opts: WardrobeOptions): WardrobeView {
  const seen = new Set<string>();
  const byGroup = new Map<string, GiveCell[]>();
  let hidden = 0;
  let blocked = 0;
  let listed = 0;
  for (const item of items) {
    if (item.kind === 'hair' || /^hair_/.test(item.id)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const on = opts.worn.has(item.id);
    const other = !!item.gender && item.gender.charAt(0) !== opts.own;
    if (other && !opts.mixed && !on) {
      hidden++;
      continue;
    }
    const fit = fitFor(item.fit, opts.species, opts.packPart(item.id));
    if (fit === 'block' && !opts.blocked && !on) {
      blocked++;
      continue;
    }
    listed++;
    const name = item.name?.trim() || wearName(item.id);
    const group = slotGroupOf(item.id);
    const meshless = (item.parts?.length ?? 0) === 0;
    const picture: Picture = item.icon ? 'icon' : meshless ? 'unseen' : 'blank';
    const takes = item.slots?.length ? `takes: ${item.slots.map((a) => slotWords(a)).join(' or ')}` : '';
    const unseen = picture === 'unseen' || fit === 'hide';
    const note = [
      fit === 'block' ? `${speciesWords(opts.species, true)} cannot wear this` : '',
      unseen ? `worn unseen on ${speciesWords(opts.species, false)}: it takes its slots and draws nothing` : '',
      other ? `authored for the ${item.gender === 'f' ? "women's" : "men's"} body` : '',
      takes,
    ]
      .filter(Boolean)
      .join(' · ');
    const cell: GiveCell = {
      id: item.id,
      name,
      label: name,
      mark: '',
      tag: on ? 'worn' : '',
      icon: item.icon && opts.dir ? `${opts.dir}${item.icon}` : null,
      picture,
      initials: initialsOf(name),
      on,
      unseen,
      fit,
      other,
      group,
      title: [item.id, note].filter(Boolean).join('\n'),
      note,
      description: item.description?.trim() ?? '',
    };
    (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(cell);
  }
  return { ...finish(byGroup, [...SLOT_GROUPS, OTHER_GROUP], opts.find, listed), hidden, blocked };
}

export interface WeaponOptions {
  /** The find box, already lower-cased and trimmed. */
  find: string;
  /** What is in each hand now. */
  right: string | null;
  left: string | null;
  /** The classes a left hand may hold. */
  offHand: ReadonlySet<string>;
  /** Each class's heading, in the order the rack reads. */
  order: readonly { id: string; label: string }[];
  /** A weapon's picture as a URL, or null; the catalogue answers it, since only it knows the pack's folder. */
  iconUrl: (w: WeaponRow) => string | null;
}

/**
 * The Weapons (give) tab's groups. A weapon is never left out: the rack lists everything the pack
 * carries, and a grenade is listed without being holdable, exactly as it always was.
 */
export function buildWeaponView(items: readonly WeaponRow[], opts: WeaponOptions): GiveView {
  const byGroup = new Map<string, GiveCell[]>();
  let listed = 0;
  for (const w of items) {
    listed++;
    const { name, tags } = weaponName(w);
    const inRight = opts.right === w.id;
    const inLeft = opts.left === w.id;
    const icon = opts.iconUrl(w);
    const reach = typeof w.length === 'number' && w.length > 0 ? `${w.length.toFixed(2)} m` : '';
    const note = [reach ? `reach ${reach}` : '', tags.length ? tags.join(' ') : '', w.class === 'thrown' ? 'thrown from a number slot, not held' : opts.offHand.has(w.class) ? 'either hand' : 'the right hand'].filter(Boolean).join(' · ');
    const cell: GiveCell = {
      id: w.id,
      name,
      label: name,
      mark: '',
      tag: inRight ? 'right hand' : inLeft ? 'left hand' : '',
      icon,
      picture: icon ? 'icon' : 'blank',
      initials: initialsOf(name),
      on: inRight || inLeft,
      unseen: false,
      fit: 'ok',
      other: false,
      group: w.class,
      title: [w.id, note].filter(Boolean).join('\n'),
      note,
      description: w.description?.trim() ?? '',
    };
    (byGroup.get(w.class) ?? byGroup.set(w.class, []).get(w.class)!).push(cell);
  }
  return finish(byGroup, opts.order, opts.find, listed);
}

/** One prop, as the panel reads it off the pack. */
export interface PropRow {
  id: string;
  group: string;
  name?: string | null;
  description?: string | null;
  icon?: string | null;
  size?: { w: number; h: number; d: number };
}

export interface PropOptions {
  /** The find box, already lower-cased and trimmed. */
  find: string;
  /** The prop in hand now, if any: its cell wears the mark. */
  held: string | null;
  /** Each group's heading, in the order the panel reads. */
  order: readonly { id: string; label: string }[];
  /** A prop's picture as a URL, or null; the catalogue answers it, since only it knows the folder. */
  iconUrl: (p: PropRow) => string | null;
}

/**
 * The Props tab's groups.
 *
 * The same shape as the rack's, deliberately: eight and a half thousand things is far too many to
 * read as a list, and the one arrangement this game already has for that many is the give screen's
 * folding groups of pictures with a find box over them. What a cell says beyond its name is the one
 * thing a player choosing furniture actually wants, which is **how big it is**.
 */
export function buildPropView(items: readonly PropRow[], opts: PropOptions): GiveView {
  const byGroup = new Map<string, GiveCell[]>();
  let listed = 0;
  for (const p of items) {
    listed++;
    // 87% of props carry the game's own name; the rest had their key on the server and read as words
    // made from the id, which is the same fallback the ship components and the dance props take.
    const name = p.name?.trim() || wearName(p.id);
    const icon = opts.iconUrl(p);
    const s = p.size;
    const size = s && (s.w || s.h || s.d) ? `${s.w.toFixed(1)} x ${s.h.toFixed(1)} x ${s.d.toFixed(1)} m` : '';
    const held = opts.held === p.id;
    const cell: GiveCell = {
      id: p.id,
      name,
      label: name,
      mark: '',
      tag: held ? 'in hand' : '',
      icon,
      picture: icon ? 'icon' : 'blank',
      initials: initialsOf(name),
      on: held,
      unseen: false,
      fit: 'ok',
      other: false,
      group: p.group,
      title: [p.id, size].filter(Boolean).join('\n'),
      note: size,
      description: p.description?.trim() ?? '',
    };
    (byGroup.get(p.group) ?? byGroup.set(p.group, []).get(p.group)!).push(cell);
  }
  return finish(byGroup, opts.order, opts.find, listed);
}

/**
 * Where the start every id in a set has in common ends, walked back to the last '_' so the part that
 * is left starts at a whole word. Walking back is also what keeps it from being empty when one id is
 * the whole start of another ("..._utility_belt" and "..._utility_belt_camo" leave "belt" and
 * "belt_camo" rather than "" and "_camo").
 */
function commonHead(ids: readonly string[]): number {
  const first = ids[0];
  let n = 0;
  outer: for (; n < first.length; n++) for (const id of ids) if (id[n] !== first[n]) break outer;
  const back = first.lastIndexOf('_', n - 1);
  return back >= 0 ? back + 1 : 0;
}

/** The same at the other end: how many characters of a shared tail to drop, kept to whole words. */
function commonTail(ids: readonly string[], head: number): number {
  const first = ids[0];
  let n = 0;
  outer: for (; n < first.length - head; n++) {
    const ch = first[first.length - 1 - n];
    for (const id of ids) if (id.length - 1 - n < head || id[id.length - 1 - n] !== ch) break outer;
  }
  const tail = first.slice(first.length - n);
  const at = tail.indexOf('_');
  return at >= 0 ? n - at : 0;
}

/** Too long for its line: the middle goes, because both ends carry the difference. */
function elide(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const head = Math.ceil((cap - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (cap - 1 - head))}`;
}

/**
 * Give a cell the id's own part whenever the name a cell really shows would not tell it from a
 * neighbour in the same group.
 *
 * The screens' first cut appended the whole id -- `Type 10 Two-Handed Lightsaber
 * [sword_lightsaber_two_handed_s10_gen1]` -- and a 76-pixel cell shows about the first 28 characters
 * of that over two lines, so the very characters that told the two apart were the ones clipped off.
 * Counted on the owner's own packs at that width, 172 of 587 weapon cells and 192 of 915 clothes
 * cells read identically to a neighbour.
 *
 * So the mark is short by construction: what every id in the colliding set has in common is taken off
 * both ends, leaving the part that differs (a median of six characters), and anything still longer
 * than `markChars` loses its middle. And the set is keyed on the name **as clipped**, not on the
 * whole name, which catches the other half of the same fault, the one appending an id would never
 * have helped: nearly two hundred cells whose names are genuinely different but only past the clip
 * ("Battle Worn Imperial Scout Trooper Armor Left Bicep" and "... Right Bracer"). Over the weapons
 * and the four wardrobe folders as they open, 1,187 of 3,507 cells earn a mark and **none** then
 * reads the same as a neighbour, with both filter switches either way; a node test re-counts it on
 * cells built to the same shapes.
 *
 * It is done before the find box filters, so a mark does not appear and vanish as the box is typed
 * in: what a cell is called does not depend on what else the search left.
 */
function markCells(all: readonly GiveCell[]): void {
  const byKey = new Map<string, GiveCell[]>();
  for (const c of all) {
    const key = c.name.slice(0, GIVE_TUNE.nameChars);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(c);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const ids = list.map((c) => c.id);
    const head = commonHead(ids);
    const tail = commonTail(ids, head);
    for (const c of list) c.mark = elide(c.id.slice(head, c.id.length - tail) || c.id.slice(head) || c.id, GIVE_TUNE.markChars);
  }
}

/** A cell's whole name for a heading or a tooltip, where there is room for the mark on the line. */
export function fullLabel(c: GiveCell): string {
  return c.mark ? `${c.label} (${c.mark})` : c.label;
}

/** What a panel puts on a cell of its own beyond the shared markup. */
export interface CellLook {
  /** The class a cell wears when it is on the body or in a hand (`worn`, `held`). */
  on: string;
  /** Any other class this panel gives it (`block`, `give-listing`). */
  more?: string;
  /** Markup in the picture's corner after the tag: the weapons' left-hand button. */
  corner?: string;
  selected: boolean;
}

/**
 * One picture cell, the backpack's own markup so the three inventory lists read alike, with one line
 * more: the id's own part, where the name alone would not tell this cell from its neighbour.
 *
 * It lives here rather than in either panel so that both draw exactly the same cell and a node test
 * can read the markup itself instead of the file it is written in. It builds a string; it touches no
 * document.
 */
export function giveCellHtml(c: GiveCell, look: CellLook): string {
  const cls = ['bp-cell', c.on ? look.on : '', look.more ?? '', c.unseen ? 'hide' : '', c.mark ? 'marked' : '', look.selected ? 'sel' : ''].filter(Boolean).join(' ');
  const pic = c.picture === 'icon' && c.icon ? `<img src="${escapeHtml(c.icon)}" loading="lazy" decoding="async" alt="">` : `<span class="bp-initials">${escapeHtml(c.initials)}</span>`;
  const tag = c.unseen ? '<span class="give-tag">unseen</span>' : c.other ? '<span class="give-tag">other</span>' : '';
  const label = c.tag ? `<small>${escapeHtml(c.tag)}</small><br>${escapeHtml(c.label)}` : escapeHtml(c.label);
  const mark = c.mark ? `<span class="give-id">${escapeHtml(c.mark)}</span>` : '';
  return `<div class="${cls}" role="button" tabindex="0" data-id="${escapeHtml(c.id)}" data-initials="${escapeHtml(c.initials)}" title="${escapeHtml(c.title)}"><span class="bp-pic">${pic}${tag}${look.corner ?? ''}</span><span class="bp-name">${label}</span>${mark}</div>`;
}

/**
 * The part both screens share: the group order, the mark a cell earns, the sort, the find and the
 * counts. The game gives many items one name ("Plain Shirt" twice, "Helmet" seven times) and many
 * more names that are the same for longer than a cell can print, which is the whole reason a picture
 * alone would not be enough.
 */
function finish(byGroup: Map<string, GiveCell[]>, order: readonly { id: string; label: string }[], find: string, listed: number): GiveView {
  const groups: GiveGroup[] = [];
  let shown = 0;
  let noPicture = 0;
  let unseen = 0;
  let marked = 0;
  const pictures = new Set<string>();
  for (const def of order) {
    const all = byGroup.get(def.id);
    if (!all?.length) continue;
    markCells(all);
    all.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const cells = find ? all.filter((c) => c.label.toLowerCase().includes(find) || c.id.toLowerCase().includes(find)) : all;
    if (!cells.length) continue;
    for (const c of cells) {
      shown++;
      if (c.mark) marked++;
      if (c.picture === 'icon') pictures.add(c.icon ?? '');
      else {
        noPicture++;
        // The count line is about pictures, so this is the cells with none *because* there is
        // nothing of them to draw; the cell's own `unseen` also covers a `:hide` row that has one.
        if (c.picture === 'unseen') unseen++;
      }
    }
    groups.push({ id: def.id, label: def.label, wearing: all.filter((c) => c.on).map(fullLabel), cells });
  }
  return { groups, listed, shown, noPicture, unseen, marked, pictures: pictures.size };
}

/**
 * Which groups open on their own: the ones holding something worn or held, every group when the find
 * box has text (a search shows its hits), and the first group when nothing at all is on the body, so
 * the panel never opens with every group shut and nothing to look at.
 *
 * With a budget over the lot. A dressed human wears one piece in each of thirteen slot groups, so
 * "open what holds something worn" opened all thirteen and the first paint was 856 cells -- the
 * paging thrown away by the rule that decides what is open. Groups open down the body until
 * `openCells` is spent (each one costing what it would really draw, a page at most), and the rest
 * stay folded with their headings still saying what is worn in them, which is the thing worth
 * knowing. A search is not budgeted: its groups are the answer and are already narrow.
 */
export function openGroups(view: GiveView, find: string): Set<string> {
  const open = new Set<string>();
  if (find) {
    for (const g of view.groups) open.add(g.id);
    return open;
  }
  let cells = 0;
  for (const g of view.groups) {
    if (!g.wearing.length) continue;
    const cost = Math.min(g.cells.length, GIVE_TUNE.page);
    if (open.size && cells + cost > GIVE_TUNE.openCells) break;
    open.add(g.id);
    cells += cost;
  }
  if (!open.size && view.groups.length) open.add(view.groups[0].id);
  return open;
}

/** The count line's left-hand half: what is listed, what was left out and how many have no picture. */
export function countLine(view: WardrobeView): string {
  const parts = [
    view.shown === view.listed ? `${view.listed} items` : `${view.shown} of ${view.listed} items`,
    view.hidden ? `${view.hidden} of the other gender's hidden` : '',
    view.blocked ? `${view.blocked} this species cannot wear hidden` : '',
    view.unseen ? `${view.unseen} worn unseen, with nothing to draw` : '',
    view.noPicture - view.unseen ? `${view.noPicture - view.unseen} with no picture` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
