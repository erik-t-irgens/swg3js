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
// A thing's colours are its own (`OwnedItem.tint`, by bare variable name): a piece goes on drawn in the
// colours of the copy put on, before it shows (`colourPiece`, inside the same settle), switching which of
// two copies is worn draws the piece again in the other's, and a colour set on the appearance page is the
// worn copy's (`setTint`), saved at once and told to the server a moment after the last change.
//
// Node-loadable for the tests: type-only imports apart from the rules and the item facts.
import type * as THREE from 'three';
import type { ClassId } from '../combat/kit';
import type { SavedCharacter } from '../core/characters';
import { ITEMS_MOST, OFF_HAND_CLASSES, chooseArrangement, cleanTint, collapseOwned, garmentMeshesOf, heldThingsOf, isHairKey, mintThing, moveTints, normalizeOwned, occupancy, packPartOf, pairOwned, partToItemId, planHold, pruneHeld, pruneThings, resolveKit, slotGroupOf, speciesWords, migrateInventory, thingOf, tintValues, wornThingOf, type Fit, type Hand, type HandThings, type HeldRef, type ListedItem, type OwnedItem } from '../core/inventory.ts';
import { itemInfo, wardrobeIndex, type ItemContext } from './items.ts';
import type { Character } from './character';
import type { Player } from './player';
import type { WeaponCatalogue, WeaponDef } from './weapons';

/**
 * How a thing's colours go to the server, every number ours and live through `__debug.tint({ tune })`.
 * A colour is the one change that comes in a stream -- a slider scrubbed, a picker swept -- so it is said
 * once the thing has been still for a moment, and a list's worth of colours set while nobody answered is
 * paced rather than poured into the second the backpack itself was handed up in.
 */
export const ITEMS_TUNE = {
  /** How long a thing's colours must stand before they go to the server, in ms. */
  tintSettleMs: 800,
  /**
   * How many colour words go out in a second at most. The server takes eight words a second from one
   * browser over everything it says about its things and its trades (`item.ask.perSecond`), counted on a
   * window of its own that starts with whatever word comes first, so it does not line up with this
   * browser's seconds: at ten, the hand-up and the first burst of colours fell in one of the server's
   * windows and it dropped the ninth without a word (measured through a real relay). Six leaves room for
   * the hand-up, the worn list and an offer in any window; the trade's own rate gates every word as well.
   */
  tintsPerSecond: 6,
  /** How many seconds running a colour the server cannot take yet is tried again; past it the next list carries it. */
  tintTries: 5,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneItems(o: Partial<typeof ITEMS_TUNE>): typeof ITEMS_TUNE {
  if (typeof o.tintSettleMs === 'number') ITEMS_TUNE.tintSettleMs = Math.max(0, Math.min(60000, Math.round(o.tintSettleMs)));
  if (typeof o.tintsPerSecond === 'number') ITEMS_TUNE.tintsPerSecond = Math.max(1, Math.min(60, Math.round(o.tintsPerSecond)));
  if (typeof o.tintTries === 'number') ITEMS_TUNE.tintTries = Math.max(1, Math.min(600, Math.round(o.tintTries)));
  return ITEMS_TUNE;
}

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
  /**
   * Tell the server one thing's colours (`Trade.noteTint`): true when the word went. Optional; with
   * nothing wired a colour is the backpack's alone, as everything is with no server.
   */
  noteTint?: (thing: string, tint: Record<string, number> | null, at: number) => boolean;
  /**
   * Whether a server is holding this character's things and keeps a row per thing, so a colour has
   * somewhere to go. While it does not, nothing waits to be sent: the list a server hands over next is
   * laid over the backpack, and every colour newer than its own goes up then.
   */
  tintsLive?: () => boolean;
  /** The clock a colour is stamped with: the one the server hands out (`sharedClock.now()`), else this machine's. */
  now?: () => number;
  /**
   * The record was written again in another shape with nothing about the character changed -- its garment
   * colours moved out of the look onto the things they colour (`moveTints`) -- so the session can adopt the
   * new mark without counting a change. `was` is the record as it stood before.
   */
  rewritten?: (was: SavedCharacter, now: SavedCharacter) => void;
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
  /** Which thing is in each hand, where it is owned: two copies of one hilt are two things, one a hand. */
  heldThing: HandThings;
  /** The record's own choices of which copy is worn (by id) and which is in each hand, where it is not the rule's. */
  chosen: { worn: Record<string, string>; held: { right?: string; left?: string } };
  /** Keys (`wear:<id>`, `weapon:<id>`) being put on or taken up. */
  busy: string[];
  /** The record's migration mark; null with no record. */
  inv: 1 | null;
  /** Whether the record's items have been brought into named things (`collapseOwned`); null with no record. */
  named: 1 | null;
  /** Whether the record's garment colours have been moved onto its things (`moveTints`); null with no record. */
  tints: 1 | null;
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
  /**
   * Things whose colours wait to go to the server, with how many seconds each has been tried. By name:
   * what is sent is the thing's colours as they stand when it goes, so a slider scrubbed sends one word.
   */
  private readonly tintsWaiting = new Map<string, number>();
  private tintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Colour words sent and given up, for the console. */
  private tintsSent = 0;
  private tintsGivenUp = 0;
  /** The last piece drawn in a thing's colours: what went on and how many values moved, for the console. */
  private lastColour: { part: string; thing: string | null; moved: number } | null = null;

  constructor(deps: EquipmentDeps) {
    this.deps = deps;
  }

  /** The catalogues as last read (null before the first operation). */
  get lastContext(): ItemContext | null {
    return this.lastCtx;
  }

  /** The last piece drawn in a thing's colours (`colourPiece`): its part, the thing and how many values moved. */
  get lastColouring(): { part: string; thing: string | null; moved: number } | null {
    return this.lastColour;
  }

  /**
   * Empty both hands (blade off) and forget what is remembered about a character; saves nothing. A colour
   * still waiting to be told stays: it is sent only while its thing is in the record played, so another
   * character's is let go at the next flush, and the next list that character is handed carries it.
   */
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
      // Once, and only with a wardrobe to say which meshes are whose: the garments' colours move out of
      // the look onto the things they colour. The piece on the body shows exactly what it did, since the
      // look it was dressed in still held them; from here on the thing is where they live. A copy that
      // follows one of the body's colours is the body's and moves nowhere, and the colours of a piece no
      // longer owned leave the look with the rest rather than wait there for the next one to arrive.
      if (c.tints !== 1 && ctx.wardrobe) {
        const was = { ...c, items: (c.items ?? []).map((o) => ({ ...o })) };
        const cz = this.deps.character()?.customizer;
        const follows = cz && typeof cz.isLinked === 'function' ? (key: string) => cz.isLinked(key) : undefined;
        const garments = garmentMeshesOf(ctx.wardrobe, ctx.packParts);
        if (moveTints(c, (id) => this.meshesOfItem(id, ctx), { follows, garment: (mesh) => garments.has(mesh) })) this.deps.rewritten?.(was, c);
        changed = true;
      }
      if (changed) this.deps.persist(c);
    } catch (err) {
      console.warn(`inventory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The meshes a wardrobe item is drawn with: the catalogue's parts, and the species pack's own part that is it. */
  private meshesOfItem(id: string, ctx: ItemContext): string[] {
    const out = ctx.wardrobe ? (wardrobeIndex(ctx.wardrobe).get(id)?.parts ?? []).map((p) => p.name) : [];
    const pack = packPartOf(id, ctx.packParts);
    if (pack && !out.includes(pack)) out.push(pack);
    return out;
  }

  /** After a species switch in the world: reset, the new rig's worn pieces taken into items and drawn in their things' colours, saved, and the saved hands restored. */
  async resync(): Promise<void> {
    this.reset();
    const epoch = this.epoch;
    await this.itemContext();
    if (epoch !== this.epoch) return;
    for (const w of this.wornPieces()) this.addOwned('wear', w.id);
    this.colourWorn();
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
   * Which owned copy of an item is the one worn (a wardrobe item) or held (a weapon): for a piece the
   * record's own choice while it stands, else the oldest; for a weapon the copy in the right hand, else
   * the left's, else the oldest. Null when none is owned. It says nothing about whether the item is on
   * the body at all; that is the body's to say.
   */
  thingInUse(kind: 'wear' | 'weapon', id: string): string | null {
    const rec = this.deps.record();
    if (!rec) return null;
    const items = this.namedItems(rec);
    if (kind === 'weapon') {
      const e = this.deps.player.equipped;
      const hands = this.thingsInHands();
      if (e.right?.id === id && hands.right) return hands.right;
      if (e.left?.id === id && hands.left) return hands.left;
      return wornThingOf(items, 'weapon', id, null);
    }
    return wornThingOf(items, kind, id, rec.wornThings);
  }

  /**
   * Which owned thing is in each hand (`heldThingsOf`): the record's own choice per hand while it stands,
   * else the oldest copy not already in the other hand. Two copies of one hilt held one in each hand are
   * two things; null for an empty hand or a weapon nobody owns.
   */
  thingsInHands(): HandThings {
    const rec = this.deps.record();
    if (!rec) return { right: null, left: null };
    const e = this.deps.player.equipped;
    return heldThingsOf(this.namedItems(rec), { right: e.right?.id ?? null, left: e.left?.id ?? null }, rec.heldThings);
  }

  /** Make one owned copy the one worn, unsaved: written down only where it is not the oldest. */
  private choose(id: string, thing: string): void {
    const rec = this.deps.record();
    const it = this.itemOf(thing);
    if (!rec || !it || it.kind !== 'wear' || it.id !== id) return;
    const map: Record<string, string> = { ...(rec.wornThings ?? {}) };
    if (wornThingOf(this.namedItems(rec), 'wear', id, null) === thing) delete map[id];
    else map[id] = thing;
    if (Object.keys(map).length) rec.wornThings = map;
    else delete rec.wornThings;
  }

  /** Put one owned thing in a hand's choice, unsaved (the save prunes what the rule would take anyway); one thing names one hand. */
  private chooseHand(hand: Hand, thing: string): void {
    const rec = this.deps.record();
    const it = this.itemOf(thing);
    if (!rec || !it || it.kind !== 'weapon') return;
    const map: { right?: string; left?: string } = { ...(rec.heldThings ?? {}) };
    // A map of the shape before (catalogue id to thing) is no hand's: it is let go of here.
    for (const k of Object.keys(map)) if (k !== 'right' && k !== 'left') delete (map as Record<string, string>)[k];
    map[hand] = thing;
    const other: Hand = hand === 'right' ? 'left' : 'right';
    if (map[other] === thing) delete map[other];
    rec.heldThings = map;
  }

  /**
   * The other of two identical pieces becomes the one worn: nothing comes off and nothing is loaded --
   * the mesh is the item's and the same for both -- the record says which copy it is, and the piece is
   * drawn again in that copy's own colours (`colourPiece`), a copy with none in the game's own.
   */
  private switchTo(id: string, thing: string): string {
    this.choose(id, thing);
    const part = this.wornPartOf(id);
    if (part) this.colourPiece(part, thing);
    this.save();
    this.deps.changed('worn');
    return `${this.nameOf('wear', id)}: wearing this one now`;
  }

  /** The other of two identical weapons takes the place of the copy in a hand: the record says which thing is in it. */
  private switchHand(hand: Hand, id: string, thing: string): string {
    this.chooseHand(hand, thing);
    this.save();
    this.deps.changed('held');
    return `${this.nameOf('weapon', id)}: holding this one in the ${hand} hand now`;
  }

  /** Whether `thing` is owned, is a copy of this piece, and is not the copy worn now: the other of two. */
  private isOtherCopy(id: string, thing: string | undefined): thing is string {
    if (!thing) return false;
    const it = this.itemOf(thing);
    return !!it && it.kind === 'wear' && it.id === id && this.thingInUse('wear', id) !== thing;
  }

  /**
   * A worn piece drawn in one thing's colours: every variable its recipes read on the meshes it is worn
   * under (`tintValues`: the thing's colour by bare name, the recipe's default for the rest), set only
   * where the character holds something else, so a colour already showing is not rendered again and a
   * copy with none puts the piece back to the game's own. Called after the piece is loaded and before the
   * settle that the piece waits on to show, so its colour is rendered before anyone sees it, and no
   * program is built (a render is a texture on a material that already has one).
   *
   * A piece with no owned thing behind it -- one given and put on in the same step, whose thing is made
   * only once it is on, or a forced wear of something not owned -- has no colour of its own and goes on in
   * the game's own, never in whatever the last copy left on its meshes. A copy that follows one of the
   * body's colours (`Customizer.followedValue`: on a Wookiee every garment's `index_color_1` follows the
   * fur) is drawn at that colour, as the customizer's own link would draw it. Nothing at all is done with
   * no record (the creator), and for a record whose colours are still in its look (`tints` unset, for want
   * of a wardrobe when it was loaded): there the look is what the piece is drawn in, as it always was. How
   * many values moved.
   */
  private colourPiece(part: string, thing: string | null): number {
    const c = this.deps.character();
    const cz = c?.customizer;
    if (!c || !cz || this.deps.record()?.tints !== 1 || typeof cz.variablesOn !== 'function' || typeof c.meshesOf !== 'function') return 0;
    const it = thing ? this.itemOf(thing) : null;
    const defs = cz.variablesOn(new Set(c.meshesOf(part)));
    const follows = typeof cz.followedValue === 'function' ? (key: string) => cz.followedValue(key) : undefined;
    const want = tintValues(it?.tint, defs, follows);
    const moved: Record<string, number> = {};
    let n = 0;
    for (const d of defs) {
      if (!Object.prototype.hasOwnProperty.call(want, d.key)) continue;
      const v = want[d.key];
      // What a render reads now: the full spelling, then the short one a look from before may hold.
      const short = `${d.mesh}|${d.name.replace(/^.*\//, '')}`;
      const held = cz.values.get(d.key) ?? cz.values.get(short) ?? d.default;
      if (held === v) continue;
      moved[d.key] = v;
      n++;
    }
    if (n) cz.setAll(moved);
    this.lastColour = { part, thing: it ? thing : null, moved: n };
    return n;
  }

  /**
   * The colours a record's outfit is drawn in, worked out for a character that may not be wearing it yet
   * (the select screen's figure, the rig `play` dresses): for every piece of the outfit, the values the
   * worn copy's tint gives its meshes where they are not the recipes' own (`tintValues`), so the look they
   * are laid over (`putBackLook`, `applyAppearance`) puts back to the game's own whatever this record does
   * not colour and renders nothing for a piece left as the game had it. A copy that follows one of the
   * body's colours takes that colour as this record's look gives it (the pack's, else the recipe's, where
   * the look has none) -- never the customizer's, which may still hold the last character's -- as
   * `putBackLook` puts it. Empty for a record whose colours are still in its look (`tints` unset), which is
   * drawn as it always was.
   */
  async tintLook(rec: SavedCharacter, c: Character): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (rec.tints !== 1 || !c.customizer) return out;
    let index: ReturnType<typeof wardrobeIndex> | null = null;
    try {
      index = wardrobeIndex(await c.catalogue(this.deps.baseUrl));
    } catch {
      index = null;
    }
    const cz = c.customizer;
    if (!cz) return out;
    const items = normalizeOwned(rec.items);
    const look = rec.appearance?.values ?? {};
    const pack = c.manifest?.values ?? {};
    const short = (k: string) => k.replace(/^.*\//, '');
    const follows =
      typeof cz.followed === 'function'
        ? (key: string): number | undefined => {
            const s = cz.followed(key);
            if (!s) return undefined;
            return look[s.key] ?? look[short(s.key)] ?? pack[s.key] ?? pack[short(s.key)] ?? s.default;
          }
        : undefined;
    for (const part of rec.outfit ?? []) {
      if (isHairKey(part)) continue;
      const id = partToItemId(part, (x) => !!index?.has(x));
      const thing = id ? wornThingOf(items, 'wear', id, rec.wornThings) : null;
      const tint = thing ? thingOf(items, thing)?.tint : undefined;
      const defs = cz.variablesOn(new Set(c.meshesOf(part)));
      const values = tintValues(tint, defs, follows);
      for (const d of defs) if (Object.prototype.hasOwnProperty.call(values, d.key) && values[d.key] !== d.default) out[d.key] = values[d.key];
    }
    return out;
  }

  /**
   * Every worn piece drawn in the colours of the copy worn: after a list from the server, on a species
   * switch, and once more as a character is played, after its record has been read (`App.play`), so the
   * body agrees with its things whatever the look it was dressed in held. How many values moved.
   */
  colourWorn(): number {
    let n = 0;
    for (const w of this.wornPieces()) n += this.colourPiece(w.part, this.thingInUse('wear', w.id));
    return n;
  }

  /**
   * Colour one owned thing, by bare variable name: a number is a palette index or a colour carried whole,
   * `null` takes that one colour off (the piece's own comes back). Saved at once and stamped with the clock
   * the server hands out, drawn now when it is the copy worn, and told to the server once it has been still
   * for `ITEMS_TUNE.tintSettleMs`. '' when done, else why not. The appearance page's colours of a worn piece
   * come here; so does the console's `dye()`.
   */
  setTint(thing: string, change: Readonly<Record<string, number | null>>): string {
    const rec = this.deps.record();
    if (!rec) return 'no character is being played';
    const it = this.itemOf(thing);
    if (!it) return 'not owned';
    const next: Record<string, number> = { ...(it.tint ?? {}) };
    for (const [k, v] of Object.entries(change)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    const clean = cleanTint(next);
    if (clean) it.tint = clean;
    else delete it.tint;
    it.tintAt = Math.round(this.deps.now?.() ?? Date.now());
    if (it.kind === 'wear' && this.thingInUse('wear', it.id) === thing) {
      const part = this.wornPartOf(it.id);
      if (part) this.colourPiece(part, thing);
    }
    this.deps.persist(rec);
    this.tintSoon(thing);
    this.deps.changed('owned');
    return '';
  }

  /** A thing's colours, to be told to the server once it has been still a moment. Nothing waits while there is nobody to tell. */
  private tintSoon(thing: string, ms = ITEMS_TUNE.tintSettleMs): void {
    if (!this.deps.noteTint) return;
    if (!this.tintsWaiting.has(thing)) this.tintsWaiting.set(thing, 0);
    this.armTints(ms);
  }

  private armTints(ms: number): void {
    if (this.tintTimer) clearTimeout(this.tintTimer);
    this.tintTimer = setTimeout(() => {
      this.tintTimer = null;
      this.flushTints();
    }, ms);
  }

  /**
   * Send what waits, `ITEMS_TUNE.tintsPerSecond` at most, each thing's colours as they stand now. With no
   * server that keeps colours there is nothing to send, and nothing is kept: the next list carries every
   * colour newer than the server's. A word the server cannot take yet (no row for the thing, the second's
   * words spent) is tried again a second later, `tintTries` times, then left to the next list.
   */
  private flushTints(): void {
    if (!this.tintsWaiting.size) return;
    if (!this.deps.noteTint || !this.deps.tintsLive?.()) {
      this.tintsWaiting.clear();
      return;
    }
    const rec = this.deps.record();
    let sent = 0;
    for (const [thing, tries] of [...this.tintsWaiting]) {
      if (sent >= ITEMS_TUNE.tintsPerSecond) break;
      const it = rec ? this.itemOf(thing) : null;
      if (!it) {
        this.tintsWaiting.delete(thing);
        continue;
      }
      if (this.deps.noteTint(thing, it.tint ? { ...it.tint } : null, it.tintAt ?? 0)) {
        this.tintsWaiting.delete(thing);
        this.tintsSent++;
        sent++;
        continue;
      }
      if (tries + 1 >= ITEMS_TUNE.tintTries) {
        this.tintsWaiting.delete(thing);
        this.tintsGivenUp++;
      } else this.tintsWaiting.set(thing, tries + 1);
      // Refused now is most often the second's words spent: the rest wait for the next one.
      break;
    }
    if (this.tintsWaiting.size) this.armTints(1000);
  }

  /** What the console's `tint()` reads: every thing with a colour, the copy worn of each piece and in each hand, what waits to be told. */
  tintReport(): { tinted: { thing: string; id: string; kind: 'wear' | 'weapon'; tint: Record<string, number>; tintAt: number | null; inUse: 'worn' | 'right' | 'left' | null }[]; worn: Record<string, string>; held: HandThings; waiting: { thing: string; tries: number }[]; sent: number; givenUp: number; live: boolean; lastColour: { part: string; thing: string | null; moved: number } | null; marked: 1 | null } {
    const rec = this.deps.record();
    const items = rec ? this.namedItems(rec) : [];
    const snap = this.snapshot();
    return {
      tinted: items.filter((o) => o.tint && o.thing).map((o) => ({ thing: o.thing!, id: o.id, kind: o.kind, tint: { ...o.tint! }, tintAt: o.tintAt ?? null, inUse: this.inUse(o.thing!) })),
      worn: snap.wornThing,
      held: snap.heldThing,
      waiting: [...this.tintsWaiting].map(([thing, tries]) => ({ thing, tries })),
      sent: this.tintsSent,
      givenUp: this.tintsGivenUp,
      live: !!this.deps.tintsLive?.(),
      lastColour: this.lastColour,
      marked: rec?.tints ?? null,
    };
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
      // In the colours of the copy going on, rendered inside the settle below, so it shows in them. One
      // given in this same step is owned only once it is on, so none is found here and it goes on in the
      // game's own colours -- which is what the copy about to be made has -- not the last copy's.
      this.colourPiece(part, opts.thing && this.itemOf(opts.thing)?.id === id ? opts.thing : this.thingInUse('wear', id));
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
    if (opts.thing) this.choose(id, opts.thing);
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

  /** What each hand holds, as the rules read it: the weapon, and which owned thing it is. */
  private heldRefs(): { right: HeldRef | null; left: HeldRef | null } {
    const e = this.deps.player.equipped;
    const hands = this.thingsInHands();
    const ref = (d: WeaponDef | null, thing: string | null): HeldRef | null => (d ? { id: d.id, cls: d.class, slots: d.slots ?? null, ...(thing ? { thing } : {}) } : null);
    return { right: ref(e.right, hands.right), left: ref(e.left, hands.left) };
  }

  /**
   * Which owned copy of a weapon goes in a hand when none was named: the oldest not already in the other
   * hand, so a second copy of a hilt in hand is the one taken up beside it; failing that the very copy in
   * the other hand, which `planHold` then moves across (one thing cannot be in both); none when nobody
   * owns it (the developer's give tab, which owns it once taken up).
   */
  private copyFor(def: WeaponDef, want: Hand): string | undefined {
    const rec = this.deps.record();
    if (!rec) return undefined;
    const items = this.namedItems(rec);
    const hand: Hand = want === 'left' && OFF_HAND_CLASSES.has(def.class) ? 'left' : 'right';
    const other = this.thingsInHands()[hand === 'right' ? 'left' : 'right'];
    let best: OwnedItem | null = null;
    for (const o of items) {
      if (o.kind !== 'weapon' || o.id !== def.id || !o.thing || o.thing === other) continue;
      if (!best || o.got < best.got) best = o;
    }
    if (best?.thing) return best.thing;
    return other && thingOf(items, other)?.id === def.id ? other : undefined;
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
   * up). `thing` is which owned copy goes in the hand; with none named, `copyFor` picks one, so two
   * copies of one hilt fill both hands while one copy asked for the other hand moves across.
   */
  private async holdOp(def: WeaponDef, hand: Hand, opts: { give?: boolean; prepare?: boolean; thing?: string }, alive: () => boolean): Promise<UseResult> {
    const dropped: UseResult = { note: DROPPED, wants: null };
    const weapons = await this.deps.weaponsLoaded();
    if (!alive()) return dropped;
    if (!weapons) return { note: 'no weapons converted', wants: null };
    const named = opts.thing && this.itemOf(opts.thing)?.id === def.id ? opts.thing : undefined;
    const thing = named ?? this.copyFor(def, hand);
    const plan = planHold(this.heldRefs(), { id: def.id, cls: def.class, slots: def.slots ?? null, ...(thing ? { thing } : {}) }, hand);
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
    // Which thing is in the hand now: the one named or picked, or (given just now) the copy just given.
    const took = thing ?? this.copyFor(def, plan.hand);
    if (took) this.chooseHand(plan.hand, took);
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
   * piece is the one on the body, this one takes its place and nothing comes off.
   *
   * A weapon goes by the thing, not the item: the copy in a hand double-clicked is put away; another copy
   * double-clicked while a copy of it fills the hand asked for takes that copy's place; and a copy asked
   * for the other hand (the Left hand button, shift and a double-click) goes in it beside the first, so two
   * copies of one hilt are held one in each hand, each its own thing. With no thing named (the console,
   * the rack) it goes by the item, as it always did.
   */
  use(kind: 'wear' | 'weapon', id: string, hand?: Hand, thing?: string): Promise<UseResult> {
    const dropped: UseResult = { note: DROPPED, wants: null };
    return this.run(`${kind}:${id}`, dropped, async (alive) => {
      if (kind === 'wear') {
        // A hairstyle a record still owns from before hair stopped being an item (a Sullustan's
        // `sul_hair_*`) is kept and never used: on or off, a style is the appearance page's.
        if (isHairKey(id)) return { note: HAIR_ELSEWHERE, wants: null };
        if (this.wornPartOf(id)) {
          if (this.isOtherCopy(id, thing)) return { note: this.switchTo(id, thing), wants: null };
          return { note: this.takeOff(id), wants: null };
        }
        return { note: await this.wearOp(id, { thing }, alive), wants: null };
      }
      const e = this.deps.player.equipped;
      const named = thing && this.itemOf(thing)?.kind === 'weapon' && this.itemOf(thing)?.id === id ? thing : undefined;
      if (named) {
        const hands = this.thingsInHands();
        const at: Hand | null = hands.right === named ? 'right' : hands.left === named ? 'left' : null;
        // The copy in a hand, double-clicked: put away. Asked for the other hand, it moves across below.
        if (at && (!hand || hand === at)) return { note: this.stow(at), wants: null };
        // Another copy in the hand asked for: this one takes its place, and nothing comes out.
        const target: Hand = hand ?? 'right';
        if (!at && e[target]?.id === id) return { note: this.switchHand(target, id, named), wants: null };
      } else if (hand === 'left') {
        if (e.left?.id === id) return { note: this.stow('left'), wants: null };
      } else {
        if (e.right?.id === id) return { note: this.stow('right'), wants: null };
        if (e.left?.id === id) return { note: this.stow('left'), wants: null };
      }
      const weapons = await this.deps.weaponsLoaded();
      if (!alive()) return dropped;
      const def = weapons?.weapons.find((w) => w.id === id);
      if (!def) return { note: weapons ? 'not on the weapons rack' : 'no weapons converted', wants: null };
      return this.holdOp(def, hand ?? 'right', { thing: named }, alive);
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
      return this.thingInUse(kind, id);
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
      // Only the copy on the body or in the hand comes off: destroying the other of two leaves the one
      // worn on, and of two copies of one hilt held one in each hand only the hand holding it empties.
      if (kind === 'wear') {
        if (this.thingInUse(kind, id) === doomed && this.wornPartOf(id)) this.takeOff(id);
      } else {
        const hands = this.thingsInHands();
        if (hands.right === doomed) this.deps.player.unequip('right');
        if (hands.left === doomed) this.deps.player.unequip('left');
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
   * is saved. Of two of one shirt, only the copy in use (`thingInUse`) is; the other may be traded. A
   * weapon is in use in the hand that holds that very thing, so two copies of one hilt are both in use.
   */
  inUse(thing: string): 'worn' | 'right' | 'left' | null {
    const it = this.itemOf(thing);
    if (!it) return null;
    if (it.kind === 'wear') return this.thingInUse('wear', it.id) === thing && this.wornPartOf(it.id) ? 'worn' : null;
    const hands = this.thingsInHands();
    if (hands.right === thing) return 'right';
    if (hands.left === thing) return 'left';
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
   * that has gone comes off the body only when no other copy of it is left to wear, and out of a hand
   * only when no other copy is left for that hand. `now` is the server's clock as the list arrives,
   * which a colour stamped here by a clock running fast is held to.
   *
   * Colours are newest-wins both ways: a thing takes the server's unless the one here was set later, and
   * every colour kept here over the server's goes up a moment after (`resend`, paced as a colour set on
   * the page is), so a colour set with nobody answering survives connecting. What is worn is drawn again
   * in whatever colours its copy ends with, which is nothing at all where none moved.
   */
  reconcile(items: readonly ListedItem[], now = Infinity): Promise<string> {
    return this.run('reconcile', DROPPED, async (alive) => {
      await this.itemContext();
      if (!alive()) return DROPPED;
      const rec = this.deps.record();
      if (!rec) return 'no character is being played';
      const had = normalizeOwned(rec.items);
      const handsBefore = this.thingsInHands();
      const paired = pairOwned(had, items, undefined, now);
      const want = paired.items;
      const gone = paired.gone;
      let wornMoved = false;
      let unhanded = false;
      for (const o of gone) {
        // Another copy of it is still owned: the body keeps it on, and that copy is the one worn now.
        if (o.kind !== 'wear' || want.some((w) => w.kind === o.kind && w.id === o.id)) continue;
        if (this.wornPartOf(o.id)) {
          this.takeOff(o.id);
          wornMoved = true;
        }
      }
      // The record's choice of which copy is worn and held follows a thing whose name was the server's
      // to give, so taking the server's name never quietly swaps one shirt for the other. After the
      // taking off above, whose saves still read the list as it was.
      for (const key of ['wornThings', 'heldThings'] as const) {
        const map = rec[key] as Record<string, string> | undefined;
        if (!map) continue;
        for (const id of Object.keys(map)) {
          const to = paired.renamed.get(map[id]);
          if (to) map[id] = to;
        }
      }
      // A hand whose thing has gone, with no other copy of it left for that hand, empties: of two copies
      // of one hilt held one in each hand and one gone, the left lets go and the right keeps its own.
      const e = this.deps.player.equipped;
      const handsAfter = heldThingsOf(want, { right: e.right?.id ?? null, left: e.left?.id ?? null }, rec.heldThings);
      for (const h of ['right', 'left'] as const) {
        if (handsBefore[h] && !handsAfter[h]) {
          this.deps.player.unequip(h);
          unhanded = true;
        }
      }
      rec.items = want;
      this.save({ noGive: true });
      // A colour the server's list brought is drawn now, and the others are told, as a change of clothes is.
      if (this.colourWorn()) wornMoved = true;
      for (const thing of paired.resend) this.tintSoon(thing);
      if (gone.length || paired.came) this.deps.changed('owned');
      if (wornMoved) this.deps.changed('worn');
      if (unhanded) this.deps.changed('held');
      return reconcileWords(paired.came, gone.length);
    });
  }

  /**
   * The saved hands back in them (play(), a species switch), each by its exact id and the very thing it
   * held, the blade left as it was: Player.equip lights a Jedi's blade, and a character arrives as it
   * left, unlit. Two copies of one hilt come back one in each hand. An id the rack lacks is dropped from
   * `held`. The class is not switched: the record's class stands.
   */
  async restoreHeld(opts: { prepare?: boolean } = {}): Promise<void> {
    const rec = this.deps.record();
    const want = { ...(rec?.held ?? {}) };
    if (!want.right && !want.left) return;
    // Which thing was in each hand, read before the first hand's save prunes the choice for the second.
    // With no choice written the rule's own answer is taken now, while both hands are still named, so
    // the left takes the second copy of a hilt the right holds rather than moving the first across.
    const items = rec ? this.namedItems(rec) : [];
    const chosen = heldThingsOf(items, want, rec?.heldThings);
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
      // Owned, but no copy left for this hand (the second of two went while the character was away):
      // the hand stays empty rather than taking the other's across.
      const owned = items.some((o) => o.kind === 'weapon' && o.id === id);
      if (!def || (owned && !chosen[hand])) {
        unknown = true;
        continue;
      }
      const r = await this.hold(def, hand, { prepare: opts.prepare, thing: chosen[hand] ?? undefined });
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
    // Which copy is worn and which thing is in each hand is kept only while that piece is on or that hand
    // holds it, and the thing is still owned. The worn half waits for a wardrobe to have been read (with
    // none, nothing reads as worn), and the hands' for the hands to be the ones the record is about (a
    // resync saves before they are back).
    if (this.lastCtx?.wardrobe) {
      const worn = pruneThings(rec.wornThings, rec.items, 'wear', new Set(this.wornPieces().map((w) => w.id)));
      if (worn) rec.wornThings = worn;
      else delete rec.wornThings;
    }
    if (!opts.keepHands) {
      const hands = pruneHeld(rec.heldThings, rec.items, { right: e.right?.id ?? null, left: e.left?.id ?? null });
      if (hands) rec.heldThings = hands;
      else delete rec.heldThings;
    }
    this.deps.persist(rec);
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
      heldThing: this.thingsInHands(),
      chosen: { worn: { ...(rec?.wornThings ?? {}) }, held: { ...(rec?.heldThings ?? {}) } },
      busy: [...this.busy.keys()],
      inv: rec?.inv ?? null,
      named: rec?.named ?? null,
      tints: rec?.tints ?? null,
      record: rec?.name ?? null,
      species: this.deps.character()?.manifest.id ?? rec?.species ?? '',
      wardrobe: this.lastCtx ? !!this.lastCtx.wardrobe : null,
      weapons: this.lastCtx ? !!this.lastCtx.weapons : null,
    };
  }
}
