// The world editor's hand on what the world places (Map-maker II's twelfth wave, Map-maker I §2.9 and §2.10 as built here):
// the World's own filter (a click picks one of the world's own objects instead of a row of ours), and on what it picked
// Hide (with or without the ground its building's own layer flattened), Move (hidden, and a row of ours of the same model and
// template written at its place, its contents with it, the row picked for the gizmo), Copy as row, and the owner's
// walk-through switch on one thing, on this world's every copy of its model, or on every world's (his amendment of
// 2026-10-31), its own client extent beside it; the people (taken away by key and given back, his own placed at the aim from
// the People source, copied as cast text), the wildlife's sites (taken away and given back), and the seats of ours made
// permanent. Every change is one write and one undo entry through the editing's batch (`putRows`); the game lands each by
// difference (`World.landRemovals`, `landPeople`, `App.reloadSolid`). What this module draws is the window's sections.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import type { PlacedObject } from '../world/layoutStream.ts';
import type { RemovalRow } from '../story/removals.ts';
import { castSnippet, mintPersonId, readPersonRow, type PlacedPersonRow } from '../story/placedPeople.ts';
import { hideChange, personChange, siteChange, solidChange, unhideChange, type RemovalChange } from '../world/removalEdits.ts';
import type { EditorEdits } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { EditRow } from '../world/placementEdits.ts';
import type { EditorSection } from '../ui/editorWindow.ts';

/**
 * A placed person's defaults (ours, the numbers of feel the owner moves): standing still at their post, never fought (part of
 * the furniture), five minutes before one killed stands again (the data's own common wait), and how far they step about.
 * Live through `__debug.editor({ tune: { person } })` and the debug menu's `editor` sliders.
 */
export const PLACED_PERSON_TUNE = { still: 1, peaceful: 1, respawn: 300, roam: 0 };

/** How many of this world's NULL-extent models the Here tab lists (the most copies first): a page's length, not a feel. */
const NULL_LIST_MOST = 60;

/** What the hand needs of the editor and the game. */
export interface RemovalsHost {
  readonly edits: EditorEdits;
  worldKind(): 'ground' | 'space' | 'copies';
  /** The world's pack id (the files' name). */
  world(): string;
  /** The removal file's rows in force, and the people file's. */
  rows(): readonly RemovalRow[];
  people(): readonly PlacedPersonRow[];
  /** The shared walk-through file's rows in force (`solid.json`), by template. */
  solidRows(): ReadonlyMap<string, boolean>;
  /** A world object's content key (`o:<template>@x,y,z[#n]`, or a piece's own key); '' for none. */
  keyOf(o: PlacedObject): string;
  /** Its own client extent in words (NULL, cylinder, box, mesh), where the packs carry it. */
  extentWords(o: PlacedObject): string;
  /** What collides it now, in words (`collidesByRule`'s answer and where it came from). */
  ruleWords(o: PlacedObject): string;
  /** A world row standing it (and its contents) at its place, the row first, or why not. */
  rowsFromObject(o: PlacedObject, ids: (bases: readonly string[]) => string[]): { file: 'world'; rows: Record<string, unknown>[] } | string;
  /** The rows standing near the camera, for the Here tab's lists, in words. */
  peopleNear(): { key: string; words: string; removed: boolean }[];
  sitesNear(): { key: string; words: string; removed: boolean }[];
  hiddenNear(): { id: string; words: string }[];
  nullNear(): { key: string; template: string; words: string }[];
  /** Every template of this world whose own client extent is NULL, with how many copies stand, the most first. */
  nullTemplates(): readonly { template: string; count: number }[];
  seatsNear(): { key: string; words: string }[];
  /** A seat of ours as the permanent row standing for it (its solidity absent, its furniture word written), or why not. */
  seatRow(key: string): Record<string, unknown> | string;
  /** The placements file a row goes into (the editor's destination: `world` or `story`). */
  dest(): 'world' | 'story';
  /** Where the aim meets the world, the game's frame, and whether it met anything. */
  aim(): { x: number; y: number; z: number; valid: boolean };
  /** A point of the game's frame in the file's raw frame (null where the world has no frame for its rows). */
  rawOf(x: number, z: number): { x: number; z: number } | null;
  /** The room (cell) a point of the game's frame stands in, or 0. */
  roomAt(x: number, y: number, z: number): number;
  /** The eye's facing as a heading of the raw frame, degrees. */
  headingRaw(): number;
  /** Rows of the placements files picked (the editing's selection), after a write landed. */
  select(ids: string[]): void;
  /** The walk grid's word for this world's files (stale until `navgrid` is run again), '' for none. */
  gridNote(): string;
  say(words: string, ok: boolean): void;
}

/** The editor's hand on the world's own. */
export class EditorRemovals {
  /** The World's own filter: a click picks the world's own objects (and nothing of ours under them). */
  worldFilter = false;
  /** The world object picked, or null. */
  picked: PlacedObject | null = null;
  /** A person in hand (the People source's), placed at the aim by the next click. */
  personHand: { body: string; name: string } | null = null;
  /** What the last action came to. */
  last = '';
  private readonly host: RemovalsHost;
  private writing = false;

  constructor(host: RemovalsHost) {
    this.host = host;
  }

  /** The world went: nothing of it picked or in hand. */
  worldGone(): void {
    this.picked = null;
    this.personHand = null;
  }

  /** The picked world thing's content key, or null. */
  pickedKey(): string | null {
    return this.picked ? this.host.keyOf(this.picked) || null : null;
  }

  /** One of the world's own picked (a click with the World's own filter on), or let go. */
  pick(o: PlacedObject | null): void {
    this.picked = o;
    if (o) this.say(`picked the world's own ${o.template} (${this.host.keyOf(o) || 'no key'}): the Selected tab hides it, moves it, copies it or switches whether it is solid`, true);
  }

  private say(words: string, ok: boolean): string {
    this.last = words;
    this.host.say(words, ok);
    return words;
  }

  /** Changes of the removal file as the editing's row changes. */
  private changesOf(list: (RemovalChange | string)[], file: 'removed' = 'removed'): RowChange[] | string {
    const out: RowChange[] = [];
    for (const c of list) {
      if (typeof c === 'string') return c;
      out.push({ file, id: c.id, before: c.before as EditRow | null, after: c.after as EditRow | null });
    }
    return out;
  }

  /** One write and one undo entry of the changes given; answers what was said. */
  private async commit(label: string, changes: RowChange[] | string): Promise<string> {
    if (typeof changes === 'string') return this.say(changes, false);
    if (!changes.length) return this.say('nothing to write', false);
    if (this.writing) return this.say('a write is under way', false);
    this.writing = true;
    try {
      const said = await this.host.edits.putRows(label, changes);
      return this.say(said || label, !/under way|nothing|refus|not /i.test(said));
    } finally {
      this.writing = false;
    }
  }

  /** Why the world refuses a write of the removal file in words, or null. */
  private refusal(): string | null {
    if (this.host.worldKind() === 'space') return "a space zone's removals are a later pass (space maps)";
    return null;
  }

  /** The picked world thing hidden for everyone (`ground` its building's flattened ground with it, from the next arrival). */
  async hide(ground = false, key: string | null = this.pickedKey()): Promise<string> {
    const no = this.refusal();
    if (no) return this.say(no, false);
    if (!key) return this.say("nothing of the world's own is picked: the World's own filter, then a click on it", false);
    const said = await this.commit(`hide ${key}`, this.changesOf([hideChange(this.host.rows(), key, ground)]));
    return said;
  }

  /** A hidden thing shown again. */
  async unhide(key: string): Promise<string> {
    return this.commit(`show ${key} again`, this.changesOf([unhideChange(this.host.rows(), key)]));
  }

  /**
   * The picked world thing moved: hidden, and a row of ours of its model and template (and its contents as rows inside it)
   * written at its place in the same write, the row picked for the gizmo. `copy` writes the rows alone (Copy as row).
   */
  async move(copy = false): Promise<string> {
    const no = this.refusal();
    if (no) return this.say(no, false);
    const o = this.picked;
    const key = this.pickedKey();
    if (!o || !key) return this.say("nothing of the world's own is picked", false);
    const made = this.host.rowsFromObject(o, (bases) => this.host.edits.mintIds(bases));
    if (typeof made === 'string') return this.say(made, false);
    const changes: RowChange[] = made.rows.map((r) => ({ file: made.file, id: String(r.id), before: null, after: r as unknown as EditRow }));
    if (!copy) {
      const hide = this.changesOf([hideChange(this.host.rows(), key, false)]);
      if (typeof hide === 'string') return this.say(hide, false);
      changes.unshift(...hide);
    }
    const said = await this.commit(copy ? `copy ${key} as a row` : `move ${key}`, changes);
    if (!/under way|nothing|refus|not /i.test(said)) {
      this.host.select([String(made.rows[0].id)]);
      if (!copy) this.picked = null;
    }
    return said;
  }

  /**
   * The owner's walk-through switch (his amendment of 2026-10-31) on the picked thing (`thing`), on this world's every copy of
   * its model (`world`) or on every world's (`everywhere`, the shared `solid.json`): solid, walked through, or null to take
   * the switch off. The narrowest row wins (the thing, this world's model, every world's).
   */
  async setSolid(scope: 'thing' | 'world' | 'everywhere', solid: boolean | null, template: string | null = null): Promise<string> {
    const no = this.refusal();
    if (no) return this.say(no, false);
    const o = this.picked;
    const t = template ?? (o ? (o.effectsOf ?? o.template) : null);
    if (scope === 'thing') {
      const key = this.pickedKey();
      if (!key) return this.say("nothing of the world's own is picked", false);
      return this.commit(`${key} ${solid === null ? 'by its rules' : solid ? 'solid' : 'walked through'}`, this.changesOf([solidChange(this.host.rows(), key, solid)]));
    }
    if (!t || !t.startsWith('object/')) return this.say('no template to switch', false);
    if (scope === 'world') return this.commit(`${t} on ${this.host.world()} ${solid === null ? 'by the shared file' : solid ? 'solid' : 'walked through'}`, this.changesOf([solidChange(this.host.rows(), `t:${t}`, solid)]));
    const rows = this.host.solidRows();
    const had = rows.has(t) ? { id: t, solid: rows.get(t)! } : null;
    if (solid === null && !had) return this.say(`${t} has no row in the shared file`, false);
    const after = solid === null ? null : { id: t, solid };
    if (had && after && had.solid === after.solid) return this.say(`${t} is ${solid ? 'solid' : 'walked through'} everywhere already`, true);
    return this.commit(`${t} everywhere ${solid === null ? 'by its size' : solid ? 'solid' : 'walked through'}`, [{ file: 'solid', id: t, before: had as EditRow | null, after: after as EditRow | null }]);
  }

  /** One of the people taken away by key (or given back). */
  async person(key: string, restore = false): Promise<string> {
    const no = this.refusal();
    if (no) return this.say(no, false);
    return this.commit(`${restore ? 'give back' : 'take away'} ${key}`, this.changesOf([personChange(this.host.rows(), key, restore)]));
  }

  /** One of the wildlife's sites taken away by key (or given back). */
  async site(key: string, restore = false): Promise<string> {
    const no = this.refusal();
    if (no) return this.say(no, false);
    return this.commit(`${restore ? 'give back' : 'take away'} site ${key}`, this.changesOf([siteChange(this.host.rows(), key, restore)]));
  }

  /** A person of the People source in hand: the next click places them at the aim. */
  takePerson(body: string, name: string): string {
    if (this.host.worldKind() !== 'ground') return this.say("people of the owner's own stand on a world on the ground this pass", false);
    this.personHand = { body, name };
    return this.say(`${name} in hand: a click places them where the aim meets the ground (Escape gives them up)`, true);
  }

  /**
   * A person of the owner's own written at the aim (or at `at`, the game's frame): its body, its mood, its heading the eye's
   * in the raw frame, its room where it stands in one, the defaults of `PLACED_PERSON_TUNE` for the rest. One write.
   */
  async placePerson(body: string, mood: string | null = null, at: { x: number; y: number; z: number } | null = null, name: string | null = null): Promise<string> {
    if (this.host.worldKind() !== 'ground') return this.say("people of the owner's own stand on a world on the ground this pass", false);
    const a = at ?? this.host.aim();
    if (!at && !(a as { valid?: boolean }).valid) return this.say('the aim meets nothing to stand a person on', false);
    const raw = this.host.rawOf(a.x, a.z);
    if (!raw) return this.say('this world has no frame for its rows', false);
    const taken = new Set(this.host.people().map((r) => r.id));
    const id = mintPersonId(name ?? body, taken);
    const t = PLACED_PERSON_TUNE;
    const room = this.host.roomAt(a.x, a.y, a.z);
    const draft: Record<string, unknown> = { id, body, x: round(raw.x), y: round(a.y), z: round(raw.z), heading: round(((this.host.headingRaw() % 360) + 360) % 360) };
    if (room > 0) draft.room = room;
    if (mood) draft.mood = mood;
    if (t.still) draft.still = true;
    if (t.peaceful) draft.peaceful = true;
    if (t.respawn !== 300) draft.respawn = Math.max(0, Math.round(t.respawn));
    if (t.roam > 0) draft.roam = t.roam;
    if (name) draft.name = name;
    const row = readPersonRow(draft);
    if (typeof row === 'string') return this.say(`the person: ${row}`, false);
    return this.commit(`place ${name ?? body}`, [{ file: 'people', id, before: null, after: row as unknown as EditRow }]);
  }

  /** A person of the owner's own taken out of the people file. */
  async removePlaced(id: string): Promise<string> {
    const before = this.host.people().find((r) => r.id === id) ?? null;
    if (!before) return this.say(`no person ${id} in this world's people file`, false);
    return this.commit(`take out ${id}`, [{ file: 'people', id, before: before as unknown as EditRow, after: null }]);
  }

  /**
   * **Make permanent** on a seat of ours (Map-maker I §2.10 item 3): one write of a row at that seat's exact place and turn
   * with its chair (or table), its solidity left absent (passable: the person sat on it would be pushed off a collider) and its
   * furniture word written, into the editor's destination file; the next plan of the seats finds it and stands none of ours.
   */
  async makeSeatPermanent(key: string): Promise<string> {
    if (this.host.worldKind() !== 'ground') return this.say('the seats of ours stand on a world on the ground', false);
    const row = this.host.seatRow(key);
    if (typeof row === 'string') return this.say(row, false);
    const file = this.host.dest();
    return this.commit(`make the seat ${key} permanent`, [{ file, id: String(row.id), before: null, after: row as unknown as EditRow }]);
  }

  /** A placed person as cast text to paste into a story's cast file (the nearest to the camera with none named). */
  cast(id: string | null): string {
    const people = this.host.people();
    const row = id ? people.find((r) => r.id === id) : people[0];
    if (!row) return this.say('no person of the owner\'s own on this world', false);
    return castSnippet(row, this.host.world());
  }

  /** The window's sections for a tab. */
  sections(tab: 'selected' | 'here' | 'tools'): EditorSection[] {
    const h = this.host;
    const out: EditorSection[] = [];
    if (tab === 'tools') {
      out.push({
        title: "The world's own",
        note: this.worldFilter ? "A click picks one of the world's own objects (the Selected tab hides, moves, copies or switches it)." : 'Off: a click picks the rows of the files alone.',
        buttons: [{ label: this.worldFilter ? "World's own filter: on" : "World's own filter: off", act: 'filter' }],
      });
      const grid = h.gridNote();
      if (grid) out.push({ title: 'The walk grid', note: grid });
      return out;
    }
    if (tab === 'selected') {
      const o = this.picked;
      if (o) {
        const key = h.keyOf(o);
        const t = o.effectsOf ?? o.template;
        const row = h.rows().find((r) => r.id === key);
        const worldRow = h.rows().find((r) => r.id === `t:${t}`);
        const shared = h.solidRows();
        out.push({
          title: "The world's own thing",
          note: `${t}${o.contained ? ' (in a room)' : ''}`,
          fields: [
            { label: 'Its key', value: key || 'none', act: null },
            { label: 'Its extent', value: h.extentWords(o), act: null },
            { label: 'Collides now', value: h.ruleWords(o), act: null },
          ],
          rows: [
            { words: row?.hide ? 'Hidden for everyone' : 'Stands', buttons: row?.hide ? [{ label: 'Show again', act: `unhide:${key}` }] : [{ label: 'Hide', act: 'hide' }, { label: 'Hide with its ground', act: 'hideGround' }] },
            { words: 'Move or copy', buttons: [{ label: 'Move', act: 'move' }, { label: 'Copy as row', act: 'copy' }] },
            { words: `This thing: ${row?.solid === undefined ? 'its rules' : row.solid ? 'solid' : 'walked through'}`, buttons: [{ label: 'Solid', act: 'solid:thing:1' }, { label: 'Walk through', act: 'solid:thing:0' }, { label: 'Its rules', act: 'solid:thing:-' }] },
            { words: `This world's model: ${worldRow?.solid === undefined ? 'the shared file' : worldRow.solid ? 'solid' : 'walked through'}`, buttons: [{ label: 'Solid', act: 'solid:world:1' }, { label: 'Walk through', act: 'solid:world:0' }, { label: 'Off', act: 'solid:world:-' }] },
            { words: `Every world: ${shared.has(t) ? (shared.get(t) ? 'solid' : 'walked through') : 'its size'}`, buttons: [{ label: 'Solid', act: 'solid:everywhere:1' }, { label: 'Walk through', act: 'solid:everywhere:0' }, { label: 'Off', act: 'solid:everywhere:-' }] },
          ],
          buttons: [{ label: 'Let go', act: 'letgo' }],
        });
      }
      if (this.personHand) out.push({ title: 'A person in hand', note: `${this.personHand.name}: a click places them at the aim; Escape gives them up.`, buttons: [{ label: 'Give up', act: 'personDrop' }] });
      return out;
    }
    // Here: what is taken away round the camera, the people and the sites, the owner's placed people, the seats of ours, and
    // what the client walked through.
    const hidden = h.hiddenNear();
    if (hidden.length) out.push({ title: 'Hidden here', rows: hidden.map((x) => ({ words: x.words, title: x.id, buttons: [{ label: 'Show again', act: `unhide:${x.id}` }] })) });
    const people = h.peopleNear();
    if (people.length) out.push({ title: 'People here', rows: people.map((p) => ({ words: p.words, title: p.key, buttons: p.removed ? [{ label: 'Give back', act: `personBack:${p.key}` }] : [{ label: 'Take away', act: `person:${p.key}`, danger: true }] })) });
    const placed = h.people();
    if (placed.length) out.push({ title: "His own people on this world", rows: placed.slice(0, 40).map((p) => ({ words: `${p.name ?? p.id} (${p.body})`, title: p.id, buttons: [{ label: 'Copy as cast', act: `cast:${p.id}` }, { label: 'Delete', act: `unplace:${p.id}`, danger: true }] })) });
    const sites = h.sitesNear();
    if (sites.length) out.push({ title: 'Wildlife sites here', rows: sites.map((s) => ({ words: s.words, title: s.key, buttons: s.removed ? [{ label: 'Give back', act: `siteBack:${s.key}` }] : [{ label: 'Take away', act: `site:${s.key}`, danger: true }] })) });
    const seats = h.seatsNear();
    if (seats.length) out.push({ title: 'Seats of ours here', rows: seats.map((s) => ({ words: s.words, title: s.key, buttons: [{ label: 'Make permanent', act: `seat:${s.key}` }] })) });
    const nulls = h.nullNear();
    if (nulls.length) out.push({ title: 'The client walked through (NULL extent)', note: 'Flora whose own collision the client left out; solid here only where a switch or its size says so.', rows: nulls.map((x) => ({ words: x.words, title: x.key, buttons: [] })) });
    // This world's whole list by model (the owner's amendment: a world's, not only what stands near), the most copies first,
    // each switchable for this world or every world without first finding one to pick.
    const models = h.nullTemplates();
    if (models.length) {
      const shared = h.solidRows();
      const rows = h.rows();
      out.push({
        title: "This world's models the client walked through",
        note: `${models.length} model${models.length === 1 ? '' : 's'} with a NULL extent, ${models.reduce((n, m) => n + m.count, 0)} copies${models.length > NULL_LIST_MOST ? ` (the ${NULL_LIST_MOST} with the most copies listed)` : ''}.`,
        rows: models.slice(0, NULL_LIST_MOST).map((m) => {
          const here = rows.find((r) => r.id === `t:${m.template}`)?.solid;
          const every = shared.get(m.template);
          const now = here !== undefined ? (here ? 'solid here' : 'walked through here') : every !== undefined ? (every ? 'solid everywhere' : 'walked through everywhere') : 'by its size';
          return { words: `${m.template.split('/').pop()} x${m.count} (${now})`, title: m.template, buttons: [{ label: 'Walk through here', act: `solidT:world:0:${m.template}` }, { label: 'Everywhere', act: `solidT:everywhere:0:${m.template}` }] };
        }),
      });
    }
    return out;
  }

  /** A button or a field of a section. */
  async act(a: string, _value?: string): Promise<string> {
    if (a === 'filter') {
      this.worldFilter = !this.worldFilter;
      if (!this.worldFilter) this.picked = null;
      return this.say(this.worldFilter ? "the World's own filter is on: a click picks the world's own objects" : "the World's own filter is off", true);
    }
    if (a === 'letgo') {
      this.picked = null;
      return '';
    }
    if (a === 'personDrop') {
      this.personHand = null;
      return '';
    }
    if (a === 'hide') return this.hide(false);
    if (a === 'hideGround') return this.hide(true);
    if (a === 'move') return this.move(false);
    if (a === 'copy') return this.move(true);
    const [verb, ...rest] = a.split(':');
    const arg = rest.join(':');
    if (verb === 'unhide') return this.unhide(arg);
    if (verb === 'solid') {
      const [scope, v] = rest;
      return this.setSolid(scope as 'thing' | 'world' | 'everywhere', v === '1' ? true : v === '0' ? false : null);
    }
    // A model of the Here tab's whole-world list switched by its template, with nothing picked.
    if (verb === 'solidT') {
      const [scope, v, ...t] = rest;
      if (scope !== 'world' && scope !== 'everywhere') return '';
      return this.setSolid(scope, v === '1' ? true : v === '0' ? false : null, t.join(':'));
    }
    if (verb === 'person') return this.person(arg, false);
    if (verb === 'personBack') return this.person(arg, true);
    if (verb === 'site') return this.site(arg, false);
    if (verb === 'siteBack') return this.site(arg, true);
    if (verb === 'unplace') return this.removePlaced(arg);
    if (verb === 'seat') return this.makeSeatPermanent(arg);
    if (verb === 'cast') {
      const text = this.cast(arg);
      try {
        await navigator.clipboard?.writeText(text);
        return this.say(`${arg} copied as cast text`, true);
      } catch {
        console.info(text);
        return this.say(`${arg} as cast text is on the console (the clipboard refused)`, false);
      }
    }
    return '';
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { filter: this.worldFilter, picked: this.picked ? { template: this.picked.template, key: this.pickedKey() } : null, personHand: this.personHand, last: this.last, person: { ...PLACED_PERSON_TUNE } };
  }
}

/** A number to a millimetre, as the files keep places. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
