// What hangs on a player ship, and on what: the ship's own client data (wings, carriers, on/off
// appearances), each part's own client data in turn (the B-wing body's foils, a turret base's body
// and barrels, an engine's "on" appearance), and the stock parts from the hull's chassis looks table,
// written as a tree the game hangs part by part under the node each one names. Pure: every archive
// read is a callback, so this is testable without the archives.
//
// The rules, in order:
//  1. A client data's children come wings first, then the carriers in file order, then the on/off
//     appearances (clientChildren).
//  2. The hull's children hang on the hull when it carries their hardpoint; one whose hardpoint is not
//     on the hull waits for the stock parts' rounds (rule 5).
//  3. Every node added that has a template (a wing, a CHL2 child, a stock part) has its own client data
//     expanded in turn, to a depth of four.
//  4. A child listed in part P's client data looks for its hardpoint on P itself, then on the parts
//     already hung under P in order (a turret's barrels are on its body, hung just before them), then on
//     the ship as a whole, the hull and then every part in order (noted as "(global)": an engine's ONOF
//     names the hull's engine_on1).
//  5. Stock parts (kind 'component', slot the looks table's column) with no hardpoint hang at the hull's
//     origin; otherwise on the hull, else on the first part that carries it. What nothing carries yet
//     waits for the next round (the Hutt heavy's booster hangs on its engine part); after a round that
//     hangs nothing the rest are noted and left off. Nothing is ever put at the origin for want of its
//     hardpoint. Expanding one part on its own (expandPart), the rest of the ship is not known, so what
//     the part and its subtree do not carry is written by name instead (no `parent`, its hardpoint
//     kept), for the game to find on the whole ship: an engine's "on" appearance on the hull's engine1.
//  6. A node with the same file, parent, hardpoint and place as an earlier one is noted and left out,
//     and the earlier one stays, taking the later one's slot into `sharedWith`; when the earlier one is
//     an on/off appearance and the later a stock part, the node becomes the stock part (always shown).
//  7. An appearance named `..._<slot>_none` (the YT-1300's empty engine slot) is an empty slot's
//     stand-in: written with `standInFor`, never a carrier while a stock part fills that slot, and not
//     shown by the game when a component fills it. A slot counts as filled once its stock part has a
//     template and a model (known before anything hangs, since the hull's children hang first); if the
//     part is then left off for want of its hardpoint, the stand-in is shown after all and may carry
//     (never that slot's own part, which would hide it again).
//  8. Kinds: WING -> 'wing' (`turn` from its DATA; `place` its PSOR, or null with `hardpoint` for HARD);
//     HOBJ, IHOB, CHL2, CHLD -> 'carrier'; ONOF -> 'engine' (`on: 'booster'` when the part listing it
//     fills the booster slot); a stock part -> 'component'.
//  9. A node whose model fails is noted, and its children are not expanded.
//
// Every def assembleShip writes has `parent` a number (an index earlier in the list) or null (the hull),
// never undefined, which the game reads as a def hung by its hardpoint's name anywhere on the ship;
// only expandPart writes such defs, for what its part does not carry (rule 5).

/** The manifest's `assembly` for ships written as a tree by this module. */
export const SHIP_ASSEMBLY_FORMAT = 2;

/** An empty slot's stand-in (`yt1300_engine_none.apt`): the slot it stands for, or null. */
export function standInSlot(appearance) {
  const m = /_(engine|booster|weapon|reactor|shield)_none(\.|$)/i.exec(appearance ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** Ship families whose parts are named otherwise than the ship: the Jedi starfighter's are jedifighter_*. */
export const PART_FAMILY_ALIASES = { jedi_starfighter: 'jedifighter' };

/**
 * The family a ship's parts are named for, from its id (for the old guess by name, used only when a
 * hull has no chassis looks table): the id without its advanced_/basic_/prototype_/player_ prefix and
 * its _modified/_imperial_guard/_longprobe suffix, then PART_FAMILY_ALIASES.
 */
export function partFamilyOf(id) {
  const family = String(id ?? '').replace(/^(advanced|basic|prototype|player)_/, '').replace(/_modified$|_imperial_guard$|_longprobe$/, '');
  return PART_FAMILY_ALIASES[family] ?? family;
}

/** A chassis slot without its index: weapon_0 -> weapon, engine -> engine. */
export function slotBase(slot) {
  return String(slot ?? '').replace(/_\d+$/, '');
}

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\//, '');
/** A float from the archives, to five places (a hundredth of a millimetre; float32 carries no more), never -0. */
const round = (v) => {
  const r = Math.round(Number(v) * 1e5) / 1e5;
  return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r;
};
const placeOf = (p) => (Array.isArray(p) && p.length ? [0, 1, 2, 3, 4, 5].map((i) => round(p[i] ?? 0)) : null);
const KINDS = { WING: 'wing', HOBJ: 'carrier', IHOB: 'carrier', CHL2: 'carrier', CHLD: 'carrier', ONOF: 'engine', chassis: 'component' };

/**
 * A parsed client data (shipdata.mjs parseClientData) as assembly children, in rule 1's order:
 * { source: 'WING'|'HOBJ'|'IHOB'|'CHL2'|'CHLD'|'ONOF', template?, appearance?, hardpoint, place, turn?, sound? }.
 */
export function clientChildren(data) {
  if (!data) return [];
  return [
    ...(data.wings ?? []).map((w) => ({ source: 'WING', template: norm(w.template), hardpoint: w.hardpoint || null, place: w.hinge ?? null, turn: { angle: w.angle ?? 0, time: w.time ?? 0 }, sound: w.sounds?.[0] ?? null })),
    ...(data.children ?? []).map((c) => ({ source: c.source, ...(c.template ? { template: norm(c.template) } : { appearance: norm(c.appearance) }), hardpoint: c.hardpoint || null, place: c.place ?? null })),
    ...(data.onOff ?? []).map((o) => ({ source: 'ONOF', appearance: norm(o.appearance), hardpoint: o.hardpoint || null, place: null })),
  ];
}

const short = (p) => norm(p).replace(/^object\/tangible\/ship\/attachment\/(\w+\/)?shared_/, '').replace(/^appearance\//, '');
const label = (d) => (d.source === 'chassis' ? `chassis ${d.slot}: ${d.attachment ?? short(d.template)}` : `${d.source} ${short(d.template ?? d.appearance)}`);

/**
 * The shared walk behind assembleShip and expandPart. `root` is the hull (or the part being expanded):
 * its hardpoints, its client data's children, and what to call it in the notes. `byName` (expandPart:
 * { self: { template, hardpoint }, ship: Set | null }): what nothing under the root carries is written by
 * name rather than left off (assembleShip passes false).
 */
function assemble(rootHardpoints, rootChildren, stock, deps, { maxDepth = 4, startDepth = 1, rootName = 'hull', rootSlot = null, byName = false } = {}) {
  const defs = [];
  const hps = [];
  const notes = [];
  const seen = new Map();
  const rootHps = new Set(rootHardpoints ?? []);
  /** A model for a desc, or null with the failure noted (rule 9). */
  const modelFor = (d) => {
    let m;
    try {
      m = deps.model(d);
    } catch (err) {
      m = { skip: err.message };
    }
    if (!m || m.skip || !m.file) {
      notes.push(`${label(d)}: ${m?.skip ?? 'no model'}`);
      return null;
    }
    return m;
  };
  // The stock parts, their models resolved before anything hangs: a slot is filled (rule 7) only by a
  // part that has a template and a model, which is the rule the game and status use (a component def
  // in the list), and the hull's children, which hang first, must already know it.
  const stockItems = [];
  const stockSlots = new Set();
  for (const p of stock ?? []) {
    const template = deps.templateOf(p.attachment);
    if (!template) {
      notes.push(`chassis ${p.slot}: ${p.attachment} has no template`);
      continue;
    }
    const desc = { source: 'chassis', slot: p.slot, attachment: p.attachment, template: norm(template), hardpoint: p.hardpoint || null, place: null };
    const model = modelFor(desc);
    if (!model) continue;
    stockItems.push({ desc, model, lister: null, depth: startDepth, owner: null });
    stockSlots.add(slotBase(p.slot));
  }
  const filled = new Set(stockSlots);
  if (rootSlot) filled.add(slotBase(rootSlot));
  // A stand-in for a slot a stock part fills is never shown, so nothing may hang on it.
  const carries = (i, hp) => hps[i].has(hp) && !(defs[i].standInFor && filled.has(defs[i].standInFor));
  const under = (i, anc) => {
    if (anc === null) return true;
    for (let q = defs[i].parent; q !== null && q !== undefined; q = defs[q].parent) if (q === anc) return true;
    return false;
  };
  /** Rule 4: where a hardpoint listed by `lister` (null: the root) hangs, or null when nothing carries it yet. */
  const lookup = (hp, lister) => {
    if (!hp) return { parent: lister };
    if (lister === null ? rootHps.has(hp) : carries(lister, hp)) return { parent: lister };
    for (let i = 0; i < defs.length; i++) if (i !== lister && carries(i, hp) && under(i, lister)) return { parent: i };
    if (rootHps.has(hp)) return { parent: null, global: true };
    for (let i = 0; i < defs.length; i++) if (carries(i, hp)) return { parent: i, global: true };
    return null;
  };
  /** The slot of the part whose client data listed a node: the part's own, else the stock part it came from. */
  const slotOfLister = (lister) => {
    if (lister === null) return rootSlot;
    const d = defs[lister];
    return d.slot ?? (d.owner !== undefined ? defs[d.owner]?.slot : null) ?? null;
  };
  let pending = [];
  const expand = (i, depth, owner) => {
    const def = defs[i];
    if (!def.template || depth > maxDepth) return;
    let children = [];
    try {
      children = deps.childrenOf(def.template) ?? [];
    } catch (err) {
      notes.push(`${short(def.template)}: client data not read (${err.message})`);
    }
    for (const c of children) offer({ desc: c, lister: i, depth: depth + 1, owner });
  };
  /**
   * Hang an item under `parent` (a def's index, null for the root, undefined for by name). `note` is
   * written only when the item is hung, beside its node rather than before a refusal. Returns whether
   * a node was hung (a duplicate left out or a failed model is not).
   */
  const add = (item, parent, note) => {
    const d = item.desc;
    const m = item.model ?? modelFor(d);
    if (!m) return false;
    const hardpoint = d.hardpoint || null;
    const place = placeOf(d.place);
    const key = JSON.stringify([m.file, parent === undefined ? 'by name' : parent, hardpoint, place]);
    if (seen.has(key)) {
      const at = seen.get(key);
      const first = defs[at];
      if (d.source === 'chassis' && first.source === 'ONOF') {
        // The stock part is always shown; its own "on" appearance is not: the node becomes the part.
        if (note) notes.push(note);
        notes.push(`duplicate ${m.file} @${hardpoint ?? 'origin'}: the ONOF there is the ${d.slot} part itself, kept as the part`);
        first.kind = 'component';
        first.source = 'chassis';
        first.template = d.template;
        first.slot = d.slot;
        delete first.on;
        delete first.owner;
        expand(at, item.depth, at);
        return true;
      }
      notes.push(`duplicate ${m.file} @${hardpoint ?? 'origin'}${d.slot ? ` (${d.slot})` : ''} left out; kept ${first.slot ?? first.source}`);
      if (d.slot && d.slot !== first.slot && !(first.sharedWith ?? []).includes(d.slot)) (first.sharedWith ??= []).push(d.slot);
      return false;
    }
    if (note) notes.push(note);
    const kind = KINDS[d.source] ?? 'carrier';
    const def = { kind, source: d.source, file: m.file };
    if (d.template) def.template = norm(d.template);
    const appearance = norm(m.appearance ?? d.appearance ?? '');
    if (appearance) def.appearance = appearance;
    if (parent !== undefined) def.parent = parent;
    def.hardpoint = hardpoint;
    def.place = place;
    if (kind === 'wing') {
      def.turn = { angle: round(d.turn?.angle ?? 0), time: round(d.turn?.time ?? 0) };
      def.sound = d.sound ?? null;
    }
    if (kind === 'engine') def.on = slotBase(slotOfLister(item.lister)) === 'booster' ? 'booster' : 'engine';
    if (kind === 'component') def.slot = d.slot;
    if (item.owner !== null && item.owner !== undefined) def.owner = item.owner;
    const stands = kind === 'component' ? null : standInSlot(appearance);
    if (stands) def.standInFor = stands;
    const i = defs.length;
    defs.push(def);
    hps.push(new Set(m.hardpoints ?? []));
    seen.set(key, i);
    expand(i, item.depth, kind === 'component' ? i : item.owner);
  };
  /** Hang one item now (or refuse it for good: a duplicate, a failed model), or say it must wait for a carrier. */
  const hang = (item) => {
    const at = lookup(item.desc.hardpoint, item.lister);
    if (!at) return false;
    add(item, at.parent, at.global ? `(global) ${label(item.desc)} @${item.desc.hardpoint} -> ${at.parent === null ? rootName : defs[at.parent].file}` : null);
    return true;
  };
  function offer(item) {
    if (!hang(item)) pending.push(item);
  }
  /** Rule 5's rounds over `first`, then whatever waits for a carrier, until a round hangs nothing: what is left. */
  const settle = (first) => {
    let queue = [...first, ...pending];
    pending = [];
    while (queue.length) {
      let resolved = 0;
      for (const item of queue) {
        if (hang(item)) resolved++;
        else pending.push(item);
      }
      queue = pending;
      pending = [];
      if (!resolved) break;
    }
    return queue;
  };

  for (const c of rootChildren ?? []) offer({ desc: c, lister: null, depth: startDepth, owner: null });
  // The stock parts in column order, then whatever still waits for a carrier.
  let left = settle(stockItems);
  // A slot counted filled whose part was left off for want of its hardpoint: its stand-in is shown after
  // all (standInHidden finds no component for it), so it may carry what waits for it.
  const rootBase = rootSlot ? slotBase(rootSlot) : null;
  const unhung = defs.filter((d) => d.standInFor && d.standInFor !== rootBase && filled.has(d.standInFor) && !standInHidden(d, defs)).map((d) => d.standInFor);
  if (unhung.length) {
    const empty = new Set(unhung);
    for (const s of empty) {
      filled.delete(s);
      notes.push(`the ${s} part was not hung: its stand-in is shown and carries`);
    }
    // The slot's own part stays off: hung on its stand-in now, it would hide the node it hangs on.
    const own = left.filter((item) => item.desc.source === 'chassis' && empty.has(slotBase(item.desc.slot)));
    left = [...own, ...settle(left.filter((item) => !own.includes(item)))];
  }
  // Expanding one part: what nothing under it carries is on the rest of the ship, found there by name;
  // unless the ship's hardpoints are given and it is not among them, or it is the part itself again.
  let selfFile;
  const isSelf = (item, m) => {
    if (!byName.self || placeOf(item.desc.place)) return false;
    if (byName.self.hardpoint !== undefined && byName.self.hardpoint !== item.desc.hardpoint) return false;
    if (selfFile === undefined) {
      try {
        selfFile = deps.model({ source: 'chassis', template: byName.self.template })?.file ?? null;
      } catch {
        selfFile = null;
      }
    }
    return !!selfFile && m.file === selfFile;
  };
  while (byName && left.length) {
    const offCarrier = [];
    for (const item of left) {
      if (byName.ship && !byName.ship.has(item.desc.hardpoint)) {
        offCarrier.push(item);
        continue;
      }
      const m = item.model ?? modelFor(item.desc);
      if (!m) continue;
      item.model = m;
      if (isSelf(item, m)) {
        // An engine whose own "on" appearance is its own model on its own hardpoint (the rebel gunship's).
        notes.push(`duplicate ${m.file} @${item.desc.hardpoint}: the part itself, left out`);
        continue;
      }
      add(item, undefined, `(global) ${label(item.desc)} @${item.desc.hardpoint} -> not on the ${rootName}, hung by name`);
    }
    for (const item of offCarrier) notes.push(`${label(item.desc)}: hardpoint ${item.desc.hardpoint} carried by nothing on the ship, left off`);
    left = settle([]);
  }
  for (const item of left) notes.push(`${label(item.desc)}: hardpoint ${item.desc.hardpoint} carried by nothing, left off`);
  for (const d of defs) if (standInHidden(d, defs)) notes.push(`stand-in ${short(d.appearance)}: not shown, the ${d.standInFor} slot is filled`);
  const carried = new Set(rootHps);
  for (const s of hps) for (const h of s) carried.add(h);
  return { attachments: defs, notes, carried: [...carried] };
}

/**
 * What hangs on a ship and on what. Returns { attachments, notes, carried }: the attachments in hanging
 * order (a part's parent always comes before it), each an AttachmentDef with `parent` a number or null;
 * `carried` every hardpoint name on the hull and the parts hung (for the old guess by name).
 *
 * hull:         { hardpoints: string[] }
 * hullChildren: the hull's client data as children (clientChildren)
 * stock:        [{ slot, attachment, hardpoint }] (modalLooks' pairs, in column and cell order)
 * deps.childrenOf(template) -> children[] of a template's client data ([] when none)
 * deps.model(desc) -> { file, hardpoints, appearance } | { skip }   (converts; desc has template or appearance)
 * deps.templateOf(attachmentName) -> template path | null
 */
export function assembleShip(hull, hullChildren, stock, deps, { maxDepth = 4 } = {}) {
  return assemble(hull?.hardpoints ?? [], hullChildren, stock, deps, { maxDepth, startDepth: 1, rootName: 'hull' });
}

/**
 * One part's own subtree (its client data's children, recursively), parents relative to the part
 * (null = the part itself): what is hung under a part swapped in by hand. `slot` is the part's chassis
 * slot, which decides whether its on/off appearances show while boosting. The part stands where a
 * stock part would, so its children go as deep as they would under assembleShip.
 * A child whose hardpoint neither the part nor anything hung under it carries (the Y-wing engine's
 * "on" appearance on the hull's engine1, the V-wing engine's glow on the hull's wing1) is written by
 * name: no `parent`, its `hardpoint` kept, for the caller to hang anywhere on the ship once the ship's
 * other parts are on; its own children, if any, name it as their parent as usual. Two such children are
 * left off instead, with a note, as assembleShip leaves them off:
 *  - `shipHardpoints` given (every hardpoint the hull and any part that can be fitted carry) and the
 *    hardpoint not among them (the TIE Aggressor turret's barrel, whose turretbarrel1 nothing carries);
 *  - the part itself again: its own model on the hardpoint it hangs at (`hardpoint`; any hardpoint when
 *    that is not given), at no place of its own (the rebel gunship engine's ONOF on engine_on1).
 * Returns { attachments, notes, carried } as assembleShip does.
 */
export function expandPart(template, hardpoints, deps, { maxDepth = 4, slot = null, hardpoint, shipHardpoints = null } = {}) {
  let children = [];
  try {
    children = deps.childrenOf(template) ?? [];
  } catch (err) {
    return { attachments: [], notes: [`${short(template)}: client data not read (${err.message})`], carried: [...(hardpoints ?? [])] };
  }
  const byName = { self: { template: norm(template), hardpoint: hardpoint === undefined ? undefined : hardpoint || null }, ship: shipHardpoints ? new Set(shipHardpoints) : null };
  return assemble(hardpoints ?? [], children, [], deps, { maxDepth, startDepth: 2, rootName: 'part', rootSlot: slot, byName });
}

/** Whether the game leaves a stand-in out: a component def in the same list fills the slot it stands for. */
export function standInHidden(def, defs) {
  return !!def?.standInFor && defs.some((d) => d.kind === 'component' && slotBase(d.slot) === def.standInFor);
}

/**
 * Counts of a ship's attachments: `hung` is what the game shows (every def but a stand-in whose slot
 * is filled), `nested` the wings hung on a wing, `opening` the wings that turn, `onWings` the other
 * nodes with a wing among their ancestors (tree defs only).
 */
export function assemblyCounts(attachments) {
  const list = attachments ?? [];
  const isWing = (i) => list[i]?.kind === 'wing';
  const wingAbove = (a) => {
    for (let q = a.parent, n = 0; q !== null && q !== undefined && n <= list.length; q = list[q]?.parent, n++) if (isWing(q)) return true;
    return false;
  };
  const standIns = list.filter((a) => standInHidden(a, list)).length;
  return {
    hung: list.length - standIns,
    wings: list.filter((a) => a.kind === 'wing').length,
    nested: list.filter((a) => a.kind === 'wing' && typeof a.parent === 'number' && isWing(a.parent)).length,
    opening: list.filter((a) => a.kind === 'wing' && (a.turn?.angle ?? a.angle)).length,
    carriers: list.filter((a) => a.kind === 'carrier').length,
    onOff: list.filter((a) => a.kind === 'engine').length,
    parts: list.filter((a) => a.kind === 'component').length,
    onWings: list.filter((a) => a.kind !== 'wing' && wingAbove(a)).length,
    standIns,
  };
}

/** The ships log's clause for what hangs on a ship. */
export function hungSummary(attachments) {
  const list = attachments ?? [];
  const c = assemblyCounts(list);
  const turns = [...new Set(list.filter((a) => a.kind === 'wing' && (a.turn?.angle ?? a.angle)).map((a) => `${a.turn?.angle ?? a.angle}° in ${a.turn?.time ?? a.time} s`))];
  const parts = list.filter((a) => a.kind === 'component').map((a) => `${a.slot} at ${a.hardpoint ?? 'the origin'}`);
  return `${c.wings} wings (${c.nested} on wings, ${c.opening} that open${turns.length ? `: ${turns.join(', ')}` : ''}), ${c.carriers} carriers, ${c.onOff} on/off appearances, ${c.parts} parts (${parts.join(', ') || 'none'})${c.onWings ? `, ${c.onWings} riding a wing` : ''}${c.standIns ? `, ${c.standIns} stand-in${c.standIns > 1 ? 's' : ''} for a filled slot` : ''}`;
}

/**
 * The ships pack's assembly as status reads it, decided per ship so no partial run can hide an old
 * one: `hung` (what the game shows, over every ship), `winged` (ships with a wing that opens), `old`
 * (ships converted before the tree was written: no `chassis` key).
 */
export function assemblyStatus(manifest) {
  const ships = manifest?.ships ?? [];
  return {
    hung: ships.reduce((n, sh) => n + assemblyCounts(sh.attachments).hung, 0),
    winged: ships.filter((sh) => (sh.attachments ?? []).some((a) => a.kind === 'wing' && a.turn?.angle)).length,
    old: ships.filter((sh) => !('chassis' in sh)).length,
  };
}
