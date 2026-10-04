// The equipment: what the player's character owns, wears and holds, and the one way anything goes
// on or in hand in play. The backpack's double-click, the give tabs (the old wardrobe and weapons
// panels, now developer tools) and the console all come here, so the slot rules, the saving and the
// compile-before-show order are in one place.
//
// Every piece goes on the same way: loaded hidden (Character.loadPiece), the colour recipes settled
// (a recipe can give a material a normal map, a new program), each new mesh prepared (World.prepareActor
// through `deps.prepare`), and only then shown by Character.putOn, which takes off what it displaces
// in the same synchronous step. A weapon's model is prepared on every hold: a program is compiled for
// the target and scene of that moment, and the Effects setting or a travel changes both.
//
// Node-loadable for the tests: type-only imports apart from the rules and the item facts.
import type * as THREE from 'three';
import type { ClassId } from '../combat/kit';
import type { SavedCharacter } from '../core/characters';
import { ITEMS_MOST, chooseArrangement, collapseOwned, isHairKey, mintThing, normalizeOwned, occupancy, pairOwned, partToItemId, planHold, pruneThings, resolveKit, slotGroupOf, speciesWords, migrateInventory, wornThingOf, type Fit, type Hand, type HeldRef, type ListedItem, type OwnedItem } from '../core/inventory.ts';
import { itemInfo, wardrobeIndex, type ItemContext } from './items.ts';
import type { Character } from './character';
import type { Player } from './player';
import type { WeaponCatalogue, WeaponDef } from './weapons';

export interface EquipmentDeps {
  /** The player's parts character (null: the placeholder or a single model). */
  character(): Character | null;
  player: Player;
  weaponsLoaded(): Promise<WeaponCatalogue | null>;
  /** World.prepareActor, then the motion blur's prepareRoots: compiled before anything is shown. Resolves at once outside the world. */
  prepare(root: THREE.Object3D): Promise<void>;
  /** The record being played; null on the select screen and in the creator (nothing is given or saved there). */
  record(): SavedCharacter | null;
  /** Write the record (upsertCharacter). */
  persist(c: SavedCharacter): void;
  /** Something changed: what is owned, worn or held, or which items are being put on. */
  changed(what: 'owned' | 'worn' | 'held' | 'busy'): void;
  /**
   * A thing appeared in this character's list, or left it, on this browser's own say-so: the
   * starting kit, a give, something worn that was not owned, a destroy. The wiring hands it to the
   * server so that its rows and this cache do not drift. A trade never comes this way -- an item
   * between two players is moved by the server and arrives here as a whole list (`reconcile`) --
   * and with no server nothing is wired to it at all, which is why it is optional.
   */
  ledger?: (what: 'add' | 'drop', item: OwnedItem) => void;
  /**
   * Why a second of an item may not be given here, or '' when it may: the server holding this
   * character is one from before things had names, which would fold the second into the first.
   * Optional; with nothing wired a second may always be given.
   */
  refuseAnother?: () => string;
  baseUrl: string;
}

export interface EquipmentSnapshot {
  /** The record's items, newest last as given. */
  owned: OwnedItem[];
  /** Worn catalogue items: id -> the part it is worn under. */
  worn: Record<string, string>;
  held: { right: string | null; left: string | null };
  /** Which thing each worn item is (catalogue id to its name), where it is owned: two of one shirt, and the one on. */
  wornThing: Record<string, string>;
  /** Which thing is in each hand, where it is owned. */
  heldThing: { right: string | null; left: string | null };
  /** The record's own choices of which copy is worn and held, where it is not the oldest. */
  chosen: { worn: Record<string, string>; held: Record<string, string> };
  /** Keys (`wear:<id>`, `weapon:<id>`) being put on or taken up. */
  busy: string[];
  /** The record's migration mark; null with no record. */
  inv: 1 | null;
  /** Whether the record's items have been brought into named things (`collapseOwned`); null with no record. */
  named: 1 | null;
  /** The record played, by name; null on the select screen and in the creator. */
  record: string | null;
  species: string;
  /** Whether a wardrobe was found the last time the catalogues were read (null before). */
  wardrobe: boolean | null;
  weapons: boolean | null;
}

/** An answer that is only a note, and the kit a weapon wants (the caller switches class). */
export interface UseResult {
  note: string;
  wants: ClassId | null;
}

const DROPPED = 'dropped';

/** What a use or a wear of a hairstyle says: hair is chosen on the appearance page, never worn as an item. */
export const HAIR_ELSEWHERE = 'a hairstyle is chosen on the appearance page';

/** What a list from the server changed here, in words: "two things came in, one went". */
export function reconcileWords(came: number, gone: number): string {
  const things = (n: number) => (n === 1 ? 'one thing' : `${n} things`);
  if (came && gone) return `${things(came)} came in, ${things(gone)} went`;
  if (came) return `${things(came)} came in`;
  if (gone) return `${things(gone)} went`;
  return 'nothing in the backpack changed';
}

export class Equipment {
  private readonly deps: EquipmentDeps;
  /** The arrangement each worn catalogue item went on with, so a later piece displaces exactly what the game would. */
  private readonly slotsWorn = new Map<string, string[]>();
  /** Keys in flight, counted (two asks for one key while the first waits). */
  private readonly busy = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Bumped by reset(): an operation from before it ends 'dropped' after its next await. */
  private epoch = 0;
  private lastCtx: ItemContext | null = null;

  constructor(deps: EquipmentDeps) {
    this.deps = deps;
  }

  /** The catalogues as last read (null before the first operation). */
  get lastContext(): ItemContext | null {
    return this.lastCtx;
  }

  /** Empty both hands (blade off) and forget what is remembered about a character; saves nothing. */
  reset(): void {
    const p = this.deps.player;
    p.unequip('right');
    p.unequip('left');
    if (p.saberOn) p.toggleSaber();
    this.slotsWorn.clear();
    this.busy.clear();
    this.epoch++;
  }

  /**
   * The catalogues, read on every operation (Character.catalogue and the rack cache their results): a
   * missing wardrobe is none, and then clothes cannot be put on but weapons can.
   */
  async itemContext(): Promise<ItemContext> {
    const c = this.deps.character();
    let wardrobe: ItemContext['wardrobe'] = null;
    if (c) {
      try {
        wardrobe = await c.catalogue(this.deps.baseUrl);
      } catch {
        wardrobe = null;
      }
    }
    let weapons: WeaponCatalogue | null = null;
    try {
      weapons = await this.deps.weaponsLoaded();
    } catch {
      weapons = null;
    }
    const rec = this.deps.record();
    const ctx: ItemContext = { wardrobe, wardrobeDir: c?.wardrobeDir ?? null, weapons, species: c?.manifest.id ?? rec?.species ?? '', packParts: c?.packParts ?? [] };
    this.lastCtx = ctx;
    return ctx;
  }

  /** A worn part's catalogue id, by the catalogue last read; null for hair and pack parts with no item. */
  itemIdOf(part: string): string | null {
    if (isHairKey(part)) return null;
    const w = this.lastCtx?.wardrobe;
    if (!w) return null;
    const index = wardrobeIndex(w);
    return partToItemId(part, (id) => index.has(id));
  }

  /** What the kit's candidates are to this character: its species' verdict, or null when the catalogues lack it. */
  private look(ctx: ItemContext): (kind: 'wear' | 'weapon', id: string) => Fit | null {
    return (kind, id) => {
      if (kind === 'wear' && !ctx.wardrobe) return null;
      const info = itemInfo(kind, id, ctx);
      return info.missing ? null : info.fit;
    };
  }

  /**
   * Behind the loading screen in play(): reset, the catalogues read, and a record from before the
   * backpack given its items (what it wears and the kit) and saved. Never throws.
   */
  async load(c: SavedCharacter): Promise<void> {
    this.reset();
    const epoch = this.epoch;
    try {
      const ctx = await this.itemContext();
      if (epoch !== this.epoch) return;
      let changed = false;
      if (c.inv !== 1) {
        const now = Date.now();
        const kit = resolveKit(c.class, this.look(ctx), now);
        migrateInventory(c, kit.items, (part) => this.itemIdOf(part), now);
        changed = true;
      } else {
        // A row given a name here is saved with it, so the name a server is handed is the one the
        // record keeps: minted afresh on every load, it would change under the server each time.
        changed = (c.items ?? []).some((o) => !o?.thing);
        c.items = normalizeOwned(c.items);
      }
      // Once, before any server is handed the list: a second copy the creator once made is collapsed
      // to the one on the body, since a server that keeps two of one item would keep it for ever.
      if (c.named !== 1) {
        collapseOwned(c);
        changed = true;
      }
      if (changed) this.deps.persist(c);
    } catch (err) {
      console.warn(`inventory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** After a species switch in the world: reset, the new rig's worn pieces taken into items, saved, and the saved hands restored. */
  async resync(): Promise<void> {
    this.reset();
    const epoch = this.epoch;
    await this.itemContext();
    if (epoch !== this.epoch) return;
    for (const w of this.wornPieces()) this.addOwned('wear', w.id);
    this.save({ keepHands: true });
    this.deps.changed('worn');
    await this.restoreHeld();
  }

  /** The kit for a class, resolved against this character's catalogues (the creator uses it for a new record). */
  async kit(cls: ClassId): Promise<{ items: OwnedItem[]; held: { right?: string; left?: string } }> {
    const ctx = await this.itemContext();
    return resolveKit(cls, this.look(ctx), Date.now());
  }

  owned(): OwnedItem[] {
    return [...(this.deps.record()?.items ?? [])];
  }

  /** Into the record's items, unsaved; true when it is new. One of each: an item already owned is not given again. */
  private addOwned(kind: 'wear' | 'weapon', id: string): boolean {
    const rec = this.deps.record();
    if (!rec) return false;
    const items = (rec.items ??= []);
    if (items.some((o) => o.kind === kind && o.id === id)) return false;
    this.push(items, kind, id);
    return true;
  }

  /** A new thing of one item into the list, under a name of its own, and told to the ledger. */
  private push(items: OwnedItem[], kind: 'wear' | 'weapon', id: string): OwnedItem {
    const got = Date.now();
    let thing = mintThing(kind, id, got);
    // A name is unique in one character's list and nowhere else, so it is only ever checked there.
    while (items.some((o) => o.thing === thing)) thing = mintThing(kind, id, got);
    const row: OwnedItem = { id, kind, got, thing };
    items.push(row);
    this.deps.ledger?.('add', row);
    return row;
  }

  /**
   * Give an item: true when it is new (and saved); false, and nothing, when it is owned already or no
   * record is played. One of each, which is what the starting kit and a job's reward want; a second
   * copy is `giveAnother`.
   */
  give(kind: 'wear' | 'weapon', id: string): boolean {
    const rec = this.deps.record();
    if (!rec || !this.addOwned(kind, id)) return false;
    this.deps.persist(rec);
    this.deps.changed('owned');
    return true;
  }

  /**
   * Give another of an item, whether or not one is owned already: the developer's give tab and the
   * console. '' when it went in, else why not -- no character is being played, the character already
   * holds as many things as a server keeps for one (`ITEMS_MOST`, which past it would cut or refuse the
   * copy and take it away again at the next list), or the server holding this one folds two of one item
   * into one, which would quietly cost the second.
   */
  giveAnother(kind: 'wear' | 'weapon', id: string): string {
    const rec = this.deps.record();
    if (!rec) return 'no character is being played';
    if ((rec.items ?? []).length >= ITEMS_MOST) return `a character carries ${ITEMS_MOST} things`;
    const refused = this.deps.refuseAnother?.() ?? '';
    if (refused) return refused;
    this.push((rec.items ??= []), kind, id);
    this.deps.persist(rec);
    this.deps.changed('owned');
    return '';
  }

  /**
   * A thing the server wrote down on its own -- a job's reward, paid through its ledger -- into the
   * backpack under the name the server gave it, with nothing said back: the server is where it came
   * from. False when it is here already (this browser's own, answered) or no record is played. A row
   * from a server before things had names names none, and is given one here.
   *
   * It waits its turn in the queue like everything else that writes the items. The server sends the list
   * and then the reward it owed, and the list's `reconcile` may still be waiting behind a piece going on:
   * written at once, the reward was in the backpack before that older list was laid over it, which read it
   * as gone and took it out while the server held it. Here already means the same thing by its name and
   * what it is, as a list is paired (`pairOwned`); a name another of this character's things goes under,
   * which nothing honest sends, is not taken over, and the next list pairs this one by what it is.
   */
  receive(item: ListedItem): Promise<boolean> {
    return this.run('receive', false, async () => {
      const rec = this.deps.record();
      if (!rec) return false;
      const items = (rec.items ??= []);
      const same = (o: OwnedItem) => o.kind === item.kind && o.id === item.id && (!item.thing || o.thing === item.thing);
      if (items.some(same)) return false;
      const got = item.got || Date.now();
      const thing = item.thing && !items.some((o) => o.thing === item.thing) ? item.thing : mintThing(item.kind, item.id, got);
      const row: OwnedItem = { id: item.id, kind: item.kind, got, thing };
      if (item.tint) row.tint = { ...item.tint };
      if (item.tint !== undefined && item.tintAt) row.tintAt = item.tintAt;
      items.push(row);
      this.deps.persist(rec);
      this.deps.changed('owned');
      return true;
    });
  }

  /**
   * The character's worn pieces that are catalogue items (not the body, not hair, not a pack part with
   * no item), each with the arrangement it went on with: remembered, else replayed in wear order.
   */
  private wornPieces(): { id: string; part: string; slots: string[] }[] {
    const c = this.deps.character();
    const ctx = this.lastCtx;
    if (!c || !ctx?.wardrobe) return [];
    const index = wardrobeIndex(ctx.wardrobe);
    const out: { id: string; part: string; slots: string[] }[] = [];
    for (const p of c.status()) {
      if (!p.worn || p.body || isHairKey(p.name)) continue;
      const id = partToItemId(p.name, (x) => index.has(x));
      if (!id || out.some((w) => w.id === id)) continue;
      let slots = this.slotsWorn.get(id);
      if (!slots) {
        slots = chooseArrangement(index.get(id)?.slots ?? null, occupancy(out), id).slots;
        this.slotsWorn.set(id, slots);
      }
      out.push({ id, part: p.name, slots });
    }
    return out;
  }

  /** The part a worn catalogue item is worn under (its id, or its pack part), or null when it is not worn. */
  private wornPartOf(id: string): string | null {
    const c = this.deps.character();
    if (!c) return null;
    const worn = new Set(c.status().filter((p) => p.worn && !p.body).map((p) => p.name));
    if (worn.has(id)) return id;
    const pack = c.packPartOf(id);
    return pack && worn.has(pack) ? pack : null;
  }

  /** An item's name as the game gives it, from the catalogues last read. */
  private nameOf(kind: 'wear' | 'weapon', id: string): string {
    return this.lastCtx ? itemInfo(kind, id, this.lastCtx).name : id;
  }

  /**
   * The record's items, every one with a name. A record is read in through `load`, which names them, so
   * this only ever names a row put in by hand since (the console, a test) -- and names it once, in place.
   */
  private namedItems(rec: SavedCharacter): OwnedItem[] {
    if ((rec.items ?? []).some((o) => !o?.thing)) rec.items = normalizeOwned(rec.items);
    return rec.items ?? [];
  }

  /** One owned thing by its name, or null. */
  itemOf(thing: string): OwnedItem | null {
    const rec = this.deps.record();
    if (!thing || !rec) return null;
    return this.namedItems(rec).find((o) => o.thing === thing) ?? null;
  }

  /**
   * Which owned copy of an item is the one worn (a wardrobe item) or held (a weapon): the record's own
   * choice while it stands, else the oldest. Null when none is owned. It says nothing about whether
   * the item is on the body at all; that is the body's to say.
   */
  thingInUse(kind: 'wear' | 'weapon', id: string): string | null {
    const rec = this.deps.record();
    if (!rec) return null;
    return wornThingOf(this.namedItems(rec), kind, id, kind === 'wear' ? rec.wornThings : rec.heldThings);
  }

  /** Make one owned copy the one worn or held, unsaved: written down only where it is not the oldest. */
  private choose(kind: 'wear' | 'weapon', id: string, thing: string): void {
    const rec = this.deps.record();
    const it = this.itemOf(thing);
    if (!rec || !it || it.kind !== kind || it.id !== id) return;
    const key = kind === 'wear' ? 'wornThings' : 'heldThings';
    const map: Record<string, string> = { ...(rec[key] ?? {}) };
    if (wornThingOf(this.namedItems(rec), kind, id, null) === thing) delete map[id];
    else map[id] = thing;
    if (Object.keys(map).length) rec[key] = map;
    else delete rec[key];
  }

  /**
   * The other of two identical things becomes the one worn or held: nothing comes off and nothing is
   * loaded -- the mesh is the item's and the same for both -- and the record says which copy it is.
   */
  private switchTo(kind: 'wear' | 'weapon', id: string, thing: string): string {
    this.choose(kind, id, thing);
    this.save();
    this.deps.changed(kind === 'wear' ? 'worn' : 'held');
    return `${this.nameOf(kind, id)}: ${kind === 'wear' ? 'wearing' : 'holding'} this one now`;
  }

  /** Whether `thing` is owned, is a copy of this item, and is not the copy in use now: the other of two. */
  private isOtherCopy(kind: 'wear' | 'weapon', id: string, thing: string | undefined): thing is string {
    if (!thing) return false;
    const it = this.itemOf(thing);
    return !!it && it.kind === kind && it.id === id && this.thingInUse(kind, id) !== thing;
  }

  /**
   * Run one operation after every earlier one, tied to the character and epoch it was asked for: a
   * reset or a character change while it waits ends it as `dropped`, touching nothing.
   */
  private run<T>(key: string, dropped: T, op: (alive: () => boolean) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const c = this.deps.character();
    const alive = () => this.epoch === epoch && this.deps.character() === c;
    this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
    this.deps.changed('busy');
    const next = this.queue.then(() => (alive() ? op(alive) : dropped));
    this.queue = next.catch(() => {});
    const done = () => {
      if (this.epoch !== epoch) return;
      const n = (this.busy.get(key) ?? 1) - 1;
      if (n > 0) this.busy.set(key, n);
      else this.busy.delete(key);
      this.deps.changed('busy');
    };
    next.then(done, done);
    return next;
  }

  /**
   * Put on a wardrobe item (or the species pack's own part that is it), taking off what the game's slots
   * say it displaces, in the one order that compiles before it shows. `give` gives it too (the give tabs);
   * `force` puts on a piece this species cannot wear (the give tab's developer override).
   */
  wear(id: string, opts: { give?: boolean; force?: boolean } = {}): Promise<string> {
    return this.run(`wear:${id}`, DROPPED, (alive) => this.wearOp(id, opts, alive));
  }

  /**
   * The body of `wear`, run in its turn in the queue (by `wear`, or by `use` once it has decided to put
   * on). `thing` is which owned copy goes on, where the backpack's own cell said.
   */
  private async wearOp(id: string, opts: { give?: boolean; force?: boolean; thing?: string }, alive: () => boolean): Promise<string> {
    const c = this.deps.character();
    if (!c) return 'this character is a single model';
    const ctx = await this.itemContext();
    if (!alive()) return DROPPED;
    const info = itemInfo('wear', id, ctx);
    // Hair is never put on as an item (`wornPieces` leaves it out, so nothing here would take the style
    // already on off, and two would be worn): the appearance page's own path puts a style on.
    if (info.kindText === 'Hair') return HAIR_ELSEWHERE;
    if (!ctx.wardrobe && !info.packPart) return 'no wardrobe converted';
    if (info.missing) return 'not in this wardrobe';
    if (info.fit === 'block' && !opts.force) return `${speciesWords(ctx.species, true)} cannot wear this`;
    const part = info.packPart ?? id;
    const worn = this.wornPieces().filter((w) => w.id !== id);
    let slots: string[] = [];
    let displaced: string[];
    if (info.slots) {
      const plan = chooseArrangement(info.slots, occupancy(worn), id);
      slots = plan.slots;
      displaced = plan.displaced;
    } else {
      // A pack from before the arrangements were read: today's rule, one piece per give-tab group.
      const group = slotGroupOf(id);
      displaced = worn.filter((w) => slotGroupOf(w.id) === group).map((w) => w.id);
    }
    const displacedParts = displaced.map((d) => worn.find((w) => w.id === d)?.part).filter((p): p is string => !!p);
    try {
      const got = await c.loadPiece(part, this.deps.baseUrl);
      if (!alive()) return DROPPED;
      if (!got.found) return 'not in this wardrobe';
      await c.customizer?.settled();
      if (!alive()) return DROPPED;
      for (const m of got.meshes) {
        await this.deps.prepare(m);
        if (!alive()) return DROPPED;
      }
    } catch (err) {
      return `could not put on ${info.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
    // The one step at which the picture changes: the displaced come off as the new piece goes on.
    c.putOn([part], displacedParts);
    this.slotsWorn.set(id, slots);
    for (const d of displaced) this.slotsWorn.delete(d);
    if (opts.give) this.addOwned('wear', id);
    if (opts.thing) this.choose('wear', id, opts.thing);
    this.save();
    this.deps.changed('worn');
    const off = displaced.map((d) => this.nameOf('wear', d));
    const unseen = info.fit === 'hide' || info.unseen ? ' (worn unseen)' : '';
    return off.length ? `${info.name} on${unseen}; took off ${off.join(', ')}` : `${info.name} on${unseen}`;
  }

  /** Take a worn item off (the part it is worn under: its id, or its pack part). */
  takeOff(id: string): string {
    const c = this.deps.character();
    if (!c) return 'this character is a single model';
    const part = this.wornPartOf(id);
    if (!part) return `${this.nameOf('wear', id)} is not worn`;
    c.putOn([], [part]);
    this.slotsWorn.delete(id);
    this.save();
    this.deps.changed('worn');
    return `${this.nameOf('wear', id)} off`;
  }

  /** The give tab's removals, by part name (hair and pack parts with no item included). */
  takeOffPart(partName: string): string {
    return this.takeOffParts([partName]);
  }

  /** Several parts off in one step, saved and told once (the give tab's "none" and "Take everything off"). */
  takeOffParts(parts: string[]): string {
    const c = this.deps.character();
    if (!c) return 'this character is a single model';
    if (!parts.length) return 'nothing to take off';
    c.putOn([], parts);
    for (const p of parts) {
      const id = this.itemIdOf(p);
      if (id) this.slotsWorn.delete(id);
    }
    this.save();
    this.deps.changed('worn');
    return `${parts.join(', ')} off`;
  }

  /** What each hand holds, as the rules read it. */
  private heldRefs(): { right: HeldRef | null; left: HeldRef | null } {
    const e = this.deps.player.equipped;
    const ref = (d: WeaponDef | null): HeldRef | null => (d ? { id: d.id, cls: d.class, slots: d.slots ?? null } : null);
    return { right: ref(e.right), left: ref(e.left) };
  }

  /**
   * Take up a weapon: where it goes and what comes out of the hands by `planHold`, its model prepared on
   * every hold (unless `prepare` is false), then in hand. Returns the kit it wants; the caller switches.
   */
  hold(def: WeaponDef, hand: Hand, opts: { give?: boolean; prepare?: boolean; thing?: string } = {}): Promise<UseResult> {
    return this.run(`weapon:${def.id}`, { note: DROPPED, wants: null }, (alive) => this.holdOp(def, hand, opts, alive));
  }

  /**
   * The body of `hold`, run in its turn in the queue (by `hold`, or by `use` once it has decided to take
   * up). `thing` is which owned copy goes in the hand.
   */
  private async holdOp(def: WeaponDef, hand: Hand, opts: { give?: boolean; prepare?: boolean; thing?: string }, alive: () => boolean): Promise<UseResult> {
    const dropped: UseResult = { note: DROPPED, wants: null };
    const weapons = await this.deps.weaponsLoaded();
    if (!alive()) return dropped;
    if (!weapons) return { note: 'no weapons converted', wants: null };
    const plan = planHold(this.heldRefs(), { id: def.id, cls: def.class, slots: def.slots ?? null }, hand);
    if (plan.refused) return { note: plan.refused, wants: null };
    let model: THREE.Object3D;
    try {
      model = await weapons.model(def);
      if (!alive()) return dropped;
      if (opts.prepare !== false) {
        await this.deps.prepare(model);
        if (!alive()) return dropped;
      }
    } catch (err) {
      return { note: `could not take up ${def.id}: ${err instanceof Error ? err.message : String(err)}`, wants: null };
    }
    const p = this.deps.player;
    for (const h of plan.stow) p.unequip(h);
    const wants = p.equip(def, model, plan.hand);
    if (opts.give) this.addOwned('weapon', def.id);
    if (opts.thing) this.choose('weapon', def.id, opts.thing);
    this.save();
    this.deps.changed('held');
    const name = this.lastCtx ? itemInfo('weapon', def.id, this.lastCtx).name : def.id;
    return { note: `${name} in the ${plan.hand} hand`, wants };
  }

  /** Empty a hand; the weapon goes back to the backpack. */
  stow(hand: Hand): string {
    const p = this.deps.player;
    const was = p.equipped[hand];
    p.unequip(hand);
    this.save();
    this.deps.changed('held');
    return was ? `${this.nameOf('weapon', was.id)} back in the backpack` : `${hand} hand empty`;
  }

  /**
   * The backpack's double-click: on if off, off if on; a weapon to `hand` (default the right). Decided in
   * its turn in the queue, not when asked, so two quick uses of one item put it on and take it off again
   * rather than both putting it on. `thing` is the owned copy the cell was: when another copy of the
   * item is the one on the body or in the hand, this one takes its place and nothing comes off.
   */
  use(kind: 'wear' | 'weapon', id: string, hand?: Hand, thing?: string): Promise<UseResult> {
    const dropped: UseResult = { note: DROPPED, wants: null };
    return this.run(`${kind}:${id}`, dropped, async (alive) => {
      if (kind === 'wear') {
        // A hairstyle a record still owns from before hair stopped being an item (a Sullustan's
        // `sul_hair_*`) is kept and never used: on or off, a style is the appearance page's.
        if (isHairKey(id)) return { note: HAIR_ELSEWHERE, wants: null };
        if (this.wornPartOf(id)) {
          if (this.isOtherCopy('wear', id, thing)) return { note: this.switchTo('wear', id, thing), wants: null };
          return { note: this.takeOff(id), wants: null };
        }
        return { note: await this.wearOp(id, { thing }, alive), wants: null };
      }
      const e = this.deps.player.equipped;
      const other = this.isOtherCopy('weapon', id, thing);
      if (hand === 'left') {
        if (e.left?.id === id) return { note: other ? this.switchTo('weapon', id, thing!) : this.stow('left'), wants: null };
      } else {
        if (e.right?.id === id) return { note: other ? this.switchTo('weapon', id, thing!) : this.stow('right'), wants: null };
        if (e.left?.id === id) return { note: other ? this.switchTo('weapon', id, thing!) : this.stow('left'), wants: null };
      }
      const weapons = await this.deps.weaponsLoaded();
      if (!alive()) return dropped;
      const def = weapons?.weapons.find((w) => w.id === id);
      if (!def) return { note: weapons ? 'not on the weapons rack' : 'no weapons converted', wants: null };
      return this.holdOp(def, hand ?? 'right', { thing }, alive);
    });
  }

  /**
   * Destroy one owned thing: off the body or out of the hand first when it is the copy in use, then out
   * of the items, saved -- that one row and no other, here and on the server alike. Without `thing` it
   * is the copy in use, else the oldest (`thingInUse`). In the queue under the item's own key: a put-on
   * or take-up of it still in flight finishes first, so its save (which gives whatever is worn and held)
   * cannot bring the item back after it is destroyed.
   */
  destroy(kind: 'wear' | 'weapon', id: string, thing?: string): Promise<string> {
    const target = (rec: SavedCharacter | null): string | null => {
      if (!rec) return null;
      const items = this.namedItems(rec);
      if (thing) return items.some((o) => o.thing === thing && o.kind === kind && o.id === id) ? thing : null;
      return wornThingOf(items, kind, id, kind === 'wear' ? rec.wornThings : rec.heldThings);
    };
    const first = this.deps.record();
    if (!first) return Promise.resolve('no character is being played');
    if (!target(first)) return Promise.resolve('not owned');
    return this.run(`${kind}:${id}`, DROPPED, async (alive) => {
      await this.itemContext();
      if (!alive()) return DROPPED;
      const rec = this.deps.record();
      if (!rec) return 'no character is being played';
      const doomed = target(rec);
      const row = doomed ? (rec.items ?? []).find((o) => o.thing === doomed) : undefined;
      if (!doomed || !row) return 'not owned';
      const name = this.nameOf(kind, id);
      // Only the copy on the body or in the hand comes off: destroying the other of two leaves the one worn on.
      const inUse = this.thingInUse(kind, id) === doomed;
      if (kind === 'wear') {
        if (inUse && this.wornPartOf(id)) this.takeOff(id);
      } else if (inUse) {
        const e = this.deps.player.equipped;
        if (e.right?.id === id) this.deps.player.unequip('right');
        if (e.left?.id === id) this.deps.player.unequip('left');
      }
      rec.items = (rec.items ?? []).filter((o) => o.thing !== doomed);
      this.deps.ledger?.('drop', row);
      this.save({ noGive: true });
      this.deps.changed('owned');
      this.deps.changed(kind === 'wear' ? 'worn' : 'held');
      return `${name} destroyed`;
    });
  }

  /** Whether this character owns a thing now, by its name: what a trade asks before it will offer one. */
  owns(thing: string): boolean {
    return !!this.itemOf(thing);
  }

  /**
   * What a thing is doing instead of sitting in the backpack: worn, or in one of the hands. It is what a
   * trade reads to refuse something that is on the body rather than taking it off the player behind
   * their back, and whether the item is on is read from the body and the hands themselves, never from
   * the record, because the record is written after the fact and a piece being put on is on before it
   * is saved. Of two of one shirt, only the copy in use (`thingInUse`) is; the other may be traded.
   */
  inUse(thing: string): 'worn' | 'right' | 'left' | null {
    const it = this.itemOf(thing);
    if (!it || this.thingInUse(it.kind, it.id) !== thing) return null;
    if (it.kind === 'wear') return this.wornPartOf(it.id) ? 'worn' : null;
    const e = this.deps.player.equipped;
    if (e.right?.id === it.id) return 'right';
    if (e.left?.id === it.id) return 'left';
    return null;
  }

  /**
   * The server's list of what this character owns, which stands. It is the one way anything outside
   * this file writes the items, and it is written whole rather than merged: once a server holds a
   * character, its rows are the truth and what is here is a cache of them (the wave's decision 7).
   *
   * Anything that has gone comes off the body and out of the hands first, in the same step, so a
   * shirt traded away cannot be left being worn by a character that no longer owns it; then the list
   * is written and saved with `noGive`, because the ordinary save gives back whatever is worn and
   * held -- which would put the very item that was just traded away straight back into the list.
   *
   * It runs in the queue like everything else, so a put-on or a take-up still in flight finishes
   * first and cannot land after the list it would contradict. Nothing is sent from here: the server
   * has already written the rows, and this is the browser catching up.
   *
   * The server's rows and this list are paired thing by thing (`pairOwned`): by name first, then what
   * is left by kind and id, oldest with oldest, and a pair takes the server's name. Nothing is minted
   * for a server that names its things, so a name and the colour on it survive every list. A thing
   * that has gone comes off the body only when no other copy of it is left to wear. `now` is the
   * server's clock as the list arrives, which a colour stamped here by a clock running fast is held to.
   */
  reconcile(items: readonly ListedItem[], now = Infinity): Promise<string> {
    return this.run('reconcile', DROPPED, async (alive) => {
      await this.itemContext();
      if (!alive()) return DROPPED;
      const rec = this.deps.record();
      if (!rec) return 'no character is being played';
      const had = normalizeOwned(rec.items);
      const paired = pairOwned(had, items, undefined, now);
      const want = paired.items;
      const gone = paired.gone;
      let tookOff = false;
      let unhanded = false;
      for (const o of gone) {
        // Another copy of it is still owned: the body keeps it on, and that copy is the one worn now.
        if (want.some((w) => w.kind === o.kind && w.id === o.id)) continue;
        if (o.kind === 'wear') {
          if (this.wornPartOf(o.id)) {
            this.takeOff(o.id);
            tookOff = true;
          }
          continue;
        }
        const e = this.deps.player.equipped;
        if (e.right?.id === o.id) {
          this.deps.player.unequip('right');
          unhanded = true;
        }
        if (e.left?.id === o.id) {
          this.deps.player.unequip('left');
          unhanded = true;
        }
      }
      // The record's choice of which copy is worn and held follows a thing whose name was the server's
      // to give, so taking the server's name never quietly swaps one shirt for the other. After the
      // taking off above, whose saves still read the list as it was.
      for (const key of ['wornThings', 'heldThings'] as const) {
        const map = rec[key];
        if (!map) continue;
        for (const id of Object.keys(map)) {
          const to = paired.renamed.get(map[id]);
          if (to) map[id] = to;
        }
      }
      rec.items = want;
      this.save({ noGive: true });
      if (gone.length || paired.came) this.deps.changed('owned');
      if (tookOff) this.deps.changed('worn');
      if (unhanded) this.deps.changed('held');
      return reconcileWords(paired.came, gone.length);
    });
  }

  /**
   * The saved hands back in them (play(), a species switch), each by its exact id, the blade left as it
   * was: Player.equip lights a Jedi's blade, and a character arrives as it left, unlit. An id the rack
   * lacks is dropped from `held`. The class is not switched: the record's class stands.
   */
  async restoreHeld(opts: { prepare?: boolean } = {}): Promise<void> {
    const rec = this.deps.record();
    const want = { ...(rec?.held ?? {}) };
    if (!want.right && !want.left) return;
    // Which copy was in each hand, read before the first hand's save prunes the choice for the second.
    const chosen = { ...(rec?.heldThings ?? {}) };
    const epoch = this.epoch;
    const p = this.deps.player;
    const lit = p.saberOn;
    const weapons = await this.deps.weaponsLoaded();
    if (epoch !== this.epoch) return;
    let unknown = false;
    for (const hand of ['right', 'left'] as const) {
      const id = want[hand];
      if (!id) continue;
      const def = weapons?.weapons.find((w) => w.id === id);
      if (!def) {
        unknown = true;
        continue;
      }
      const r = await this.hold(def, hand, { prepare: opts.prepare, thing: Object.prototype.hasOwnProperty.call(chosen, id) ? chosen[id] : undefined });
      if (r.note === DROPPED || epoch !== this.epoch) return;
    }
    if (!lit && p.saberOn) p.toggleSaber();
    if (unknown && weapons) this.save();
  }

  /**
   * Write the record: the outfit (every worn non-body part, hair included), the hands, and every worn
   * or held catalogue item into the items. Nothing without a record. `keepHands` leaves `held` as it is
   * (a resync, before the saved hands are restored); `noGive` adds nothing (a destroy).
   */
  private save(opts: { keepHands?: boolean; noGive?: boolean } = {}): void {
    const rec = this.deps.record();
    if (!rec) return;
    const c = this.deps.character();
    if (c) rec.outfit = c.status().filter((p) => p.worn && !p.body).map((p) => p.name);
    const e = this.deps.player.equipped;
    if (!opts.keepHands) {
      const held: { right?: string; left?: string } = {};
      if (e.right) held.right = e.right.id;
      if (e.left) held.left = e.left.id;
      rec.held = held;
    }
    if (!opts.noGive) {
      for (const w of this.wornPieces()) this.addOwned('wear', w.id);
      if (e.right) this.addOwned('weapon', e.right.id);
      if (e.left) this.addOwned('weapon', e.left.id);
    }
    rec.items = normalizeOwned(rec.items);
    // Which copy is worn and held is kept only while that item is on and that copy is still owned.
    // The worn half waits for a wardrobe to have been read (with none, nothing reads as worn), and the
    // held half for the hands to be the ones the record is about (a resync saves before they are back).
    if (this.lastCtx?.wardrobe) this.setChosen(rec, 'wornThings', pruneThings(rec.wornThings, rec.items, 'wear', new Set(this.wornPieces().map((w) => w.id))));
    if (!opts.keepHands) this.setChosen(rec, 'heldThings', pruneThings(rec.heldThings, rec.items, 'weapon', new Set([e.right?.id, e.left?.id].filter((x): x is string => !!x))));
    this.deps.persist(rec);
  }

  /** A choice map on the record, or none at all when it is empty. */
  private setChosen(rec: SavedCharacter, key: 'wornThings' | 'heldThings', map: Record<string, string> | undefined): void {
    if (map && Object.keys(map).length) rec[key] = map;
    else delete rec[key];
  }

  /** For the panel and the console: owned, worn, held, busy keys, the catalogues' state. */
  snapshot(): EquipmentSnapshot {
    const rec = this.deps.record();
    const e = this.deps.player.equipped;
    const worn: Record<string, string> = {};
    const wornThing: Record<string, string> = {};
    for (const w of this.wornPieces()) {
      worn[w.id] = w.part;
      const thing = this.thingInUse('wear', w.id);
      if (thing) wornThing[w.id] = thing;
    }
    return {
      owned: this.owned(),
      worn,
      held: { right: e.right?.id ?? null, left: e.left?.id ?? null },
      wornThing,
      heldThing: { right: e.right ? this.thingInUse('weapon', e.right.id) : null, left: e.left ? this.thingInUse('weapon', e.left.id) : null },
      chosen: { worn: { ...(rec?.wornThings ?? {}) }, held: { ...(rec?.heldThings ?? {}) } },
      busy: [...this.busy.keys()],
      inv: rec?.inv ?? null,
      named: rec?.named ?? null,
      record: rec?.name ?? null,
      species: this.deps.character()?.manifest.id ?? rec?.species ?? '',
      wardrobe: this.lastCtx ? !!this.lastCtx.wardrobe : null,
      weapons: this.lastCtx ? !!this.lastCtx.weapons : null,
    };
  }
}
