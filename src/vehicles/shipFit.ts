// A ship's fit: the components in its chassis slots, its droid or flight computer and its paint,
// as the ships pack describes them (components.json, and each ship's `fit` in the manifest) and as
// a character keeps them (a component name per slot, paint values, a droid id; anything absent is
// stock). A saved fit is resolved against the hull before anything is built from it, so a name the
// pack no longer has, a component the slot does not take or a value out of range falls back to
// stock with a note rather than breaking the ship. Pure: no three, no DOM, loadable by the node tests.
import type { AttachmentDef } from './shipAssembly.ts';

export interface ComponentWeapon { projectile: number; speed: number; range: number; missile?: 1; countermeasure?: 1; tractor?: 1; beam?: 1; mining?: 1 }
/** One row of the game's component table (components.json; its index there is what a look lists). */
export interface ComponentDef { name: string; type: string; compat: string; label: string; template: string; weapon?: ComponentWeapon }
/** A droid for the astromech socket, or a flight computer (no model); `heads` replaces the model per ship (the N-1's droid head). */
export interface DroidDef { id: string; kind: 'astromech' | 'computer'; label: string; model: string | null; heads?: Record<string, string> }
/** A part a look hangs: its model in the ships pack, the hardpoint it hangs at, its template, and what its own client data hangs on it (parents relative to the part, null: the part; no parent: hung by name anywhere on the ship). */
export interface FitPart { file: string; hardpoint: string; template: string; children?: AttachmentDef[] }
/** One look of a slot on this hull: the parts it shows and the components (indices into components.json) that show it. */
export interface FitLook { parts: FitPart[]; components: number[]; noModel?: true }
/** A chassis slot: its compatibility classes, its looks, its stock component (null: empty), and whether it is fixed (the Star Destroyer's turret bases: never offered, always stock). */
export interface FitSlot { slot: string; compat: string[]; looks: FitLook[]; stock: string | null; fixed?: true }
export interface PaintVariable { name: string; kind: 'index' | 'palette'; count?: number; fewest?: number; palette?: string; size?: number; default: number }
export interface FitPaint { shaders: string[]; variables: PaintVariable[] }
/** What the ships pack says of a hull's fit. */
export interface FitDef { chassis: string; openSpeedFactor?: number; droid: 'astromech' | 'computer'; slots: FitSlot[]; paint: FitPaint | null }
/** What a character keeps per ship id: a component per slot ('' = left empty), paint values, and the droid; anything absent is stock. */
export interface ShipFit { components: Record<string, string>; paint: Record<string, number>; droid?: string }
/** A fit checked against the hull: every slot filled in (null = empty), its look (-1 = no model), every paint variable, the droid. */
export interface ResolvedFit { components: Record<string, string | null>; looks: Record<string, number>; paint: Record<string, number>; painted: boolean; droid: string | null; notes: string[] }
/** A part to hang: its GLB under assets-private/, its hardpoint ('' = the model's origin), its slot, whether it is skinned (a droid), and its own children (files under assets-private/ too). */
export interface PlacedPart { slot: string; path: string; hardpoint: string; template: string; skinned?: true; children?: AttachmentDef[] }

/** The most a saved fit (and the relay's copy of it) carries: slots, the length of a component name, paint values, the length of a droid id. */
export const FIT_LIMITS = { slots: 24, name: 64, paint: 8, droid: 32 };
/** Test and placeholder components: never offered, never stock (the converter's rule). */
export const HIDDEN_COMPONENT = /(^|_)test(_|$)/;

const SLOT_KEY = /^[a-z0-9_]+$/;
const NAME = /^[a-z0-9_]*$/;
const PAINT_KEY = /^[A-Za-z0-9_/]+$/;
const SLOT_KEY_MAX = 24;
const PAINT_KEY_MAX = 40;

/** Component names to their index in components.json. */
export function componentIndex(list: ComponentDef[]): Map<string, number> {
  const out = new Map<string, number>();
  list.forEach((c, i) => {
    if (!out.has(c.name)) out.set(c.name, i);
  });
  return out;
}

/** The compatibility classes a component carries (one, or a comma list), cleaned as the converter cleans a chassis cell. */
function classesOf(compat: string): string[] {
  return String(compat ?? '')
    .split(',')
    .map((s) => s.trim().replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);
}

/** Why a component cannot go in a slot, or null when it can. */
function refusal(name: string, slot: FitSlot, components: ComponentDef[], index: Map<string, number>): string | null {
  if (HIDDEN_COMPONENT.test(name)) return 'is a test component';
  const i = index.get(name);
  if (i === undefined) return 'is not in the pack';
  if (!classesOf(components[i].compat).some((c) => slot.compat.includes(c))) return `does not fit (${components[i].compat}; the slot takes ${slot.compat.join(', ') || 'nothing'})`;
  return null;
}

/** A value within a variable's range: a whole number, clamped (an index to its choices, a palette to its colours). */
function clampVariable(v: PaintVariable, value: number): number {
  const n = Math.round(value);
  const top = v.kind === 'index' ? Math.max(1, v.count ?? 1) - 1 : Math.max(1, v.size ?? 256) - 1;
  return n < 0 ? 0 : n > top ? top : n;
}

/**
 * A saved fit checked against the hull. A saved component is used when the pack has it, it is not a test
 * component and the slot takes its class; '' leaves the slot empty; anything else, and every slot not
 * saved, is stock. A fixed slot is always stock. A saved slot the hull lacks is dropped. The droid is
 * used when the pack has it and it is the hull's kind (an astromech for a socket, a computer otherwise);
 * none is stock. Paint values are clamped to their variable, the rest are the defaults.
 */
export function resolveFit(def: FitDef, components: ComponentDef[], index: Map<string, number>, droids: DroidDef[], saved: ShipFit | null): ResolvedFit {
  const notes: string[] = [];
  const out: ResolvedFit = { components: {}, looks: {}, paint: {}, painted: false, droid: null, notes };
  const savedComponents = saved?.components && typeof saved.components === 'object' ? saved.components : {};
  for (const s of def.slots) {
    let name: string | null = s.stock;
    const want = Object.prototype.hasOwnProperty.call(savedComponents, s.slot) ? savedComponents[s.slot] : undefined;
    if (!s.fixed && typeof want === 'string') {
      if (want === '') name = null;
      else {
        const why = refusal(want, s, components, index);
        if (why) notes.push(`${s.slot}: ${want} ${why}; stock instead`);
        else name = want;
      }
    } else if (s.fixed && want !== undefined && want !== s.stock) notes.push(`${s.slot}: a fixed slot, always stock`);
    out.components[s.slot] = name;
    out.looks[s.slot] = name === null ? -1 : lookOf(def, s.slot, index.get(name) ?? -1);
  }
  for (const k of Object.keys(savedComponents)) if (!def.slots.some((s) => s.slot === k)) notes.push(`${k}: the hull has no such slot; dropped`);
  const wantDroid = typeof saved?.droid === 'string' ? saved.droid : '';
  if (wantDroid) {
    const d = droids.find((x) => x.id === wantDroid);
    if (!d) notes.push(`droid ${wantDroid} is not in the pack; none`);
    else if (d.kind !== def.droid) notes.push(`droid ${wantDroid} is ${d.kind === 'astromech' ? 'an astromech' : 'a flight computer'}, and this hull takes ${def.droid === 'astromech' ? 'an astromech' : 'a flight computer'}; none`);
    else out.droid = d.id;
  }
  const savedPaint = saved?.paint && typeof saved.paint === 'object' ? saved.paint : {};
  for (const v of def.paint?.variables ?? []) {
    const raw = savedPaint[v.name];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? clampVariable(v, raw) : v.default;
    out.paint[v.name] = value;
    if (value !== v.default) out.painted = true;
  }
  for (const k of Object.keys(savedPaint)) if (!(def.paint?.variables ?? []).some((v) => v.name === k)) notes.push(`paint ${k}: the hull has no such variable; dropped`);
  return out;
}

/** The fit a ship has before anyone changes it: everything stock. */
export function stockFit(): ShipFit {
  return { components: {}, paint: {} };
}

/** Which look of a slot a component shows (-1 when none: no model on this hull, an unknown component, or no such slot). */
export function lookOf(def: FitDef, slot: string, componentIdx: number): number {
  if (componentIdx < 0) return -1;
  const s = def.slots.find((x) => x.slot === slot);
  if (!s) return -1;
  return s.looks.findIndex((l) => l.components.includes(componentIdx));
}

const inPack = (file: string): string => (/^(ships|mobiles)\//.test(file) ? file : `ships/${file}`);

/**
 * Every part the fit hangs: each filled slot's look parts, fixed slots included, in slot order, as
 * `ships/<file>`, their children with their files the same way; then the droid's, when the hull has a
 * socket and a droid is chosen with a model: the ship's own head for it (the N-1's), else the droid's own
 * skinned model, at the `astromech` hardpoint. A flight computer shows nothing.
 */
export function partsOf(def: FitDef, garageId: string, fit: ResolvedFit, droids: DroidDef[]): PlacedPart[] {
  const out: PlacedPart[] = [];
  for (const s of def.slots) {
    if (!fit.components[s.slot]) continue;
    const look = s.looks[fit.looks[s.slot] ?? -1];
    if (!look || look.noModel) continue;
    for (const p of look.parts) {
      const part: PlacedPart = { slot: s.slot, path: inPack(p.file), hardpoint: p.hardpoint ?? '', template: p.template ?? '' };
      if (p.children?.length) part.children = p.children.map((c) => ({ ...c, file: inPack(c.file) }));
      out.push(part);
    }
  }
  if (def.droid === 'astromech' && fit.droid) {
    const d = droids.find((x) => x.id === fit.droid);
    if (d && d.kind === 'astromech') {
      const head = d.heads?.[garageId];
      if (head) out.push({ slot: 'droid', path: inPack(head), hardpoint: 'astromech', template: '' });
      else if (d.model) out.push({ slot: 'droid', path: d.model, hardpoint: 'astromech', template: '', skinned: true });
    }
  }
  return out;
}

/** The slots whose look differs between two fits of one hull, then 'droid' when the droid does: what a refit takes down and hangs. */
export function changedSlots(def: FitDef, a: ResolvedFit, b: ResolvedFit): string[] {
  const out: string[] = [];
  for (const s of def.slots) {
    const la = a.components[s.slot] ? (a.looks[s.slot] ?? -1) : -1;
    const lb = b.components[s.slot] ? (b.looks[s.slot] ?? -1) : -1;
    if (la !== lb) out.push(s.slot);
  }
  if ((a.droid ?? null) !== (b.droid ?? null)) out.push('droid');
  return out;
}

/** Whether two fits wear the same paint (the values only). */
export function samePaint(a: ResolvedFit, b: ResolvedFit): boolean {
  const keys = new Set([...Object.keys(a.paint), ...Object.keys(b.paint)]);
  for (const k of keys) if (a.paint[k] !== b.paint[k]) return false;
  return true;
}

/** Whether paint values are the hull's stock (every variable at its default; one not given counts as its default). */
export function paintIsDefault(paint: FitPaint | null, values: Record<string, number>): boolean {
  for (const v of paint?.variables ?? []) {
    const x = values[v.name];
    if (x !== undefined && x !== v.default) return false;
  }
  return true;
}

export function isDefaultPaint(def: FitDef, values: Record<string, number>): boolean {
  return paintIsDefault(def.paint, values);
}

/** A weapon that fires bolts (not a missile, countermeasures, a tractor or a beam). */
function isBolt(w: ComponentWeapon | undefined): w is ComponentWeapon {
  return !!w && !w.missile && !w.countermeasure && !w.tractor && !w.beam;
}

/** The first weapon slot (in the hull's slot order) whose component fires bolts: what a gun on the hull itself fires. Null when none does. */
export function boltSlotOf(components: ComponentDef[], index: Map<string, number>, fit: ResolvedFit): string | null {
  for (const [slot, name] of Object.entries(fit.components)) {
    if (!slot.startsWith('weapon') || !name) continue;
    const i = index.get(name);
    if (i !== undefined && isBolt(components[i]?.weapon)) return slot;
  }
  return null;
}

/**
 * What a gun in a slot fires: its component's weapon row (projectile, speed, range) with its name; null for
 * an empty slot, a component that is not a weapon, a missile launcher or countermeasures (a tractor or a
 * beam likewise). A gun on the hull itself (slot null), or on a part of a slot that is not a weapon slot,
 * fires what the fallback slot fires.
 */
export function gunWeapon(components: ComponentDef[], index: Map<string, number>, fit: ResolvedFit, slot: string | null, fallbackSlot: string | null): (ComponentWeapon & { name: string }) | null {
  const s = slot && slot.startsWith('weapon') ? slot : fallbackSlot;
  if (!s) return null;
  const name = fit.components[s];
  if (!name) return null;
  const i = index.get(name);
  const w = i === undefined ? undefined : components[i]?.weapon;
  if (!isBolt(w)) return null;
  return { ...w, name };
}

const SLOT_WORDS: Record<string, string> = {
  reactor: 'Reactor',
  engine: 'Engine',
  capacitor: 'Capacitor',
  booster: 'Booster',
  droid_interface: 'Droid interface',
  bridge: 'Bridge',
  hangar: 'Hangar',
  targeting_station: 'Targeting station',
  cargo_hold: 'Cargo hold',
};

/** A slot's name for the page: 'Engine', 'Shield 1', 'Weapon 2', 'Missile launcher', 'Countermeasures', 'Modification 1' … */
export function slotLabel(slot: FitSlot): string {
  const s = slot.slot;
  if (SLOT_WORDS[s]) return SLOT_WORDS[s];
  const m = /^([a-z_]+?)_(\d+)$/.exec(s);
  const n = m ? Number(m[2]) + 1 : 0;
  const base = m ? m[1] : s;
  if (base === 'weapon') {
    const stock = slot.stock ?? '';
    if (slot.compat.length && slot.compat.every((c) => /^cms/.test(c))) return 'Countermeasures';
    if (/countermeasure|(^|_)cm_|chaff|flare/.test(stock)) return 'Countermeasures';
    if (/launcher|missile|torpedo|rocket/.test(stock)) return 'Missile launcher';
    return `Weapon ${n}`;
  }
  const words: Record<string, string> = { shield: 'Shield', armor: 'Armour', modification: 'Modification' };
  if (words[base]) return `${words[base]} ${n}`;
  const text = s.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A pattern choice for the page: 'Pattern 3 of 8', with '(some parts have 2)' when the hull's shaders disagree on the count. */
export function patternLabel(v: PaintVariable, value: number): string {
  const count = Math.max(1, v.count ?? 1);
  const fewer = v.fewest !== undefined && v.fewest < count ? ` (some parts have ${v.fewest})` : '';
  return `Pattern ${clampVariable(v, value) + 1} of ${count}${fewer}`;
}

/** A saved fit within FIT_LIMITS: names that are names, whole paint values 0..255, and a droid id; what the relay's cleanShip accepts. */
export function packFit(fit: ShipFit): ShipFit {
  const components: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(fit?.components ?? {})) {
    if (n >= FIT_LIMITS.slots) break;
    if (typeof k !== 'string' || k.length > SLOT_KEY_MAX || !SLOT_KEY.test(k)) continue;
    if (typeof v !== 'string' || v.length > FIT_LIMITS.name || !NAME.test(v)) continue;
    components[k] = v;
    n++;
  }
  const paint: Record<string, number> = {};
  n = 0;
  for (const [k, v] of Object.entries(fit?.paint ?? {})) {
    if (n >= FIT_LIMITS.paint) break;
    if (typeof k !== 'string' || k.length > PAINT_KEY_MAX || !PAINT_KEY.test(k)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    paint[k] = Math.min(255, Math.max(0, Math.round(v)));
    n++;
  }
  const out: ShipFit = { components, paint };
  const d = fit?.droid;
  if (typeof d === 'string' && d && d.length <= FIT_LIMITS.droid && NAME.test(d)) out.droid = d;
  return out;
}

/** A key that is the same for two fits exactly when they build the same ship: sorted slots, sorted paint variables, the droid. */
export function fitKey(fit: ResolvedFit): string {
  const comps = Object.keys(fit.components)
    .sort()
    .map((k) => `${k}=${fit.components[k] ?? ''}`)
    .join(',');
  const paint = Object.keys(fit.paint)
    .sort()
    .map((k) => `${k}=${fit.paint[k]}`)
    .join(',');
  return `c:${comps};p:${paint};d:${fit.droid ?? ''}`;
}
