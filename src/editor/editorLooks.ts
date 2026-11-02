// The world editor's looks and attachments (Map-maker II's seventh wave, Map-maker I's §7 less the light): a picked row's
// materials tinted, given another model's picture or another model's material (chosen by pointing at it, or out of the
// library); effects and sounds hung on a row or stood as a mark; and a hung attachment picked by its handle and moved by the
// hand -- R held turns it, F held raises it, C held scales it (the mouse up and down), the arrows and Page Up/Down nudge it a
// grid step along its model's own axes, Delete takes it off -- each move one write of its row put again, which the holder
// stands anew alone (`attachHash`), so a folded row stays folded. The rules are `lookPick.ts`; a borrowed material, which may
// need a program of its own, is written behind the editor's short curtain.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import * as THREE from 'three';
import type { Input } from '../core/input.ts';
import type { LayoutStreamer } from '../world/layoutStream.ts';
import type { AssetPack } from '../world/assetPack.ts';
import { ATTACH_TUNE, type AttachHandles, type RowAttachments } from '../world/rowAttach.ts';
import { lookRefusal } from '../world/rowMaterials.ts';
import { lookSignature, placementKey, toGame, type PlacementLayer, type PlacementRow, type RowAttach, type RowLook } from '../story/placements.ts';
import { IMPORTED_LENDS_NO_LOOK, attachMoved, attachMovedFrame, lookWith, materialList, withAttachmentAt, withLooks, type AttachChange, type LookChange, type MaterialItem } from './lookPick.ts';
import type { RowChange } from './undo.ts';
import type { MarksView } from '../ui/editorMarks.ts';

/** What the looks need of the editor and the game. */
export interface LooksHost {
  readonly input: Input;
  point(): boolean;
  pointer(): { x: number; y: number; over: boolean };
  rowFor(id: string): { row: PlacementRow; layer: PlacementLayer; label: string } | null;
  /** The ids picked now, and the picking let go of or set to one row. */
  picked(): readonly string[];
  pickOnly(id: string | null): void;
  putRows(label: string, changes: RowChange[]): Promise<string>;
  say(words: string, ok: boolean): void;
  stream(): LayoutStreamer | null;
  attachments(): RowAttachments<unknown>;
  frame(): 'raw' | 'game';
  centre(): { x: number; z: number } | null;
  /** A write that may need a program of its own, behind the editor's short curtain. */
  curtain(detail: string, work: () => Promise<string>): Promise<string>;
  /** The grid step the nudges move by (the editing's own). */
  grid(): number;
  refresh(): void;
}

/** The look picker armed: which material of the picked rows takes what, from the next surface clicked or library entry chosen. */
export interface LookPicking {
  of: string;
  take: 'texture' | 'material';
  /** The rows picked when the picker was armed: what the look goes on, whatever a click on a surface picks meanwhile. */
  ids: string[];
}

/** A library entry's materials offered while the picker is armed: its name and each material's ref. */
export interface LookChoice {
  entry: string;
  materials: { name: string; ref: string; map: boolean }[];
}

/** The looks. */
export class EditorLooks {
  private readonly host: LooksHost;
  picking: LookPicking | null = null;
  choice: LookChoice | null = null;
  /** The attachment picked by its handle: its row's id and its place in the row's list. */
  attachSel: { id: string; i: number } | null = null;
  /** The handle under the cursor (an index into the holder's list), or -1. */
  hover = -1;
  private holdKind: 'turn' | 'lift' | 'scale' | null = null;
  private holdBase: RowAttach | null = null;
  // Fractions from the start: a field that starts whole boxes every fraction written into it after.
  private readonly hold: AttachChange = { dx: 0.5, dy: 0.5, dz: 0.5, turn: 0.5, size: 0.5 };
  private lastPX = Number.NaN;
  private lastPY = Number.NaN;
  private writing = false;
  private readonly local = new THREE.Matrix4();
  // Kept for the frame.
  private readonly pt = new Float64Array(2);

  constructor(host: LooksHost) {
    this.host = host;
  }

  /** Whether a hold on a picked attachment has the mouse this frame (the camera holds still). */
  get takesMouse(): boolean {
    return this.holdKind !== null;
  }

  /** Everything let go of (the world going, the editor leaving, Escape). Answers whether anything was. */
  letGo(): boolean {
    const had = !!(this.picking || this.choice || this.attachSel || this.holdKind);
    if (this.holdKind && this.attachSel) this.host.attachments().restore(placementKey(this.attachSel.id));
    this.picking = null;
    this.choice = null;
    this.attachSel = null;
    this.holdKind = null;
    this.hover = -1;
    return had;
  }

  // ---- Looks. ----

  /** The materials of the first picked row's model, with their looks, for the Selected tab; null with nothing picked or no model loaded. */
  materialsOf(id: string): { items: MaterialItem[]; mats: readonly RowLook[] } | null {
    const r = this.host.rowFor(id);
    const s = this.host.stream();
    if (!r || !s || r.row.kind === 'mark') return null;
    const o = s.placedOf(placementKey(id));
    if (!o) return null;
    const model = s.loadedModelOf(o);
    if (!model) return null;
    return { items: materialList(model.primitives), mats: r.row.mats ?? [] };
  }

  /**
   * One material's look changed on every picked row (`of` a name in each one's model, or `*` for all), one write: refused in
   * words before anything is written where a borrowed picture or material cannot go on (its donor loaded first to ask), and
   * behind the curtain where a borrowed material is put on. Answers what was said.
   */
  async setLook(of: string, change: LookChange, label = 'look', onIds?: readonly string[]): Promise<string> {
    const ids = onIds ?? this.host.picked();
    if (!ids.length) return 'pick a row first';
    const s = this.host.stream();
    if (!s) return 'this world stands nothing';
    const changes: RowChange[] = [];
    const ref = typeof change.map === 'string' ? change.map : typeof change.like === 'string' ? change.like : null;
    const look: RowLook | null = ref ? (typeof change.map === 'string' ? { of, map: ref } : { of, like: ref }) : null;
    if (look) await s.loadLook(s.lookOf([look]));
    for (const id of ids) {
      const r = this.host.rowFor(id);
      if (!r || r.row.kind === 'mark') continue;
      if (look) {
        // Each of its materials the look reaches asked whether it can go on, in the editor's words.
        const o = s.placedOf(placementKey(id));
        const model = o ? (await s.modelFor(o.model, o.pack).catch(() => null)) : null;
        if (!model) return `${r.label}'s model is not loaded: aim at it first`;
        const donor = s.donorOf(ref!);
        for (const p of model.primitives) {
          if (of !== '*' && p.material.name !== of) continue;
          const why = lookRefusal(p.material, look, donor, p.geometry);
          if (why) return this.refuse(`${r.label}: ${why}`);
        }
      }
      const mats = lookWith(r.row.mats, of, change);
      changes.push({ file: r.layer, id, before: r.row, after: withLooks(r.row, mats) });
    }
    if (!changes.length) return 'nothing picked carries a model';
    const write = () => this.host.putRows(label, changes);
    if (typeof change.like === 'string') return this.host.curtain(`a borrowed material on ${of}`, write);
    return write();
  }

  /** The picked rows' looks replaced whole (`editor({ set: { mats } })`): checked by the reader's own rule, one write. */
  async setAllLooks(mats: RowLook[] | null): Promise<string> {
    const ids = this.host.picked();
    const changes: RowChange[] = [];
    for (const id of ids) {
      const r = this.host.rowFor(id);
      if (!r || r.row.kind === 'mark') continue;
      changes.push({ file: r.layer, id, before: r.row, after: withLooks(r.row, mats ?? undefined) });
    }
    if (!changes.length) return 'pick a row with a model first';
    const write = () => this.host.putRows('looks', changes);
    if (mats?.some((m) => !!m.like)) return this.host.curtain('the borrowed materials', write);
    return write();
  }

  /** The picker armed: the next surface clicked (or library entry chosen) gives the picked rows' `of` its picture or material. */
  armPick(of: string, take: 'texture' | 'material'): string {
    const ids = this.host.picked().filter((id) => this.host.rowFor(id)?.row.kind !== 'mark');
    if (!ids.length) return this.refuse('pick a row with a model first');
    this.picking = { of, take, ids };
    this.choice = null;
    const words = `click a surface (or choose a library entry) to take its ${take === 'texture' ? 'picture' : 'material'} for ${of}: Escape lets go`;
    this.host.say(words, true);
    this.host.refresh();
    return words;
  }

  /** A surface clicked while the picker is armed: its material named and given to the picked rows. Answers what was said. */
  async pickFrom(material: THREE.Material | null): Promise<string> {
    const p = this.picking;
    if (!p) return '';
    const s = this.host.stream();
    if (material && s?.donorIsImported(material)) return this.refuse(IMPORTED_LENDS_NO_LOOK);
    const ref = material && s ? s.donorRefOf(material) : null;
    if (!ref) return this.refuse('nothing the world stands there to take a look from');
    this.picking = null;
    return this.setLook(p.of, p.take === 'texture' ? { map: ref } : { like: ref }, p.take === 'texture' ? 'borrow a picture' : 'borrow a material', p.ids);
  }

  /** A library entry chosen while the picker is armed: its model loaded through its pack and its materials offered. */
  async offerEntry(entry: string, pack: AssetPack, packId: string, model: string): Promise<string> {
    const s = this.host.stream();
    if (!s || !this.picking) return '';
    if (pack.imported) return this.refuse(IMPORTED_LENDS_NO_LOOK);
    s.useDonorPack(pack);
    let loaded;
    try {
      loaded = await pack.model(model);
    } catch (err) {
      return this.refuse(`${model} would not load: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.choice = { entry, materials: materialList(loaded.primitives).map((m) => ({ name: m.name, ref: `${packId}:${model}/${m.name}`, map: m.map })) };
    this.host.refresh();
    return `${this.choice.materials.length} materials of ${model} to choose from on the Selected tab`;
  }

  /** One of the offered materials chosen: given to the picked rows. */
  async choose(ref: string): Promise<string> {
    const p = this.picking;
    if (!p) return '';
    this.picking = null;
    this.choice = null;
    return this.setLook(p.of, p.take === 'texture' ? { map: ref } : { like: ref }, p.take === 'texture' ? 'borrow a picture' : 'borrow a material', p.ids);
  }

  // ---- Attachments. ----

  /**
   * The handles projected into the marks (`v`: the editing's own view of this frame, its cursor in the kept record `cur`, so
   * no number crosses the call), and the one the cursor rests on within `pickPx` (`hover`, -1 for none). Nothing is made but
   * when the pools first grow.
   */
  frame(v: { vp: ArrayLike<number>; w: number; h: number; focal: number }, cur: { readonly x: number; readonly y: number }, m: MarksView): void {
    const cx = cur.x;
    const cy = cur.y;
    const list = this.host.attachments().handleList();
    m.handlesOn = list.count > 0;
    if (!m.handlesOn) {
      this.hover = -1;
      return;
    }
    handlePool(m, list.count);
    const vp = v.vp;
    const w = v.w;
    const h = v.h;
    let best = -1;
    let bestD = ATTACH_TUNE.pickPx;
    const sel = this.attachSel;
    const selKey = this.attachSelKey;
    // A picked mark's handle is drawn picked (its box is nothing the selection can draw).
    const picked = this.host.picked();
    for (let i = 0; i < list.count; i++) {
      const x = list.xyz[i * 3];
      const y = list.xyz[i * 3 + 1];
      const z = list.xyz[i * 3 + 2];
      const ccw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const on = ccw > 1e-6;
      m.handleVis[i] = on ? 1 : 0;
      if (!on) continue;
      const px = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / ccw * 0.5 + 0.5) * w;
      const py = (0.5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / ccw * 0.5) * h;
      m.handlePts[i * 3] = px;
      m.handlePts[i * 3 + 1] = py;
      // A sound's ring at its full-volume radius, its size on the screen at its distance (the view's depth is the clip's w).
      m.handlePts[i * 3 + 2] = list.radius[i] > 0 ? (list.radius[i] * v.focal) / ccw : 0;
      m.handleKind[i] = list.kind[i];
      m.handleState[i] = (sel && selKey === list.key[i] && sel.i === list.item[i]) || (list.mark[i] === 1 && picked.length > 0 && picked.indexOf(list.id[i]) >= 0) ? 2 : 0;
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.hover = best;
    if (best >= 0 && m.handleState[best] === 0) m.handleState[best] = 1;
    m.handleCount = list.count;
    m.handlePx = ATTACH_TUNE.handlePx;
  }

  /** The handle under the cursor's row id and whether it is a mark's, or null. */
  hovered(): { id: string; i: number; mark: boolean } | null {
    if (this.hover < 0) return null;
    const list = this.host.attachments().handleList();
    if (this.hover >= list.count) return null;
    return { id: list.id[this.hover], i: list.item[this.hover], mark: list.mark[this.hover] === 1 };
  }

  /** The mark whose handle the cursor rests on, by id, or null: what the editing's click picks (a frame's question, nothing made). */
  hoveredMark(): string | null {
    if (this.hover < 0) return null;
    const list = this.host.attachments().handles;
    return this.hover < list.count && list.mark[this.hover] === 1 ? list.id[this.hover] : null;
  }

  /** Whether the cursor rests on a handle of an attachment hung on a row with a model (a click picks that attachment). */
  hoveredAttachment(): boolean {
    if (this.hover < 0) return false;
    const list = this.host.attachments().handles;
    return this.hover < list.count && list.mark[this.hover] === 0;
  }

  /** The picked attachment's row key, kept beside it so a frame compares without making a string. */
  private attachSelKey = '';

  /**
   * A click on a handle: a mark's picks the mark (its row moves with the editing's own hand, the gizmo and all), any other
   * picks that attachment (the rows let go of). Answers whether it took the click.
   */
  click(): boolean {
    const h = this.hovered();
    if (!h) return false;
    if (h.mark) {
      this.attachSel = null;
      this.host.pickOnly(h.id);
    } else {
      this.pickAttachment(h.id, h.i);
      this.host.pickOnly(null);
      this.host.say(`picked ${this.host.rowFor(h.id)?.label ?? h.id}'s attachment ${h.i + 1}: R turns it, F raises it, C sizes it, the arrows nudge it, Delete takes it off`, true);
    }
    this.host.refresh();
    return true;
  }

  /** An attachment picked by its row's id and its place in the row's list (a handle clicked, the console). */
  pickAttachment(id: string, i: number): void {
    this.attachSel = { id, i };
    this.attachSelKey = placementKey(id);
  }

  /**
   * The keys with an attachment picked (and no row): a hold begun or ended (R, F, C with the mouse; its move carried live by
   * the holder and written as it is let go), a nudge a grid step along its model's own axes (Delete is `deleteKey`, in the editor's order). Fly's
   * mouse is spent here while a hold has it, so the camera holds still.
   */
  keys(): void {
    const sel = this.attachSel;
    const input = this.host.input;
    if (!sel || this.host.picked().length) {
      if (this.holdKind) this.endHold();
      this.lastPX = Number.NaN;
      return;
    }
    const kind = input.held('placeTurn') ? 'turn' : input.held('placeLift') ? 'lift' : input.held('editorScale') ? 'scale' : null;
    let dx = 0;
    let dy = 0;
    if (this.host.point()) {
      const p = this.host.pointer();
      if (Number.isFinite(this.lastPX)) {
        dx = p.x - this.lastPX;
        dy = p.y - this.lastPY;
      }
      this.lastPX = p.x;
      this.lastPY = p.y;
    } else {
      dx = input.mouseDX;
      dy = input.mouseDY;
      this.lastPX = Number.NaN;
    }
    if (kind && !this.holdKind && !this.writing) {
      const r = this.host.rowFor(sel.id);
      const a = r?.row.attach?.[sel.i];
      if (!a) {
        this.attachSel = null;
        return;
      }
      this.holdKind = kind;
      this.holdBase = a;
      this.hold.dx = this.hold.dy = this.hold.dz = this.hold.turn = 0;
      this.hold.size = 1;
    }
    if (this.holdKind) {
      if (kind !== this.holdKind) {
        this.endHold();
        return;
      }
      if (this.holdKind === 'turn') this.hold.turn! += dx * ATTACH_TUNE.turnPerPx;
      else if (this.holdKind === 'lift') this.hold.dy! -= dy * ATTACH_TUNE.liftPerPx;
      else this.hold.size! *= Math.exp(-dy * ATTACH_TUNE.sizePerPx);
      if (!this.host.point()) {
        input.mouseDX = 0;
        input.mouseDY = 0;
      }
      this.carry();
      return;
    }
    const g = this.host.grid();
    const along = (input.pressedAction('editorNudgeFwd') ? 1 : 0) - (input.pressedAction('editorNudgeBack') ? 1 : 0);
    const across = (input.pressedAction('editorNudgeRight') ? 1 : 0) - (input.pressedAction('editorNudgeLeft') ? 1 : 0);
    const up = (input.pressedAction('editorNudgeUp') ? 1 : 0) - (input.pressedAction('editorNudgeDown') ? 1 : 0);
    if (along || across || up) void this.moveAttachment(sel.id, sel.i, { dx: across * g, dy: up * g, dz: -along * g }, 'nudge an attachment');
  }

  /** Delete with an attachment picked (and no row): it is taken off. Answers whether it took the key. */
  deleteKey(): boolean {
    const sel = this.attachSel;
    if (!sel || this.host.picked().length) return false;
    void this.removeAttachment(sel.id, sel.i);
    return true;
  }

  /** The hold's move carried live by the holder (nothing written), from the attachment as it was when the hold began. */
  private carry(): void {
    const sel = this.attachSel;
    const base = this.holdBase;
    if (!sel || !base) return;
    // Worked out as the write will read it, making nothing (a frame's work).
    attachMovedFrame(base, this.hold, this.local, this.sized);
    this.host.attachments().followItem(this.attachSelKey, sel.i, this.local, this.sized.v);
  }
  private readonly sized = { v: 0.5 };

  /** A hold let go: the attachment written where it was carried (one write, the holder standing it anew). */
  private endHold(): void {
    const sel = this.attachSel;
    const base = this.holdBase;
    this.holdKind = null;
    this.holdBase = null;
    if (!sel || !base) return;
    const moved = attachMoved(base, this.hold);
    void this.writeAttachment(sel.id, sel.i, moved, 'move an attachment');
  }

  /** One attachment moved by a change (a nudge, the console): one write. */
  async moveAttachment(id: string, i: number, c: AttachChange, label = 'move an attachment'): Promise<string> {
    const a = this.host.rowFor(id)?.row.attach?.[i];
    if (!a) return this.refuse(`${id} has no attachment ${i + 1}`);
    return this.writeAttachment(id, i, attachMoved(a, c), label);
  }

  /** One attachment taken off its row (a mark left with nothing is taken out of its file). */
  async removeAttachment(id: string, i: number): Promise<string> {
    const r = this.host.rowFor(id);
    if (!r || !r.row.attach?.[i]) return this.refuse(`${id} has no attachment ${i + 1}`);
    if (this.attachSel?.id === id) this.attachSel = null;
    if (r.row.kind === 'mark' && r.row.attach.length === 1) return this.host.putRows('take a mark out', [{ file: r.layer, id, before: r.row, after: null }]);
    return this.host.putRows('take an attachment off', [{ file: r.layer, id, before: r.row, after: withAttachmentAt(r.row, i, null) }]);
  }

  /** One attachment put in place of what it was: one write of its row. */
  async writeAttachment(id: string, i: number, a: RowAttach, label: string): Promise<string> {
    const r = this.host.rowFor(id);
    if (!r) return this.refuse(`${id} is in neither file`);
    this.writing = true;
    try {
      return await this.host.putRows(label, [{ file: r.layer, id, before: r.row, after: withAttachmentAt(r.row, i, a) }]);
    } finally {
      this.writing = false;
    }
  }

  /** The picked rows' attachments replaced whole (`editor({ set: { attach } })`), one write; a mark left with none is refused. */
  async setAllAttachments(list: RowAttach[] | null): Promise<string> {
    const changes: RowChange[] = [];
    for (const id of this.host.picked()) {
      const r = this.host.rowFor(id);
      if (!r) continue;
      if (r.row.kind === 'mark' && !list?.length) return this.refuse(`${r.label} is a mark: it carries attachments or nothing at all (Delete takes it out)`);
      const { at: _at, attach: _old, ...rest } = r.row;
      changes.push({ file: r.layer, id, before: r.row, after: (list?.length ? { ...rest, attach: list } : rest) as PlacementRow });
    }
    if (!changes.length) return 'pick a row first';
    return this.host.putRows('attachments', changes);
  }

  /** What the console and the Selected tab say of a row's attachments: each one's kind, what it names, where and how big. */
  attachmentsOf(id: string): { i: number; words: string; at: string; size: string }[] {
    const r = this.host.rowFor(id);
    return (r?.row.attach ?? []).map((a, i) => ({ i, words: a.fx ? `effect ${a.fx}` : `sound ${a.snd}`, at: (a.at ?? [0, 0, 0]).join(' '), size: a.fx ? String(a.size ?? 1) : '' }));
  }

  /** What the look on a material says in words: its tint, the picture or the material it borrows, or nothing. */
  static lookWords(l: RowLook | null): string {
    if (!l) return '';
    if (l.like) return `material of ${l.like}`;
    return [l.tint ? `tint ${l.tint}` : '', l.map ? `picture of ${l.map}` : ''].filter(Boolean).join(' · ');
  }

  /** What the console says of the looks: the picker, the choice, the attachment picked, the handle under the cursor. */
  report(): Record<string, unknown> {
    const h = this.hovered();
    // The offered materials by the reference `editor({ look: { choose } })` takes.
    return { picking: this.picking, choice: this.choice ? { entry: this.choice.entry, materials: this.choice.materials.map((m) => m.ref) } : null, attachment: this.attachSel, holding: this.holdKind, hover: h };
  }

  private refuse(words: string): string {
    this.host.say(words, false);
    return words;
  }
}

/** The handles' pools grown to hold `n` (never in a steady frame). */
export function handlePool(m: MarksView, n: number): void {
  if (m.handleVis.length >= n) return;
  const cap = Math.max(n, m.handleVis.length * 2, 16);
  m.handlePts = new Float64Array(cap * 3);
  m.handleVis = new Uint8Array(cap);
  m.handleKind = new Uint8Array(cap);
  m.handleState = new Uint8Array(cap);
}

/** A look's signature on a row (for the console): '' for none. */
export function rowLookSig(row: PlacementRow): string {
  return row.mats ? lookSignature(row.mats) : '';
}

/** A row's place in the game's frame (for a mark's handle and the console). */
export function rowPlace(row: PlacementRow, centre: { x: number; z: number } | null, frame: 'raw' | 'game'): { x: number; y: number; z: number } {
  const g = toGame(row, centre, frame);
  return { x: g.x, y: g.y, z: g.z };
}
