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
import { chooseArrangement, normalizeOwned, occupancy, partToItemId, planHold, resolveKit, slotGroupOf, speciesWords, migrateInventory, type Fit, type Hand, type HeldRef, type OwnedItem } from '../core/inventory.ts';
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
   * An item appeared in this character's list, or left it, on this browser's own say-so: the
   * starting kit, a give, something worn that was not owned, a destroy. The wiring hands it to the
   * server so that its rows and this cache do not drift. A trade never comes this way -- an item
   * between two players is moved by the server and arrives here as a whole list (`reconcile`) --
   * and with no server nothing is wired to it at all, which is why it is optional.
   */
  ledger?: (what: 'add' | 'drop', kind: 'wear' | 'weapon', id: string) => void;
  baseUrl: string;
}

export interface EquipmentSnapshot {
  /** The record's items, newest last as given. */
  owned: OwnedItem[];
  /** Worn catalogue items: id -> the part it is worn under. */
  worn: Record<string, string>;
  held: { right: string | null; left: string | null };
  /** Keys (`wear:<id>`, `weapon:<id>`) being put on or taken up. */
  busy: string[];
  /** The record's migration mark; null with no record. */
  inv: 1 | null;
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
    if (/^hair_/.test(part)) return null;
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
      if (c.inv !== 1) {
        const now = Date.now();
        const kit = resolveKit(c.class, this.look(ctx), now);
        migrateInventory(c, kit.items, (part) => this.itemIdOf(part), now);
        this.deps.persist(c);
      } else c.items = normalizeOwned(c.items);
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

  /** Into the record's items, unsaved; true when it is new. */
  private addOwned(kind: 'wear' | 'weapon', id: string): boolean {
    const rec = this.deps.record();
    if (!rec) return false;
    const items = (rec.items ??= []);
    if (items.some((o) => o.kind === kind && o.id === id)) return false;
    items.push({ id, kind, got: Date.now() });
    this.deps.ledger?.('add', kind, id);
    return true;
  }

  /** Give an item: true when it is new (and saved); false, and nothing, when it is owned already or no record is played. */
  give(kind: 'wear' | 'weapon', id: string): boolean {
    const rec = this.deps.record();
    if (!rec || !this.addOwned(kind, id)) return false;
    this.deps.persist(rec);
    this.deps.changed('owned');
    return true;
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
      if (!p.worn || p.body || /^hair_/.test(p.name)) continue;
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

  /** The body of `wear`, run in its turn in the queue (by `wear`, or by `use` once it has decided to put on). */
  private async wearOp(id: string, opts: { give?: boolean; force?: boolean }, alive: () => boolean): Promise<string> {
    const c = this.deps.character();
    if (!c) return 'this character is a single model';
    const ctx = await this.itemContext();
    if (!alive()) return DROPPED;
    const info = itemInfo('wear', id, ctx);
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
  hold(def: WeaponDef, hand: Hand, opts: { give?: boolean; prepare?: boolean } = {}): Promise<UseResult> {
    return this.run(`weapon:${def.id}`, { note: DROPPED, wants: null }, (alive) => this.holdOp(def, hand, opts, alive));
  }

  /** The body of `hold`, run in its turn in the queue (by `hold`, or by `use` once it has decided to take up). */
  private async holdOp(def: WeaponDef, hand: Hand, opts: { give?: boolean; prepare?: boolean }, alive: () => boolean): Promise<UseResult> {
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
   * rather than both putting it on.
   */
  use(kind: 'wear' | 'weapon', id: string, hand?: Hand): Promise<UseResult> {
    const dropped: UseResult = { note: DROPPED, wants: null };
    return this.run(`${kind}:${id}`, dropped, async (alive) => {
      if (kind === 'wear') {
        if (this.wornPartOf(id)) return { note: this.takeOff(id), wants: null };
        return { note: await this.wearOp(id, {}, alive), wants: null };
      }
      const e = this.deps.player.equipped;
      if (hand === 'left') {
        if (e.left?.id === id) return { note: this.stow('left'), wants: null };
      } else {
        if (e.right?.id === id) return { note: this.stow('right'), wants: null };
        if (e.left?.id === id) return { note: this.stow('left'), wants: null };
      }
      const weapons = await this.deps.weaponsLoaded();
      if (!alive()) return dropped;
      const def = weapons?.weapons.find((w) => w.id === id);
      if (!def) return { note: weapons ? 'not on the weapons rack' : 'no weapons converted', wants: null };
      return this.holdOp(def, hand ?? 'right', {}, alive);
    });
  }

  /**
   * Destroy an owned item: off the body or out of the hand first, then out of the items, saved. In the
   * queue under the item's own key: a put-on or take-up of it still in flight finishes first, so its save
   * (which gives whatever is worn and held) cannot bring the item back after it is destroyed.
   */
  destroy(kind: 'wear' | 'weapon', id: string): Promise<string> {
    const owns = (rec: SavedCharacter | null) => !!rec?.items?.some((o) => o.kind === kind && o.id === id);
    const first = this.deps.record();
    if (!first) return Promise.resolve('no character is being played');
    if (!owns(first)) return Promise.resolve('not owned');
    return this.run(`${kind}:${id}`, DROPPED, async (alive) => {
      await this.itemContext();
      if (!alive()) return DROPPED;
      const rec = this.deps.record();
      if (!rec) return 'no character is being played';
      if (!owns(rec)) return 'not owned';
      const name = this.nameOf(kind, id);
      if (kind === 'wear') {
        if (this.wornPartOf(id)) this.takeOff(id);
      } else {
        const e = this.deps.player.equipped;
        if (e.right?.id === id) this.deps.player.unequip('right');
        if (e.left?.id === id) this.deps.player.unequip('left');
      }
      rec.items = (rec.items ?? []).filter((o) => !(o.kind === kind && o.id === id));
      this.deps.ledger?.('drop', kind, id);
      this.save({ noGive: true });
      this.deps.changed('owned');
      this.deps.changed(kind === 'wear' ? 'worn' : 'held');
      return `${name} destroyed`;
    });
  }

  /** Whether this character owns an item now: what a trade asks before it will offer one. */
  owns(kind: 'wear' | 'weapon', id: string): boolean {
    return !!this.deps.record()?.items?.some((o) => o.kind === kind && o.id === id);
  }

  /**
   * What an item is doing instead of sitting in the backpack: worn, or in one of the hands. It is
   * what a trade reads to refuse something that is on the body rather than taking it off the player
   * behind their back, and it is read from the body and the hands themselves, never from the record,
   * because the record is written after the fact and a piece being put on is on before it is saved.
   */
  inUse(kind: 'wear' | 'weapon', id: string): 'worn' | 'right' | 'left' | null {
    if (kind === 'wear') return this.wornPartOf(id) ? 'worn' : null;
    const e = this.deps.player.equipped;
    if (e.right?.id === id) return 'right';
    if (e.left?.id === id) return 'left';
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
   */
  reconcile(items: readonly OwnedItem[]): Promise<string> {
    return this.run('reconcile', DROPPED, async (alive) => {
      await this.itemContext();
      if (!alive()) return DROPPED;
      const rec = this.deps.record();
      if (!rec) return 'no character is being played';
      const want = normalizeOwned(items as OwnedItem[]);
      const had = normalizeOwned(rec.items);
      const wanted = new Set(want.map((o) => `${o.kind}:${o.id}`));
      const gone = had.filter((o) => !wanted.has(`${o.kind}:${o.id}`));
      const came = want.filter((o) => !had.some((h) => h.kind === o.kind && h.id === o.id));
      let tookOff = false;
      let unhanded = false;
      for (const o of gone) {
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
      rec.items = want;
      this.save({ noGive: true });
      if (gone.length || came.length) this.deps.changed('owned');
      if (tookOff) this.deps.changed('worn');
      if (unhanded) this.deps.changed('held');
      return reconcileWords(came.length, gone.length);
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
      const r = await this.hold(def, hand, { prepare: opts.prepare });
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
    this.deps.persist(rec);
  }

  /** For the panel and the console: owned, worn, held, busy keys, the catalogues' state. */
  snapshot(): EquipmentSnapshot {
    const rec = this.deps.record();
    const e = this.deps.player.equipped;
    const worn: Record<string, string> = {};
    for (const w of this.wornPieces()) worn[w.id] = w.part;
    return {
      owned: this.owned(),
      worn,
      held: { right: e.right?.id ?? null, left: e.left?.id ?? null },
      busy: [...this.busy.keys()],
      inv: rec?.inv ?? null,
      record: rec?.name ?? null,
      species: this.deps.character()?.manifest.id ?? rec?.species ?? '',
      wardrobe: this.lastCtx ? !!this.lastCtx.wardrobe : null,
      weapons: this.lastCtx ? !!this.lastCtx.weapons : null,
    };
  }
}
