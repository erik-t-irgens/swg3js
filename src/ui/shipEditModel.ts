// The ship edit page's rules, apart from its DOM so the node tests can hold them: which components a
// slot offers and how they are grouped (by the look each shows on this hull, "No model on this hull",
// "(empty)" last), what a pick keeps (the stock component and the shader's own default are kept as
// absent: absent is stock), and the words beside each row. Pure: no three, no DOM.
import { HIDDEN_COMPONENT, patternLabel, slotLabel, type ComponentDef, type FitDef, type FitSlot, type PaintVariable, type ShipFit } from '../vehicles/shipFit.ts';

/** One entry of a slot's select. */
export interface SlotOption {
  name: string;
  label: string;
  stock: boolean;
  selected: boolean;
}

/** A group of a slot's select (label null: no optgroup, the options stand alone). */
export interface SlotGroup {
  label: string | null;
  options: SlotOption[];
}

/** What a slot's select lists: the groups, a fitted component the lists do not carry (null: none), and whether "(empty)" is the one selected. */
export interface SlotChoices {
  groups: SlotGroup[];
  extra: string | null;
  emptySelected: boolean;
}

/** The compatibility classes a component carries (one, or a comma list), cleaned as `resolveFit` cleans them. */
function classesOf(compat: string): string[] {
  return String(compat ?? '')
    .split(',')
    .map((s) => s.trim().replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);
}

/**
 * A slot's choices: one group per look ("Look 2 (115)", or "Look 3 (no model)"), then the components the
 * slot takes that no look lists ("No model on this hull"; standing alone on a slot with no looks). A test
 * component is never offered. `current` is the fitted component (null: empty); a fitted one no list
 * carries is named in `extra` so the select still says what is fitted.
 */
export function slotChoices(slot: FitSlot, components: ComponentDef[], current: string | null): SlotChoices {
  const inLook = new Set<number>();
  const listed = new Set<string>();
  const option = (i: number): SlotOption | null => {
    const c = components[i];
    if (!c || HIDDEN_COMPONENT.test(c.name)) return null;
    listed.add(c.name);
    return { name: c.name, label: c.label, stock: c.name === slot.stock, selected: c.name === current };
  };
  const groups: SlotGroup[] = [];
  slot.looks.forEach((look, i) => {
    for (const idx of look.components) inLook.add(idx);
    const options = look.components.map(option).filter((o): o is SlotOption => o !== null);
    groups.push({ label: look.noModel ? `Look ${i + 1} (no model)` : `Look ${i + 1} (${look.components.length})`, options });
  });
  const loose: SlotOption[] = [];
  components.forEach((c, i) => {
    if (inLook.has(i) || !classesOf(c.compat).some((k) => slot.compat.includes(k))) return;
    const o = option(i);
    if (o) loose.push(o);
  });
  if (loose.length) groups.push({ label: slot.looks.length ? 'No model on this hull' : null, options: loose });
  return { groups, extra: current !== null && !listed.has(current) ? current : null, emptySelected: current === null };
}

/** The page's sections: how many slots are fixed, the slots that change the look (they have looks), and the systems (no looks). */
export function slotSections(fd: FitDef): { fixed: number; visual: FitSlot[]; systems: FitSlot[] } {
  return {
    fixed: fd.slots.filter((s) => s.fixed).length,
    visual: fd.slots.filter((s) => !s.fixed && s.looks.length > 0),
    systems: fd.slots.filter((s) => !s.fixed && s.looks.length === 0),
  };
}

/**
 * A component (or the droid, slot 'droid') picked on a fit, in place: '' leaves a slot empty and takes the
 * droid out; the stock component is kept as absent. False for a slot the hull does not have or one that is
 * fixed (nothing changes).
 */
export function pickComponent(fit: ShipFit, fd: FitDef, slot: string, value: string): boolean {
  if (slot === 'droid') {
    if (value) fit.droid = value;
    else delete fit.droid;
    return true;
  }
  const s = fd.slots.find((x) => x.slot === slot);
  if (!s || s.fixed) return false;
  if (value === (s.stock ?? '')) delete fit.components[slot];
  else fit.components[slot] = value;
  return true;
}

/** A paint value picked on a fit, in place: the shader's own default is kept as absent. False for a variable the hull does not have. */
export function pickPaintValue(fit: ShipFit, fd: FitDef, name: string, value: number): boolean {
  const v = fd.paint?.variables.find((x) => x.name === name);
  if (!v) return false;
  if (value === v.default) delete fit.paint[name];
  else fit.paint[name] = value;
  return true;
}

/** The words beside a slot's select: its look of how many (or no model, fitted, empty), and whether it is the stock component. */
export function slotCountText(s: FitSlot, name: string | null, look: number): string {
  const stock = name !== null && name === s.stock ? ' · stock' : '';
  let where: string;
  if (!s.looks.length) where = name ? 'fitted' : 'empty';
  else if (look >= 0) where = s.looks[look]?.noModel ? `look ${look + 1}/${s.looks.length}, no model` : `look ${look + 1}/${s.looks.length}`;
  else where = name ? 'no model' : 'empty';
  return `${where}${stock}`;
}

/** The words beside a paint row: a pattern's own label, or a colour's place in its palette. */
export function paintCountText(v: PaintVariable, value: number, colours?: number): string {
  if (v.kind === 'index') return patternLabel(v, value);
  return `${value + 1}/${colours ?? v.size ?? 1}`;
}

/** The fit the page edits is its own copy: the kept record is only ever replaced through save(). */
export function copyFit(f: ShipFit): ShipFit {
  return { components: { ...f.components }, paint: { ...f.paint }, ...(f.droid ? { droid: f.droid } : {}) };
}

/** 'index_texture_1' reads as Pattern, 'index_color_1' as Colour 1. */
export function paintLabel(name: string): string {
  if (/^index_texture_\d+$/.test(name)) return name === 'index_texture_1' ? 'Pattern' : `Pattern ${name.slice('index_texture_'.length)}`;
  const c = /^index_color_(\d+)$/.exec(name);
  if (c) return `Colour ${c[1]}`;
  const s = name.replace(/^(index|private)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A slot's name in a sentence: 'booster', 'weapon 2'; the droid as itself. */
export function slotWord(fd: FitDef, slot: string): string {
  if (slot === 'droid') return 'droid';
  const s = fd.slots.find((x) => x.slot === slot);
  return (s ? slotLabel(s) : slot.replace(/_/g, ' ')).toLowerCase();
}
