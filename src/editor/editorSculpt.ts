// The world editor's sculpt brush, put together (Map-maker II, DESIGN.md §2.4): the glue between the pure stroke
// (`sculpt.ts`), the world's height edits and their rebuild (`World.heightsChanged`), and the editing's one undo a stroke
// (`EditorEdits.beginStroke`, `strokeWrite`, `endStroke`). The Tools list's entry on K (`sculptTool`).
//
// **A stroke** is a button held over the ground: its stamps come `rate` times a second whatever the frame rate
// (`stampsDue`), each laid into the world's store at once and the ground under it rebuilt as it goes (the cached blocks and
// far grids laid again from raw, the chunks under it rewritten a frame's share at a time, their plantings made again a few
// times a second), and **written once, as the button is let go**: every tile it changed and, with carry, every row of ours
// standing on the ground it moved, in one batch, one undo entry. A write refused puts every tile back as it stood. A space
// zone and the world of copies have no ground to sculpt and are refused in words.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { fnv1aHeights, tileNumber, type HeightEdits } from '../swg/terrain/heightEdits.ts';
import { deltaBytes, tileIdOf, type HeightTileRow } from '../world/editFiles/heightsFile.ts';
import type { PlacementLayer, PlacementRow } from '../story/placements.ts';
import type { StandingFoot } from '../world/layoutStream.ts';
import { startClock, stampsDue, type BrushClock } from './brush.ts';
import { SCULPT_TUNE } from './editorTune.ts';
import { footBound, footMeetsDisc, KeepGrid, rawRect, sameTileDeltas, SculptStroke, tileRaw, type FrameTo, type KeepFoot, type RawAt, type RawRect, type SculptMode, type StampAsk } from './sculpt.ts';
import type { EditorEdits, Stroke } from './editorEdit.ts';
import type { RowChange } from './undo.ts';
import type { ToolDef, ToolFrame } from './tools.ts';

/** A row of ours standing, as the carry asks for it: its id, file and row, and where its own box's lowest point stands under its origin. */
export interface SculptRow {
  id: string;
  layer: PlacementLayer;
  row: PlacementRow;
  /** Its place in the game's frame. */
  x: number;
  y: number;
  z: number;
}

/** What the sculpt brush needs of the editor and the game. */
export interface SculptHost {
  readonly edits: EditorEdits;
  /** What kind of world: only a ground world has ground to sculpt. */
  worldKind(): 'ground' | 'space' | 'copies';
  /** The world's store of height edits, made empty and installed where it has none. */
  store(): HeightEdits;
  /** The raw height at a pole of the raw frame (pole px at x = 2 px), the block made ready where it is not cached; NaN for none. */
  rawAt: RawAt;
  /** A point of the game's frame in the raw frame, and back, into a kept record. */
  toRaw(x: number, z: number, out: { x: number; z: number }): void;
  toGame(x: number, z: number, out: { x: number; z: number }): void;
  /** The ground under a raw-frame rectangle moved: rebuilt as a stroke rebuilds it (`World.heightsChanged`), `end` at its end; the brush at (`fx`, `fz`), game frame. */
  changed(r: RawRect, end: boolean, fx: number, fz: number): void;
  /** Every placed object's foot near a game-frame rectangle (`LayoutStreamer.forEachStandingFoot`). */
  feet(x0: number, z0: number, x1: number, z1: number, visit: (f: StandingFoot) => boolean): void;
  /** This world's rows standing now, at their places in the game's frame. */
  standing(): SculptRow[];
  /** How far a standing row's own box's lowest point stands under its origin at its scale and turn (negative under it), or null where it has no box. */
  lowestOf(id: string): number | null;
  /** The heights file's row for a tile as the file holds it now (its `at` too), or null. */
  fileRow(id: string): HeightTileRow | null;
  /** The file's tiles and about its bytes as the editor last read or wrote it (`HeightRows`), for the bar's notes. */
  fileSize(): { tiles: number; bytes: number };
  /** Bytes deflated (deflate-raw) and written as base64. */
  deflate(bytes: Uint8Array): Promise<string>;
  /** The game's count of a stroke's work (`World.beginGroundWork`, `noteStamp`). */
  beginWork(): void;
  noteStamp(): void;
  say(words: string, ok: boolean): void;
}

/** The mode a button applies with the tool's mode chosen: the left the mode itself, the right raise's and lower's other (none for flatten and smooth). */
export function buttonMode(mode: SculptMode, inverse: boolean): SculptMode | null {
  if (!inverse) return mode;
  return mode === 'raise' ? 'lower' : mode === 'lower' ? 'raise' : null;
}

/**
 * How far past a stamp's own reach the feet are gathered at once, metres: the walk of what stands (`forEachStandingFoot`,
 * every object of the regions round it) is made again only once the brush has moved this far. A cost number, never feel.
 */
const FEET_PAD = 48;
/** The most of the players' things a stroke's note names one by one. */
const NAMED_MOST = 6;
/** The mask where nothing is kept off: a kept function, so a stamp makes none. */
const NO_KEEP = (): number => 1;

/** What a stroke reached (`EditorSculpt.reachedWords`): the game's objects, ours and the players' things, the last by name. */
export interface StrokeReach {
  game: number;
  ours: number;
  players: string[];
}

/** A tile's deltas as the bytes a file keeps (a nought always +0, so a tile of noughts is never written). */
export function tileBytes(d: Float32Array): Uint8Array {
  const c = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) c[i] = d[i] === 0 ? 0 : d[i];
  return deltaBytes(c);
}

/** The sculpt brush. */
export class EditorSculpt {
  armed = false;
  private readonly host: SculptHost;
  private readonly clock: BrushClock = { owed: 0 };
  /** The stroke under way: its pure record, its edit stroke, the button's mode, flatten's height, and a write going. */
  private stroke: SculptStroke | null = null;
  private editStroke: Stroke | null = null;
  mode: SculptMode | null = null;
  private height = 0;
  private writing: Promise<string> | null = null;
  /** The last stroke's words and counts, for the console and the bar. */
  last = { stamps: 0, tiles: 0, carried: 0, kept: 0, said: '', reached: { game: 0, ours: 0, players: [] as string[] } as StrokeReach };
  /** A stamp's ask and its changed rectangle, kept. */
  private readonly ask: StampAsk = { mode: 'raise', cx: 0.5, cz: 0.5, radius: 0.5, hard: 0.5, falloff: 'easeInOut', strength: 0.5, speed: 0.5, tau: 0.5, smoothTau: 0.5, flatMode: 'both', height: 0.5, dt: 0.5 };
  private readonly out = rawRect();
  private readonly at = { x: 0.5, z: 0.5 };
  /** A stamp's keep-off mask, worked out once over its disc (`KeepGrid`). */
  private readonly grid = new KeepGrid();
  /** What stands near the stroke (never what carry moves), gathered over `feetRect` and gathered again only once a stamp's reach leaves it. */
  private readonly feet: KeepFoot[] = [];
  private readonly feetRect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  private feetFresh = false;
  /** What the stroke under way reached (its own footprint met by a stamp's disc), by key, and how many of each. */
  private readonly reached = new Map<string, KeepFoot>();
  private reachedGame = 0;
  private reachedPlayers = 0;
  /** The host's two frames as kept functions, handed to the mask. */
  private readonly toGame: FrameTo;
  private readonly toRaw: FrameTo;

  constructor(host: SculptHost) {
    this.host = host;
    this.toGame = (x, z, out) => host.toGame(x, z, out);
    this.toRaw = (x, z, out) => host.toRaw(x, z, out);
  }

  /**
   * Whether the stroke under way holds a tile (it has stamped into it): the world's hand-over (`World.heightsHeld`), so a
   * write's answer or the file read again never lays a tile over the deltas a stroke is stamping (`layLanded`).
   */
  holds(tx: number, tz: number): boolean {
    const s = this.stroke;
    return !!s && s.before.has(tileNumber(tx, tz));
  }

  /** Why the world refuses the tool, in words, or null. */
  refusal(): string | null {
    const k = this.host.worldKind();
    if (k === 'space') return 'a space zone has no ground to sculpt (space maps are a later pass)';
    if (k === 'copies') return "the dungeons' world of copies has no ground to sculpt";
    return null;
  }

  /** K: armed, or refused in words. */
  async arm(): Promise<string> {
    const no = this.refusal();
    if (no) {
      this.host.say(no, false);
      return no;
    }
    this.armed = true;
    const words = `the sculpt brush: ${SCULPT_TUNE.mode} (LMB applies, RMB ${SCULPT_TUNE.mode === 'raise' ? 'lowers' : SCULPT_TUNE.mode === 'lower' ? 'raises' : 'does nothing'}, C held with the wheel sizes it, K lets go)`;
    this.host.say(words, true);
    return words;
  }

  /** K again, Escape, a thing in hand, the world gone: let go, a stroke under way ended (and written) as its button let go would. */
  disarm(): void {
    void this.end();
    this.armed = false;
  }

  /** The world went: a stroke under way dropped unwritten (its world's store went with it). */
  worldGone(): void {
    this.stroke = null;
    this.editStroke = null;
    this.mode = null;
    this.armed = false;
    this.feetFresh = false;
    this.feet.length = 0;
    this.reached.clear();
  }

  /**
   * One frame: a stroke begins on the first frame a button is held (its mode the button's), stamps as its clock says at the
   * aim, and ends the frame neither is held; Shift+click samples the height under the aim into flatten's sampled height and
   * writes nothing. Makes nothing on a frame with no stroke under way and no sample.
   */
  frame(f: ToolFrame): void {
    if (!this.armed) return;
    if (f.sampled && f.valid) this.sample(f.x, f.z);
    const want = f.apply ? buttonMode(SCULPT_TUNE.mode, false) : f.inverse ? buttonMode(SCULPT_TUNE.mode, true) : null;
    if (want !== this.mode) {
      void this.end();
      if (want && f.valid && !this.writing) this.begin(want, f.x, f.z);
    }
    const s = this.stroke;
    if (!this.mode || !s || !f.valid) return;
    const n = stampsDue(this.clock, f.dt, Math.max(0.01, SCULPT_TUNE.rate));
    for (let i = 0; i < n; i++) this.stamp(f.x, f.z);
  }

  /** The height under the aim as flatten's sampled height (the target then the sampled one): writes nothing. */
  sample(x: number, z: number): number {
    const h = this.groundAt(x, z);
    if (!Number.isFinite(h)) return Number.NaN;
    SCULPT_TUNE.sampled = h;
    SCULPT_TUNE.target = 'sampled';
    this.host.say(`flatten's height: ${h.toFixed(2)} m (sampled)`, true);
    return h;
  }

  /** The ground at a game-frame point as the stroke sees it now: raw plus the edits in force. */
  groundAt(x: number, z: number): number {
    this.host.toRaw(x, z, this.at);
    const s = this.stroke ?? new SculptStroke(this.host.store(), this.host.rawAt);
    return s.heightBetween(this.at.x, this.at.z);
  }

  /** A stroke begun: its first frame stamps at once, flatten's height taken where the target says. */
  private begin(mode: SculptMode, x: number, z: number): void {
    this.mode = mode;
    startClock(this.clock);
    this.host.beginWork();
    this.stroke = new SculptStroke(this.host.store(), this.host.rawAt);
    this.editStroke = this.host.edits.beginStroke(`sculpt (${mode})`);
    // What stands is gathered afresh at the stroke's first stamp (it may have moved since the last), and its count begun.
    this.feetFresh = false;
    this.reached.clear();
    this.reachedGame = 0;
    this.reachedPlayers = 0;
    const t = SCULPT_TUNE;
    this.height = t.target === 'typed' ? t.height : t.target === 'sampled' ? t.sampled : this.groundAt(x, z);
  }

  /** One stamp at a game-frame point: laid into the store and the ground under it rebuilt. */
  private stamp(x: number, z: number): void {
    const s = this.stroke;
    const mode = this.mode;
    if (!s || !mode) return;
    const t = SCULPT_TUNE;
    const a = this.ask;
    this.host.toRaw(x, z, this.at);
    a.mode = mode;
    a.cx = this.at.x;
    a.cz = this.at.z;
    a.radius = t.radius;
    a.hard = t.hard;
    a.falloff = t.falloff;
    a.strength = t.strength;
    a.speed = t.speed;
    a.tau = t.tau;
    a.smoothTau = t.smoothTau;
    a.flatMode = t.flatMode;
    a.height = t.target === 'stamp' ? this.groundAt(x, z) : this.height;
    a.dt = 1 / Math.max(0.01, t.rate);
    const keep = this.keepMask(x, z, a.cx, a.cz, t.radius);
    const r = s.stamp(a, keep, this.out);
    this.host.noteStamp();
    if (r.x0 <= r.x1) this.host.changed(r, false, x, z);
  }

  /**
   * The keep-off mask for a stamp round a game-frame point (its raw middle `rx`, `rz`): every foot the brush keeps off
   * within its reach (the game's objects by box, its trees by trunk, our buildings and the players' things by box; never a
   * row of ours carry moves) laid once into the stamp's own grid of poles (`KeepGrid`), whose weight at a pole is the mask.
   * Every foot whose own footprint the stamp's disc meets is counted as reached, whether or not the keep-off is on (the
   * bar's note). The feet are gathered once over a rectangle round the stroke and again only once a stamp leaves it.
   */
  private keepMask(x: number, z: number, rx: number, rz: number, radius: number): (rx: number, rz: number) => number {
    const t = SCULPT_TUNE;
    this.gatherFeet(x, z, radius + 2 + Math.max(t.keepMargin + t.keepFeather, t.keepTrunkMargin + t.keepTrunkFeather) + 64);
    const grid = this.grid;
    // The window the stamp walks: its disc of poles round its raw middle.
    if (t.keepOff) grid.reset(rx, rz, radius);
    let kept = 0;
    const feet = this.feet;
    for (let i = 0; i < feet.length; i++) {
      const f = feet[i];
      const reach = radius + footBound(f, t) + 1;
      if (Math.abs(f.x - x) > reach || Math.abs(f.z - z) > reach) continue;
      if (footMeetsDisc(f, x, z, radius)) this.noteReached(f);
      if (t.keepOff && grid.lay(f, t, this.toGame, this.toRaw)) kept++;
    }
    this.last.kept = kept;
    return t.keepOff && grid.any ? grid.at : NO_KEEP;
  }

  /**
   * What stands round a game-frame point gathered (`SculptHost.feet`), unless the last gathering's rectangle still holds
   * `need` metres round it: then nothing is walked. Gathered over `need` and `FEET_PAD` more, never what carry moves.
   */
  private gatherFeet(x: number, z: number, need: number): void {
    const r = this.feetRect;
    if (this.feetFresh && x - need >= r.x0 && x + need <= r.x1 && z - need >= r.z0 && z + need <= r.z1) return;
    const g = need + FEET_PAD;
    r.x0 = x - g;
    r.z0 = z - g;
    r.x1 = x + g;
    r.z1 = z + g;
    const feet = this.feet;
    feet.length = 0;
    this.host.feet(r.x0, r.z0, r.x1, r.z1, (f) => {
      if (f.kind === 'carry') return true;
      feet.push({ kind: f.kind, x: f.x, z: f.z, hx: f.hx, hz: f.hz, cos: f.cos, sin: f.sin, r: f.r, owner: f.owner, template: f.template, key: `${f.owner}|${f.template}|${f.x}|${f.z}` });
      return true;
    });
    this.feetFresh = true;
  }

  /** A foot the stroke reached, counted once a stroke. */
  private noteReached(f: KeepFoot): void {
    const key = f.key ?? '';
    if (this.reached.has(key)) return;
    this.reached.set(key, f);
    if (f.owner === 'game') this.reachedGame++;
    else if (f.owner === 'player') this.reachedPlayers++;
  }

  /** What the stroke under way has reached so far, by whose. */
  private reachNow(): StrokeReach {
    const out: StrokeReach = { game: 0, ours: 0, players: [] };
    for (const f of this.reached.values()) {
      if (f.owner === 'game') out.game++;
      else if (f.owner === 'player') out.players.push(f.template ?? '');
      else out.ours++;
    }
    return out;
  }

  /**
   * A stroke's reach in words (DESIGN.md §2.4): how many of the game's objects it reached, and, with the keep-off off, that
   * they stand where they stood with the ground moved under them; and every house and prop of the players' it reached, by
   * name, which a file can never move. Empty for a stroke that reached nothing.
   */
  static reachedWords(r: StrokeReach, keepOff: boolean): string {
    const said: string[] = [];
    if (r.game) said.push(keepOff ? `kept off ${r.game} of the game's object${r.game === 1 ? '' : 's'}` : `moved the ground under ${r.game} of the game's object${r.game === 1 ? '' : 's'} (the keep-off is off: they stand where they stood)`);
    if (r.ours) said.push(keepOff ? `kept off ${r.ours} building${r.ours === 1 ? '' : 's'} of ours` : `moved the ground under ${r.ours} building${r.ours === 1 ? '' : 's'} of ours`);
    if (r.players.length) {
      const named = r.players.slice(0, NAMED_MOST).join(', ');
      const more = r.players.length > NAMED_MOST ? ` and ${r.players.length - NAMED_MOST} more` : '';
      said.push(`${keepOff ? 'kept off' : 'moved the ground under'} the players' houses and props it reached: ${named}${more}`);
    }
    return said.join(' · ');
  }

  /** The stroke ended: its end's rebuild, then every tile it changed (and the rows carry moves) written in one batch, one undo entry. */
  private end(): Promise<string> {
    const s = this.stroke;
    const es = this.editStroke;
    this.stroke = null;
    this.editStroke = null;
    this.mode = null;
    if (!s || !es) return Promise.resolve('');
    this.host.changed(s.rect, true, Number.NaN, Number.NaN);
    const reach = this.reachNow();
    const w = this.write(s, es, reach).finally(() => {
      if (this.writing === w) this.writing = null;
    });
    this.writing = w;
    return w;
  }

  /** A stroke's tiles and carried rows written as one batch and recorded as one action; refused, every tile put back. */
  private async write(s: SculptStroke, es: Stroke, reach: StrokeReach): Promise<string> {
    const h = this.host;
    const t = SCULPT_TUNE;
    // What the stroke reached, said with whatever its write says (and on the message line where it reached anything).
    const reached = EditorSculpt.reachedWords(reach, t.keepOff);
    const withReach = (said: string): string => (reached ? (said ? `${said} · ${reached}` : reached) : said);
    const changes: RowChange[] = [];
    let bytes = 0;
    let tiles = 0;
    for (const tile of s.touched()) {
      if (sameTileDeltas(tile.before, tile.after)) continue;
      const id = tileIdOf(tile.tx, tile.tz);
      const before = h.fileRow(id);
      if (!tile.after) {
        if (before) changes.push({ file: 'heights', id, before: { ...before }, after: null });
        tiles++;
        continue;
      }
      const d = await h.deflate(tileBytes(tile.after));
      bytes += d.length;
      const row: HeightTileRow = { id, d, on: fnv1aHeights(tileRaw(tile.tx, tile.tz, h.rawAt)) };
      changes.push({ file: 'heights', id, before: before ? { ...before } : null, after: { ...row } });
      tiles++;
    }
    // Carry what stands on the ground the stroke moved: every row of ours in its rectangle that is not a building, out in
    // the open, whose own lowest point stands within `carryNear` of the ground it was judged on.
    let carried = 0;
    if (t.carry && s.rect.x0 <= s.rect.x1) {
      for (const r of h.standing()) {
        const row = r.row;
        if (row.kind === 'building' || row.inside || typeof row.ground !== 'number') continue;
        if (row.x < s.rect.x0 - 2 || row.x > s.rect.x1 + 2 || row.z < s.rect.z0 - 2 || row.z > s.rect.z1 + 2) continue;
        const low = h.lowestOf(r.id);
        if (low === null) continue;
        if (Math.abs(row.y + low - row.ground) > t.carryNear) continue;
        const dd = s.movedAt(row.x, row.z);
        if (!(Math.abs(dd) >= 0.0005)) continue;
        const after = { ...row, y: Math.round((row.y + dd) * 1000) / 1000, ground: Math.round((row.ground + dd) * 1000) / 1000 };
        delete (after as { at?: number }).at;
        changes.push({ file: r.layer, id: r.id, before: row, after });
        carried++;
      }
    }
    this.last = { stamps: s.stamps, tiles, carried, kept: this.last.kept, said: '', reached: reach };
    if (!changes.length) {
      h.edits.endStroke(es);
      this.last.said = withReach('the stroke changed nothing');
      return this.last.said;
    }
    if (bytes > t.undoBytes) {
      h.edits.endStroke(es);
      this.putBack(s);
      const words = `the stroke is ${bytes} bytes of tiles, past the ${t.undoBytes} one undo may hold: put back; make it in smaller strokes`;
      h.say(words, false);
      this.last.said = words;
      return words;
    }
    const no = await h.edits.strokeWrite(es, changes);
    const said = h.edits.endStroke(es);
    if (no) this.putBack(s);
    else if (reached) h.say(reached, !reach.players.length && t.keepOff);
    this.last.said = no ? said || no : withReach(said);
    return this.last.said;
  }

  /** Every tile the stroke touched put back as it stood, and the ground rebuilt over them. */
  private putBack(s: SculptStroke): void {
    const r = s.putBack();
    if (r.x0 <= r.x1) this.host.changed(r, true, Number.NaN, Number.NaN);
  }

  /**
   * A whole stroke from the console, exactly as held (`sculpt({ stroke })`): `mode` at a game-frame point, `r` metres
   * across (the tune's radius meanwhile), for `seconds` of stamps at the tune's rate, then written. Answers what was said.
   */
  async strokeAt(mode: SculptMode, x: number, z: number, r: number, seconds: number): Promise<string> {
    const no = this.refusal();
    if (no) return no;
    if (this.writing) await this.writing;
    await this.end();
    const was = SCULPT_TUNE.radius;
    if (r > 0) SCULPT_TUNE.radius = r;
    try {
      this.begin(mode, x, z);
      const n = Math.max(1, Math.round(seconds * Math.max(0.01, SCULPT_TUNE.rate)));
      for (let i = 0; i < n; i++) this.stamp(x, z);
    } finally {
      SCULPT_TUNE.radius = was;
    }
    return this.end();
  }

  /** The bar's words while armed. */
  barWords(): string {
    const t = SCULPT_TUNE;
    const f = this.host.fileSize();
    const notes: string[] = [];
    if (f.tiles > t.tilesNote) notes.push(`the heights file holds ${f.tiles} tiles (past ${t.tilesNote}): it ships in every release`);
    if (f.bytes > t.bytesNote) notes.push(`the heights file is ${(f.bytes / 1048576).toFixed(1)} MB (past ${(t.bytesNote / 1048576).toFixed(0)} MB)`);
    const ways = t.mode === 'flatten' ? ` to ${this.height.toFixed(1)} m (${t.target}, ${t.flatMode})` : '';
    // While a stroke is held: what it has reached so far (the game's objects counted with the keep-off off, the players' things always).
    const reaching = this.mode ? `${!t.keepOff && this.reachedGame ? ` · under ${this.reachedGame} of the game's objects` : ''}${this.reachedPlayers ? ` · reaching ${this.reachedPlayers} of the players' things` : ''}` : '';
    const doing = this.mode ? ` · ${this.mode}ing${reaching}` : ` · LMB ${t.mode}${t.mode === 'raise' ? ', RMB lower' : t.mode === 'lower' ? ', RMB raise' : ''}, K lets go`;
    return `sculpt: ${t.mode}${ways} · ${Math.round(t.radius * 10) / 10} m · hard ${t.hard}${doing}${this.last.said && !this.mode ? ` · ${this.last.said}` : ''}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { armed: this.armed, mode: SCULPT_TUNE.mode, stroke: this.mode, target: SCULPT_TUNE.target, height: this.height, writing: !!this.writing, feet: this.feet.length, last: { ...this.last } };
  }
}

/** The sculpt brush as an entry of the Tools list, on K. */
export function sculptTool(s: EditorSculpt): ToolDef {
  return {
    id: 'sculpt',
    action: 'editorSculpt',
    label: 'the sculpt brush',
    armed: () => s.armed,
    arm: () => s.arm(),
    disarm: () => s.disarm(),
    step(f) {
      s.frame(f);
    },
    draw(d) {
      d.radius = SCULPT_TUNE.radius;
      d.ring(0);
      d.radius = SCULPT_TUNE.radius * SCULPT_TUNE.hard;
      if (d.radius > 0.25) d.ring(1);
      d.marks.ringErase = s.mode === 'lower';
    },
    owns: (b) => b === 'apply' || b === 'inverse',
    size(notches) {
      const t = SCULPT_TUNE;
      t.radius = Math.min(t.radiusMax, Math.max(t.radiusMin, t.radius * Math.pow(t.radiusStep, notches)));
      return `sculpt brush ${Math.round(t.radius * 10) / 10} m`;
    },
    barWords: () => s.barWords(),
    report: () => s.report(),
  };
}
