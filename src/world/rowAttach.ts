// What hangs on the world's permanent rows (Map-maker II's seventh wave, Map-maker I's §2.7 `attach` and `kind: 'mark'`): one
// holder stands every row's effects and sounds, keyed by the row's streamer key and apart from the tiers, so folding never
// touches an attachment, a mark (a row with no model) and a model row share one path, and an attachment moved never takes
// its row down (`attachHash` in `src/story/placements.ts`).
//
// **An effect** is placed only while its row is within `ATTACH_TUNE.reach` of the eye, looked at `ATTACH_TUNE.hz` times a
// second, made ready once a file (`prepare`: its description read, its batches made hidden, its textures uploaded) before its
// first placing, and taken away past the reach (with a little slack, so a row on the line does not come and go every look).
// Its matrix is its row's place, turn and scale times its own place and turn in the model's frame, the scale taken back out
// (`attachMatrix`: a scale in a handle's matrix is half applied); its size is its own times the row's largest axis
// (`EffectHandle.size`). **A sound** joins the world's emitters at once with its row's record as its owner and leaves them
// with it (`WorldEmitters.attach`/`detach`, uncapped and removable; the mixer's own grid culls it by distance).
//
// **Nothing here is made in a frame**: the look is a walk over a kept list by index, a clock between looks, and a placing
// only on the look that finds a row come into reach. The handles the world editor draws are a flat kept list (`handles`),
// written only when what stands or where it stands changes.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import * as THREE from 'three';
import { scaleOf, type GamePlace, type PlacementRow, type RowAttach } from '../story/placements.ts';
import { packIdOfRoot, relativeRoot } from './packPath.ts';

/**
 * Every number of the attachments, ours: live through `__debug.editor({ tune: { attach: { ... } } })` and sliders under
 * `editor`. `reach` and `hz` are the holder's (how far an effect is still stood, how often it looks); the rest are the world
 * editor's feel, the owner's: a new attachment's size and how far over the hit it is hung, a handle's size and how near the
 * cursor picks one, and how big the effect in hand is shown (0 shows none).
 */
export const ATTACH_TUNE = {
  /** Metres from the eye within which a row's effects are stood: about a town's width, past which a small effect is a few pixels. */
  reach: 300,
  /** Looks a second: four, the mixer's own grid's rate. */
  hz: 4,
  /** An effect is taken away past `reach` times this, so a row on the line is not stood and taken away at every look. */
  slack: 1.15,
  /** A new attachment's size: the effect at its own. */
  size: 1,
  /** Metres over the hit a new attachment is hung: none, it stands where the aim met the surface. */
  lift: 0,
  /** A handle's half size on the screen, pixels, and how near the cursor picks one: a little bigger than a row's corner. */
  handlePx: 7,
  pickPx: 12,
  /** The effect in hand shown at the aim at this size of its own (0 shows none): the library's preview. */
  preview: 1,
  /** The hand on a picked attachment: metres F raises it a pixel of the mouse, and radians R turns it a pixel (a centimetre, about half a degree). */
  liftPerPx: 0.01,
  turnPerPx: 0.01,
  /** C held: the size multiplied by e to the power of this a pixel of the mouse up (a hundred pixels about 2.7 times). */
  sizePerPx: 0.01,
};

/** What the holder needs of the world: the particles, the mixer's emitters and where an attachment's files are. */
export interface AttachHost<H> {
  /** A world-relative effect file for `<pack>:<file>`, or null for a pack this install has not got. */
  fileOf(ref: string): string | null;
  /** An effect's description read and its batches and textures made ready; false where it would not load. */
  prepare(file: string): Promise<boolean>;
  /** An effect placed; null where there is nothing to place it in (no world's particles), which the next look asks again. */
  place(file: string, m: THREE.Matrix4, contained: boolean, size: number): H | null;
  move(h: H, m: THREE.Matrix4): void;
  /** A placed effect sized again where it plays (`ParticleEffects.resize`): nothing placed again, nothing made. */
  resize(h: H, size: number): void;
  remove(h: H): void;
  /** A sound joined to the world's emitters under `owner`, moved, and let go of. */
  sound(owner: object, template: string, x: number, y: number, z: number, inside: boolean): void;
  soundMove(owner: object, x: number, y: number, z: number): void;
  soundOff(owner: object): void;
  /** The radius within which a sound plays at full volume, metres (its template's), for the editor's ring; 0 for none known. */
  fullOf?(template: string): number;
}

/** One attachment standing: what it is, its own frame in the model's, where it is in the world, and its effect or sound. */
interface Item<H> {
  a: RowAttach;
  local: THREE.Matrix4;
  world: THREE.Matrix4;
  file: string | null;
  size: number;
  h: H | null;
  /** 0 not asked, 1 being made ready, 2 would not load. */
  state: 0 | 1 | 2;
  /** The owner a sound is joined under: the item itself. */
  sounding: boolean;
}

/** One row's attachments: its key, whether it stands in a room, its place (and the place it was stood at), its scale's largest axis. */
interface Held<H> {
  key: string;
  /** The row's own id and whether it is a mark (the editor's handles say both). */
  id: string;
  mark: boolean;
  inside: boolean;
  base: THREE.Matrix4;
  stood: THREE.Matrix4;
  most: number;
  x: number;
  y: number;
  z: number;
  items: Item<H>[];
  gone: boolean;
}

const ONE = new THREE.Vector3(1, 1, 1);
const tP = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tS = new THREE.Vector3();
const tQ2 = new THREE.Quaternion();

/**
 * An attachment's own frame in its model's (`at`, `q` as `[w, x, y, z]`, the game's frame, never mirrored), into `out`.
 */
export function attachLocal(a: RowAttach, out: THREE.Matrix4): THREE.Matrix4 {
  const at = a.at;
  const q = a.q;
  tP.set(at ? at[0] : 0, at ? at[1] : 0, at ? at[2] : 0);
  tQ2.set(q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 0, q ? q[0] : 1);
  return out.compose(tP, tQ2, ONE);
}

/**
 * Where an attachment stands in the world: its row's matrix (place, turn and scale) times its own frame, the scale then taken
 * back out (the effect stands where the scaled model puts it, turned as the model turns it, at its own size). Into `out`.
 */
export function attachMatrix(base: THREE.Matrix4, local: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  out.multiplyMatrices(base, local);
  out.decompose(tP, tQ, tS);
  return out.compose(tP, tQ, ONE);
}

/**
 * The file an attachment's effect (`<pack>:<file>`) is read from, against the world's own particles folder (`root`, its
 * pack's folder): its own path where the pack is the world's, else the way out of the world's folder into that pack's
 * (`relativeRoot`), so an effect of another pack is read where it is and never copied; null for a name with no pack or
 * with no world to read it from. `base` is the page's own root (Vite's `BASE_URL`).
 */
export function attachFileOf(ref: string, root: string | null, base: string): string | null {
  const i = ref.indexOf(':');
  if (i <= 0 || !root) return null;
  const pack = ref.slice(0, i);
  const file = ref.slice(i + 1);
  return pack === packIdOfRoot(root) ? file : relativeRoot(root, `${base}assets-private/${pack}/`) + file;
}

/** A row's matrix in the game's frame: its place, its turn (three's order) and its scale (a mark has none). */
export function rowMatrix(row: PlacementRow, g: GamePlace, out: THREE.Matrix4): THREE.Matrix4 {
  const s = row.kind === 'mark' ? ([1, 1, 1] as const) : scaleOf(row);
  tP.set(g.x, g.y, g.z);
  tQ.set(g.q[0], g.q[1], g.q[2], g.q[3]);
  tS.set(s[0], s[1], s[2]);
  return out.compose(tP, tQ, tS);
}

/** The handles of what stands, as the world editor draws and picks them: a flat kept list, written when what stands changes. */
export interface AttachHandles {
  count: number;
  /** x, y, z each, in the game's frame. */
  xyz: Float64Array;
  /** 0 an effect, 1 a sound. */
  kind: Uint8Array;
  /** A sound's full-volume radius, metres (0 for an effect). */
  radius: Float32Array;
  /** The row's key, its own id, whether it is a mark, and the attachment's index in its list, a handle each. */
  key: string[];
  id: string[];
  mark: Uint8Array;
  item: Int32Array;
}

/** The holder. One a world: made with it, cleared as it goes. */
export class RowAttachments<H> {
  private readonly host: AttachHost<H>;
  private readonly byKey = new Map<string, Held<H>>();
  /** The rows walked by index on a look (a map's iterator is an object a walk). */
  private readonly list: Held<H>[] = [];
  /** Files made ready, and whether each loaded. */
  private readonly ready = new Map<string, boolean>();
  /** Moved by every world's going: a file made ready for the last world places nothing in this one. */
  private gen = 0;
  /** Seconds since the last look; a fraction from the start (a field that starts whole boxes every fraction written into it). */
  private clock = 0.5;
  private readonly m = new THREE.Matrix4();
  /** What the editor draws (`handles`), and whether it is to be written again. */
  readonly handles: AttachHandles = { count: 0, xyz: new Float64Array(48), kind: new Uint8Array(16), radius: new Float32Array(16), key: [], id: [], mark: new Uint8Array(16), item: new Int32Array(16) };
  private handlesStale = true;
  /** How many effects stand placed now, and how many sounds are joined, for the console. */
  placed = 0;
  sounding = 0;

  constructor(host: AttachHost<H>) {
    this.host = host;
  }

  /** How many rows carry attachments now. */
  get rows(): number {
    return this.list.length;
  }

  /**
   * A row's attachments stood (a mark's whole stand; beside a model row's own), at its place in the game's frame: what stood
   * under its key first taken away. Its sounds join the emitters now; its effects on the next look that finds it in reach.
   */
  stand(key: string, row: PlacementRow, g: GamePlace): void {
    this.drop(key);
    const list = row.attach;
    if (!list || !list.length) return;
    const base = rowMatrix(row, g, new THREE.Matrix4());
    const s = row.kind === 'mark' ? 1 : Math.max(...scaleOf(row));
    const held: Held<H> = { key, id: row.id, mark: row.kind === 'mark', inside: !!row.inside, base, stood: base.clone(), most: s, x: g.x, y: g.y, z: g.z, items: [], gone: false };
    for (const a of list) {
      const local = attachLocal(a, new THREE.Matrix4());
      const world = attachMatrix(base, local, new THREE.Matrix4());
      const item: Item<H> = { a, local, world, file: a.fx ? this.host.fileOf(a.fx) : null, size: (a.size ?? 1) * s, h: null, state: 0, sounding: false };
      if (a.snd) {
        tP.setFromMatrixPosition(world);
        this.host.sound(item, a.snd, tP.x, tP.y, tP.z, held.inside);
        item.sounding = true;
        this.sounding++;
      }
      held.items.push(item);
    }
    this.byKey.set(key, held);
    this.list.push(held);
    this.handlesStale = true;
    // Looked at again at once, so a row stood beside the eye (the editor's own write) does not wait out the clock.
    this.clock = Infinity;
  }

  /** A row's attachments taken away: its effects removed and its sounds let go of. Nothing for a row with none. */
  drop(key: string): void {
    const held = this.byKey.get(key);
    if (!held) return;
    this.byKey.delete(key);
    held.gone = true;
    for (const it of held.items) this.letGo(it);
    const i = this.list.indexOf(held);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.length--;
    }
    this.handlesStale = true;
  }

  private letGo(it: Item<H>): void {
    if (it.h !== null) {
      this.host.remove(it.h);
      it.h = null;
      this.placed--;
    }
    if (it.sounding) {
      this.host.soundOff(it);
      it.sounding = false;
      this.sounding--;
    }
  }

  /**
   * The world went: everything let go of (its effects removed while the particles still stand, its sounds detached), and a
   * file made ready for it places nothing after.
   */
  clear(): void {
    this.previewClear();
    for (const held of this.list) {
      held.gone = true;
      for (const it of held.items) this.letGo(it);
    }
    this.list.length = 0;
    this.byKey.clear();
    this.ready.clear();
    this.gen++;
    this.handlesStale = true;
  }

  /**
   * A look (`ATTACH_TUNE.hz` times a second, the clock run on `dt`): each row's effects placed where it has come within
   * `reach` of the eye (made ready first, once a file) and taken away past `reach` times `slack`. Nothing made but on a look
   * that places, and on a frame between looks nothing at all.
   */
  update(eye: { readonly x: number; readonly y: number; readonly z: number }, dt: number): void {
    this.clock += dt;
    if (this.clock < 1 / Math.max(0.5, ATTACH_TUNE.hz)) return;
    this.clock = 0;
    if (!this.list.length) return;
    const near = ATTACH_TUNE.reach;
    const far = near * Math.max(1, ATTACH_TUNE.slack);
    for (let r = 0; r < this.list.length; r++) {
      const held = this.list[r];
      const dx = held.x - eye.x;
      const dy = held.y - eye.y;
      const dz = held.z - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      for (let i = 0; i < held.items.length; i++) {
        const it = held.items[i];
        if (!it.file) continue;
        if (it.h !== null) {
          if (d > far) {
            this.host.remove(it.h);
            it.h = null;
            this.placed--;
          }
          continue;
        }
        if (d > near || it.state !== 0) continue;
        const ok = this.ready.get(it.file);
        if (ok === true) this.put(held, it);
        else if (ok === false) it.state = 2;
        else this.makeReady(held, it);
      }
    }
  }

  /** An effect placed where its item stands now. */
  private put(held: Held<H>, it: Item<H>): void {
    it.h = this.host.place(it.file!, it.world, held.inside, it.size);
    if (it.h !== null) this.placed++;
  }

  /** A file made ready, then the item placed if its row still stands, unmoved in the world it began in, and still in reach. */
  private makeReady(held: Held<H>, it: Item<H>): void {
    const file = it.file!;
    const gen = this.gen;
    it.state = 1;
    void this.host.prepare(file).then(
      (ok) => {
        if (gen !== this.gen) return;
        this.ready.set(file, ok);
        it.state = ok ? 0 : 2;
        if (ok && !held.gone && it.h === null) this.put(held, it);
      },
      () => {
        if (gen !== this.gen) return;
        this.ready.set(file, false);
        it.state = 2;
      },
    );
  }

  /**
   * A row's attachments carried where the world editor is moving it (`m`: its place, turn and scale this frame), effects and
   * sounds alike, without anything stood again; `restore` puts them back where the row was stood. Nothing made.
   */
  follow(key: string, m: THREE.Matrix4): void {
    const held = this.byKey.get(key);
    if (!held) return;
    held.base.copy(m);
    this.carry(held);
  }

  /** A row's attachments back where its row was stood (an edit given up). */
  restore(key: string): void {
    const held = this.byKey.get(key);
    if (!held) return;
    held.base.copy(held.stood);
    this.carry(held);
  }

  /**
   * One attachment carried to a new frame of its own in the model's (the editor moving its handle): `local` its new frame,
   * `size` its own size (times the row's largest axis as it stands). Nothing stood again; the write's landing stands it.
   */
  followItem(key: string, index: number, local: THREE.Matrix4, size: number): void {
    const held = this.byKey.get(key);
    const it = held?.items[index];
    if (!held || !it) return;
    it.local.copy(local);
    attachMatrix(held.base, it.local, it.world);
    this.moveItem(held, it);
    // A placed effect sized again where it plays (C held: a new size nearly every frame of the hold). Placed again instead,
    // it started over from no particles at every step, so the size being dialled never showed, and every step made one.
    const want = size * held.most;
    if (it.h !== null && want !== it.size) this.host.resize(it.h, want);
    it.size = want;
  }

  /** Every item of a row moved to where its base and its own frame now put it. */
  private carry(held: Held<H>): void {
    held.x = held.base.elements[12];
    held.y = held.base.elements[13];
    held.z = held.base.elements[14];
    for (let i = 0; i < held.items.length; i++) {
      const it = held.items[i];
      attachMatrix(held.base, it.local, it.world);
      this.moveItem(held, it);
    }
  }

  private moveItem(_held: Held<H>, it: Item<H>): void {
    if (it.h !== null) this.host.move(it.h, it.world);
    if (it.sounding) {
      const e = it.world.elements;
      this.host.soundMove(it, e[12], e[13], e[14]);
    }
    this.handlesStale = true;
  }

  /** Where one attachment stands in the world now (its matrix), or null for none. */
  matrixOf(key: string, index: number): THREE.Matrix4 | null {
    return this.byKey.get(key)?.items[index]?.world ?? null;
  }

  /** A row's matrix as the holder carries it now, or null for a row with no attachments. */
  rowMatrixOf(key: string): THREE.Matrix4 | null {
    return this.byKey.get(key)?.base ?? null;
  }

  /**
   * The handles' list written again where what stands moved since (`handles`): every attachment's place, kind, a sound's ring
   * and whose it is. Grown, never shrunk, so a steady frame makes nothing. Answers the list.
   */
  handleList(): AttachHandles {
    if (!this.handlesStale) return this.handles;
    this.handlesStale = false;
    const h = this.handles;
    let n = 0;
    for (let r = 0; r < this.list.length; r++) n += this.list[r].items.length;
    if (h.kind.length < n) {
      const cap = Math.max(n, h.kind.length * 2);
      h.xyz = new Float64Array(cap * 3);
      h.kind = new Uint8Array(cap);
      h.radius = new Float32Array(cap);
      h.mark = new Uint8Array(cap);
      h.item = new Int32Array(cap);
    }
    h.key.length = n;
    h.id.length = n;
    let k = 0;
    for (let r = 0; r < this.list.length; r++) {
      const held = this.list[r];
      for (let i = 0; i < held.items.length; i++) {
        const it = held.items[i];
        const e = it.world.elements;
        h.xyz[k * 3] = e[12];
        h.xyz[k * 3 + 1] = e[13];
        h.xyz[k * 3 + 2] = e[14];
        h.kind[k] = it.a.snd ? 1 : 0;
        h.radius[k] = it.a.snd ? (this.host.fullOf?.(it.a.snd) ?? 0) : 0;
        h.key[k] = held.key;
        h.id[k] = held.id;
        h.mark[k] = held.mark ? 1 : 0;
        h.item[k] = i;
        k++;
      }
    }
    h.count = n;
    return h;
  }

  // ---- The world editor's preview: the effect in hand shown where the aim meets the world. ----

  private prevH: H | null = null;
  private prevGen = 0;
  private prevFile: string | null = null;
  private readonly prevM = new THREE.Matrix4();

  /**
   * The effect in the world editor's hand shown at `size` of its own (`ATTACH_TUNE.preview`; nought or none shows nothing),
   * made ready first like any attachment's (never on a live frame), at the place `previewMove` last wrote.
   */
  previewSet(fx: string | null, size: number): void {
    this.previewClear();
    if (!fx || !(size > 0)) return;
    const file = this.host.fileOf(fx);
    if (!file) return;
    this.prevFile = file;
    const gen = this.prevGen;
    const world = this.gen;
    const go = (): void => {
      if (gen !== this.prevGen || world !== this.gen || this.prevH !== null) return;
      this.prevH = this.host.place(file, this.prevM, false, size);
    };
    const ok = this.ready.get(file);
    if (ok === true) go();
    else if (ok === undefined)
      void this.host.prepare(file).then(
        (r) => {
          if (world !== this.gen) return;
          this.ready.set(file, r);
          if (r) go();
        },
        () => {},
      );
  }

  /** The preview moved to a matrix (its place and turn; nothing made). */
  previewMove(m: THREE.Matrix4): void {
    this.prevM.copy(m);
    if (this.prevH !== null) this.host.move(this.prevH, this.prevM);
  }

  /** The preview taken away (the hand let go, the world gone). */
  previewClear(): void {
    this.prevGen++;
    this.prevFile = null;
    if (this.prevH !== null) {
      this.host.remove(this.prevH);
      this.prevH = null;
    }
  }

  /** For the console: the rows, the effects placed and the sounds joined, the files and whether each loaded, the preview. */
  report(): { rows: number; items: number; placed: number; sounding: number; files: Record<string, boolean>; preview: string | null } {
    let items = 0;
    for (const held of this.list) items += held.items.length;
    return { rows: this.list.length, items, placed: this.placed, sounding: this.sounding, files: Object.fromEntries(this.ready), preview: this.prevH !== null ? this.prevFile : null };
  }
}
