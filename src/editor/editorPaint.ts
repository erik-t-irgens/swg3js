// The world editor's paint brush, put together (Map-maker II, DESIGN.md §2.5): the glue between the pure stroke
// (`groundBrush.ts`), the world's ground paint and its rebuild (`World.paintPreview`, `paintRelease`), and the editing's one
// undo a stroke (`EditorEdits.beginStroke`, `strokeWrite`, `endStroke`). The Tools list's entry on U (`paintTool`).
//
// **A stroke** is a button held over the ground: its stamps come `rate` times a second whatever the frame rate
// (`stampsDue`), each laid into the world's paint at once and previewed in place over the cached ground under it (the
// chunks rewritten a frame's share at a time; a cell erased shows when the stroke is let go), and **written once, as the
// button is let go**: every tile it changed (and the palette, where an entry was added) in one batch, one undo entry, while
// the worker makes the ground under it again with the plants the paint now decides. A write refused puts every tile back.
// Two layers: the **family** layer paints the chosen palette entry (a family of this world's, or of a real-elevation
// world's lent pack, or from the third wave of any installed world's, lent this world's ground behind the editor's short
// curtain the first time it is chosen, with the alternate it forces), the **colour** layer washes the chosen colour over the client's own
// colour map. Shift+click and the middle button take what is under the aim: its family (into the palette, chosen) or its
// colour. A space zone, the world of copies and a real-elevation world with no base family are refused in words.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { paintTileNumber, type GroundPaint, type PaintPaletteEntry } from '../swg/terrain/groundPaint.ts';
import { colourRle, familyRle, paintTileId, readPaintEntry, type PaintPaletteRow, type PaintRow, type PaintTileRow, type PaintWorldRow } from '../world/editFiles/paintFile.ts';
import type { EditorEdits, Stroke } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolFrame } from './tools.ts';
import { startClock, stampsDue, type BrushClock } from './brush.ts';
import { PAINT_TUNE } from './editorTune.ts';
import { PaintStroke, paintStampAsk, type PaintLayer } from './groundBrush.ts';
import { rawRect, type RawRect } from './sculpt.ts';
import { readWash, type WashSpec } from '../world/demWash.ts';

/** A family of the world's group, as the palette offers it: the pack it is of (another world's, where it was lent this one). */
export interface PaintFamily {
  id: number;
  name: string;
  pack: string;
  children: { name: string; weight: number }[];
}

/** What the paint brush needs of the editor and the game. */
export interface PaintHost {
  readonly edits: EditorEdits;
  /** What kind of world: only a ground world has ground to paint. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** Why this world's ground cannot be painted now (a real-elevation world with no base family), in words, or null. */
  notPaintable(): string | null;
  /** The world's paint, made empty and installed where it has none. */
  paint(): GroundPaint;
  /** The palette's entries as the world holds them now (in memory, ahead of the file while an entry is new). */
  entries(): PaintPaletteEntry[];
  /** The palette with an entry appended (in memory, resolved at once); answers its place (from 1). */
  addEntry(e: PaintPaletteEntry): number;
  /** The palette in memory cut back to its first `n` entries (a refused write's entries taken out again), resolved at once. */
  keepEntries(n: number): void;
  /** The pack whose families the palette's entries name here. */
  pack(): string;
  /** The world's families (the group the palette resolves against), those other worlds lent it among them. */
  families(): PaintFamily[];
  /** Whether a family of another world is lent this world's ground now (its pictures in the array): the paint lays it. */
  lent(pack: string, name: string): boolean;
  /**
   * A family of another world lent this world's ground in play, behind the editor's short curtain (Map-maker II's third
   * wave): null once lent, else why not, in words.
   */
  lend(pack: string, name: string): Promise<string | null>;
  /** What the ground is painted with under a game point, from the built ground: its family id and choice byte, or null. */
  familyAt(x: number, z: number): { family: number; choice: number } | null;
  /** The colour map at a game point (0xRRGGBB), or null where nothing is built. */
  colourAt(x: number, z: number): number | null;
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  /** A stamp's raw rectangle previewed (`World.paintPreview`), the brush at (`fx`, `fz`), game frame. */
  preview(r: RawRect, fx: number, fz: number): void;
  /** A stroke's raw rectangle let go: the tiles it touched handed on and the ground under it made again (`World.paintRelease`). */
  release(r: RawRect, famKeys: number[], colKeys: number[]): void;
  /** The paint file's row by id as it holds it now, or null. */
  fileRow(id: string): PaintRow | null;
  /** The file's rows and about its bytes, for the bar's notes. */
  fileSize(): { rows: number; bytes: number };
  /** The world row in force. */
  worldRow(): PaintWorldRow;
  /** The game's count of a stroke's work (`World.beginGroundWork`, `noteStamp`). */
  beginWork(): void;
  noteStamp(): void;
  say(words: string, ok: boolean): void;
}

/** A colour as three bytes from `#rrggbb` (white for anything else). */
export function rgbOfHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : [255, 255, 255];
}

/** `#rrggbb` of a packed colour. */
export function hexOf(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** The paint brush. */
export class EditorPaint {
  armed = false;
  private readonly host: PaintHost;
  private readonly clock: BrushClock = { owed: 0 };
  private stroke: PaintStroke | null = null;
  private editStroke: Stroke | null = null;
  /** The stroke under way's button: painting or erasing, and its layer. */
  mode: 'paint' | 'erase' | null = null;
  private layer: PaintLayer = 'family';
  private writing: Promise<string> | null = null;
  /** The palette as the file held it when the stroke began (so the write names the palette row only when it grew). */
  private paletteAtBegin = '';
  /** The last stroke's words and counts, for the console and the bar. */
  last = { stamps: 0, tiles: 0, cells: 0, said: '' };
  private readonly ask = paintStampAsk();
  private readonly out = rawRect();
  private readonly at = { x: 0.5, z: 0.5 };
  private colourHex = '';
  private readonly rgb = new Uint8Array(3);

  constructor(host: PaintHost) {
    this.host = host;
  }

  /** Whether the stroke under way holds a tile (it has painted into it): the world's hand-over (`World.paintHeldTile`). */
  holds(key: number, layer: 'fam' | 'col'): boolean {
    const s = this.stroke;
    return !!s && (layer === 'fam' ? s.beforeFam.has(key) : s.beforeCol.has(key));
  }

  /** Why the world refuses the tool, in words, or null. */
  refusal(): string | null {
    const k = this.host.worldKind();
    if (k === 'space') return 'a space zone has no ground to paint (space maps are a later pass)';
    if (k === 'copies') return "the dungeons' world of copies has no ground to paint";
    return this.host.notPaintable();
  }

  /** U: armed, or refused in words. */
  async arm(): Promise<string> {
    const no = this.refusal();
    if (no) {
      this.host.say(no, false);
      return no;
    }
    this.armed = true;
    const words = `the paint brush: ${PAINT_TUNE.layer} (LMB paints ${this.chosenWords()}, RMB erases, Shift+click or the middle button takes what is under it, C held with the wheel sizes it, U lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** U again, Escape, a thing in hand, the world gone: let go, a stroke under way ended (and written) as its button let go would. */
  disarm(): void {
    void this.end();
    this.armed = false;
  }

  /** The world went: a stroke under way dropped unwritten (its world's paint went with it). */
  worldGone(): void {
    this.stroke = null;
    this.editStroke = null;
    this.mode = null;
    this.armed = false;
  }

  /** What a family stroke lays now, in words. */
  chosenWords(): string {
    if (PAINT_TUNE.layer === 'colour') return `the colour ${PAINT_TUNE.colour}`;
    const e = this.host.entries()[PAINT_TUNE.entry - 1];
    return e ? `${e.pack !== this.host.pack() ? `${e.pack}'s ` : ''}${e.name}${e.child !== undefined ? ` (alternate ${e.child})` : ''}` : 'no family yet (the Tools tab, or the middle button on the ground)';
  }

  /**
   * One frame: a stroke begins on the first frame a button is held (paint or erase), stamps as its clock says at the aim,
   * and ends the frame neither is held; Shift+click takes what is under the aim and writes nothing. Makes nothing on a
   * frame with no stroke under way and no sample.
   */
  frame(f: ToolFrame): void {
    if (!this.armed) return;
    if (f.sampled && f.valid) this.pick(f.x, f.z);
    const want: 'paint' | 'erase' | null = f.apply ? 'paint' : f.inverse ? 'erase' : null;
    if (want !== this.mode) {
      void this.end();
      if (want && f.valid && !this.writing) this.begin(want);
    }
    const s = this.stroke;
    if (!this.mode || !s || !f.valid) return;
    const n = stampsDue(this.clock, f.dt, Math.max(0.01, PAINT_TUNE.rate));
    for (let i = 0; i < n; i++) this.stamp(f.x, f.z);
  }

  /**
   * What is under a game point taken into the brush (Shift+click, the middle button): on the family layer its family, as a
   * palette entry of its own (appended where none names it) and chosen; on the colour layer its colour. Writes nothing.
   */
  pick(x: number, z: number): string {
    if (PAINT_TUNE.layer === 'colour') {
      const c = this.host.colourAt(x, z);
      if (c === null) return this.saySoft('nothing is built under the aim to take a colour from');
      PAINT_TUNE.colour = hexOf(c);
      return this.saySoft(`the colour ${PAINT_TUNE.colour} taken`);
    }
    const g = this.host.familyAt(x, z);
    const fam = g ? this.host.families().find((f) => f.id === g.family) : null;
    if (!fam) return this.saySoft('no family under the aim to take');
    // A family another world lent this one is taken as that world's (it is lent already: no curtain).
    if (fam.pack !== this.host.pack()) {
      void this.chooseFrom(fam.pack, fam.name, undefined);
      return `taking ${fam.pack}'s ${fam.name}`;
    }
    return this.choose(fam.name, undefined);
  }

  /**
   * A family of any installed world chosen to paint (Map-maker II's third wave): this world's own as `choose` chooses it;
   * another world's lent this world's ground first where it is not (behind the editor's short curtain, `PaintHost.lend`),
   * then put in the palette by its pack and name and chosen. Refused in words where it cannot be lent. Answers what was said.
   */
  async chooseFrom(pack: string, name: string, child: number | undefined): Promise<string> {
    if (pack === this.host.pack()) return this.choose(name, child);
    const entry = readPaintEntry(child === undefined ? { pack, name } : { pack, name, child });
    if (typeof entry === 'string') {
      this.host.say(`${pack}:${name} cannot be painted: ${entry}`, false);
      return entry;
    }
    const list = this.host.entries();
    let at = list.findIndex((e) => e.pack === pack && e.name === name && e.child === child) + 1;
    if (!at && list.length >= 255) return this.saySoft('the palette holds 255 entries, as many as a cell can name');
    if (!this.host.lent(pack, name)) {
      if (this.mode) return this.saySoft('let the stroke go first');
      const no = await this.host.lend(pack, name);
      if (no) {
        this.host.say(`${pack}'s ${name} is not lent: ${no}`, false);
        return no;
      }
    }
    // Asked again after the wait: the curtain may have brought a palette landed meanwhile.
    at = this.host.entries().findIndex((e) => e.pack === pack && e.name === name && e.child === child) + 1;
    if (!at) at = this.host.addEntry(entry);
    PAINT_TUNE.entry = at;
    PAINT_TUNE.layer = 'family';
    return this.saySoft(`painting ${pack}'s ${name}${child !== undefined ? ` (alternate ${child})` : ''}`);
  }

  /** A family chosen to paint (an alternate it forces, or none): its palette entry, appended where none names it. */
  choose(name: string, child: number | undefined): string {
    const pack = this.host.pack();
    const list = this.host.entries();
    let at = list.findIndex((e) => e.pack === pack && e.name === name && e.child === child) + 1;
    if (!at) {
      if (list.length >= 255) return this.saySoft('the palette holds 255 entries, as many as a cell can name');
      // Asked of the file's own reader before it enters the palette: an entry no file could hold is refused here in words,
      // or every write that carried the palette would be refused after it, every later family stroke with it.
      const entry = readPaintEntry(child === undefined ? { pack, name } : { pack, name, child });
      if (typeof entry === 'string') {
        this.host.say(`${pack}:${name} cannot be painted: ${entry}`, false);
        return entry;
      }
      at = this.host.addEntry(entry);
    }
    PAINT_TUNE.entry = at;
    PAINT_TUNE.layer = 'family';
    return this.saySoft(`painting ${name}${child !== undefined ? ` (alternate ${child})` : ''}`);
  }

  private saySoft(words: string): string {
    this.host.say(words, true);
    return words;
  }

  /** A stroke begun: its first frame stamps at once. */
  private begin(mode: 'paint' | 'erase'): void {
    this.layer = PAINT_TUNE.layer;
    if (mode === 'paint' && this.layer === 'family' && !this.host.entries()[PAINT_TUNE.entry - 1]) {
      this.host.say('choose a family to paint first: on the Tools tab, or the middle button on the ground', false);
      return;
    }
    this.mode = mode;
    startClock(this.clock);
    this.host.beginWork();
    const file = this.host.fileRow('palette') as PaintPaletteRow | null;
    this.paletteAtBegin = JSON.stringify(file?.entries ?? []);
    this.stroke = new PaintStroke(this.host.paint());
    this.editStroke = this.host.edits.beginStroke(`paint (${mode === 'erase' ? `erase ${this.layer}` : this.layer})`);
  }

  /** One stamp at a game-frame point: laid into the paint and previewed over the ground under it. */
  private stamp(x: number, z: number): void {
    const s = this.stroke;
    if (!s || !this.mode) return;
    const t = PAINT_TUNE;
    const a = this.ask;
    this.host.toRaw(x, z, this.at);
    a.layer = this.layer;
    a.cx = this.at.x;
    a.cz = this.at.z;
    a.radius = t.radius;
    a.hard = t.hard;
    a.falloff = t.falloff;
    a.strength = t.strength;
    a.cellAt = t.cellAt;
    a.entry = t.entry;
    // The colour parsed again only when it changed (a stamp makes nothing).
    if (t.colour !== this.colourHex) {
      const rgb = rgbOfHex(t.colour);
      this.colourHex = t.colour;
      this.rgb[0] = rgb[0];
      this.rgb[1] = rgb[1];
      this.rgb[2] = rgb[2];
    }
    a.r = this.rgb[0];
    a.g = this.rgb[1];
    a.b = this.rgb[2];
    a.colourAmount = t.colourAmount;
    a.colourRate = t.colourRate;
    a.dt = 1 / Math.max(0.01, t.rate);
    a.erase = this.mode === 'erase';
    const r = s.stamp(a, this.out);
    this.host.noteStamp();
    if (r.x0 <= r.x1) this.host.preview(r, x, z);
  }

  /** The stroke ended: its tiles handed to the ground's rebuild, then written in one batch, one undo entry. */
  private end(): Promise<string> {
    const s = this.stroke;
    const es = this.editStroke;
    this.stroke = null;
    this.editStroke = null;
    this.mode = null;
    if (!s || !es) return Promise.resolve('');
    const touched = s.touched();
    if (s.rect.x0 <= s.rect.x1) this.host.release(s.rect, s.famKeys(), s.colKeys());
    const w = this.write(s, es, touched).finally(() => {
      if (this.writing === w) this.writing = null;
    });
    this.writing = w;
    return w;
  }

  /** A stroke's tiles (and the palette, where it grew) written as one batch and recorded as one action; refused, every tile put back. */
  private async write(s: PaintStroke, es: Stroke, touched: ReturnType<PaintStroke['touched']>): Promise<string> {
    const h = this.host;
    const changes: RowChange[] = [];
    let tiles = 0;
    for (const t of touched) {
      const id = paintTileId(t.layer, t.tx, t.tz);
      const before = h.fileRow(id) as PaintTileRow | null;
      if (!t.after) {
        if (before) changes.push({ file: 'paint', id, before: { ...before }, after: null });
        if (before) tiles++;
        continue;
      }
      const rle = t.layer === 'fam' ? familyRle(t.after) : colourRle(t.after);
      if (before && before.rle === rle) continue;
      const after: PaintTileRow = { id, rle };
      changes.push({ file: 'paint', id, before: before ? { ...before } : null, after });
      tiles++;
    }
    // The palette, where this stroke's cells name an entry the file has not got yet.
    const entries = h.entries();
    let palette: PaintPaletteRow | null = null;
    if (changes.some((c) => c.after && c.id.startsWith('fam:')) && JSON.stringify(entries) !== this.paletteAtBegin) {
      const before = h.fileRow('palette') as PaintPaletteRow | null;
      const was: PaintPaletteRow | null = before ? { ...before, entries: before.entries.map((e) => ({ ...e })) } : null;
      const now: PaintPaletteRow = { id: 'palette', entries: entries.map((e) => ({ ...e })) };
      changes.unshift({ file: 'paint', id: 'palette', before: was, after: now });
      palette = was;
    }
    this.last = { stamps: s.stamps, tiles, cells: 0, said: '' };
    if (!changes.length) {
      h.edits.endStroke(es);
      this.last.said = 'the stroke changed nothing';
      return this.last.said;
    }
    const no = await h.edits.strokeWrite(es, changes);
    const said = h.edits.endStroke(es);
    if (no) {
      this.putBack(s);
      // A refused write that carried the palette takes the entries it would have added out of the palette in memory
      // again, back to what the file holds: kept there, every later family stroke would carry them and be refused too.
      if (changes[0]?.id === 'palette') this.dropUnwritten((palette?.entries ?? []).length);
    }
    this.last.said = no ? said || no : said;
    return this.last.said;
  }

  /** The palette in memory cut back to the file's own entries (`keep` of them), the chosen entry held inside it. */
  private dropUnwritten(keep: number): void {
    const h = this.host;
    if (h.entries().length <= keep) return;
    h.keepEntries(keep);
    if (PAINT_TUNE.entry > keep) PAINT_TUNE.entry = Math.max(1, keep);
  }

  /** Every tile the stroke touched put back as it stood, and the ground under them made again. */
  private putBack(s: PaintStroke): void {
    const r = s.putBack();
    if (r.x0 <= r.x1) this.host.release(r, s.famKeys(), s.colKeys());
  }

  /**
   * A whole stroke from the console, exactly as held (`groundPaint({ stroke })`): a layer and an entry (or a colour) at a
   * game-frame point, `r` metres across (the tune's radius meanwhile), for `seconds` of stamps at the tune's rate, then
   * written. Answers what was said.
   */
  async strokeAt(layer: PaintLayer, erase: boolean, x: number, z: number, r: number, seconds: number): Promise<string> {
    const no = this.refusal();
    if (no) return no;
    if (this.writing) await this.writing;
    await this.end();
    const was = PAINT_TUNE.radius;
    const wasLayer = PAINT_TUNE.layer;
    if (r > 0) PAINT_TUNE.radius = r;
    PAINT_TUNE.layer = layer;
    try {
      this.begin(erase ? 'erase' : 'paint');
      if (!this.stroke) return 'nothing to paint with: choose a family (entry) first';
      const n = Math.max(1, Math.round(seconds * Math.max(0.01, PAINT_TUNE.rate)));
      for (let i = 0; i < n; i++) this.stamp(x, z);
    } finally {
      PAINT_TUNE.radius = was;
      PAINT_TUNE.layer = wasLayer;
    }
    return this.end();
  }

  /** The bar's words while armed. */
  barWords(): string {
    const t = PAINT_TUNE;
    const f = this.host.fileSize();
    const notes: string[] = [];
    if (f.rows > t.rowsNote) notes.push(`the paint file holds ${f.rows} rows (past ${t.rowsNote}): it ships in every release`);
    if (f.bytes > t.bytesNote) notes.push(`the paint file is ${(f.bytes / 1048576).toFixed(1)} MB (past ${(t.bytesNote / 1048576).toFixed(0)} MB)`);
    const doing = this.mode ? ` · ${this.mode === 'erase' ? 'erasing' : 'painting'}` : ' · LMB paints, RMB erases, U lets go';
    return `paint: ${t.layer} · ${this.chosenWords()} · ${Math.round(t.radius * 10) / 10} m · hard ${t.hard}${doing}${this.last.said && !this.mode ? ` · ${this.last.said}` : ''}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { armed: this.armed, layer: PAINT_TUNE.layer, entry: PAINT_TUNE.entry, chosen: this.chosenWords(), stroke: this.mode, writing: !!this.writing, last: { ...this.last } };
  }
}

/** The paint brush as an entry of the Tools list, on U. */
export function paintTool(p: EditorPaint, middleAt: () => { x: number; z: number; valid: boolean }): ToolDef {
  return {
    id: 'paint',
    action: 'editorPaint',
    label: 'the paint brush',
    armed: () => p.armed,
    arm: () => p.arm(),
    disarm: () => p.disarm(),
    step(f) {
      p.frame(f);
    },
    draw(d) {
      d.radius = PAINT_TUNE.radius;
      d.ring(0);
      d.radius = PAINT_TUNE.radius * PAINT_TUNE.hard;
      if (d.radius > 0.25) d.ring(1);
      d.marks.ringErase = p.mode === 'erase';
    },
    owns: (b) => b === 'apply' || b === 'inverse' || b === 'middle',
    middle() {
      const m = middleAt();
      if (m.valid) p.pick(m.x, m.z);
    },
    size(notches) {
      const t = PAINT_TUNE;
      t.radius = Math.min(t.radiusMax, Math.max(t.radiusMin, t.radius * Math.pow(t.radiusStep, notches)));
      return `paint brush ${Math.round(t.radius * 10) / 10} m`;
    },
    barWords: () => p.barWords(),
    report: () => p.report(),
  };
}

/**
 * A wash moved by the debug menu's dials (`groundPaint({ wash })`): flat names a slider writes (`baseR`, `noiseScale`,
 * `band0: { above, r, amount }`) laid over a wash, the result read as a world row reads one (`readWash`), or why not.
 */
export function washInto(was: WashSpec, partial: Record<string, unknown>): WashSpec | string {
  const next: WashSpec = JSON.parse(JSON.stringify(was)) as WashSpec;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const byte = (v: unknown): number | null => {
    const x = n(v);
    return x === null ? null : Math.max(0, Math.min(255, Math.round(x)));
  };
  for (const [k, v] of Object.entries(partial)) {
    if (k === 'baseR' || k === 'baseG' || k === 'baseB') {
      const b = byte(v);
      if (b === null) return `${k} is a byte`;
      next.base[k === 'baseR' ? 0 : k === 'baseG' ? 1 : 2] = b;
    } else if (k === 'noiseScale' || k === 'noiseAmount') {
      const x = n(v);
      if (x === null) return `${k} is a number`;
      next.noise = { scale: next.noise?.scale ?? 200, amount: next.noise?.amount ?? 0, ...(next.noise?.seed !== undefined ? { seed: next.noise.seed } : {}) };
      if (k === 'noiseScale') next.noise.scale = x;
      else next.noise.amount = x;
    } else if (/^band\d{1,2}$/.test(k) && v && typeof v === 'object') {
      const i = Number(k.slice(4));
      const band = next.bands?.[i];
      if (!band) return `${k}: the wash has no band ${i + 1}`;
      for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) {
        if (bk === 'r' || bk === 'g' || bk === 'b') {
          const b = byte(bv);
          if (b === null) return `${k}.${bk} is a byte`;
          band.colour[bk === 'r' ? 0 : bk === 'g' ? 1 : 2] = b;
        } else if (bk === 'above' || bk === 'below' || bk === 'slopeAbove' || bk === 'slopeBelow' || bk === 'amount') {
          const x = n(bv);
          if (x === null) return `${k}.${bk} is a number`;
          band[bk] = x;
        } else return `${k}.${bk} is no number of a band's`;
      }
    } else return `${k} is no number of the wash's`;
  }
  return readWash(next);
}

/** A tile number's id in the file (the console's). */
export function paintKeyId(layer: 'fam' | 'col', key: number): string {
  return paintTileId(layer, Math.floor(key / 8192) - 4096, (key % 8192) - 4096);
}

/** The tile number of a raw-frame point's tile (the console's `at`). */
export function paintKeyAt(x: number, z: number): number {
  return paintTileNumber(Math.floor(x / 512), Math.floor(z / 512));
}
