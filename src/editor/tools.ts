// The world editor's Tools list (Map-maker II, DESIGN.md §2.3): every tool that takes the buttons over while it is armed --
// the scatter brush (Map-maker I's third wave, on B, behaving exactly as it was built), the sculpt brush (K) and the tools
// the later waves add -- one list, one armed at a time. Arming another disarms the first; Escape, taking anything in hand,
// the world going and leaving the editor disarm whatever is armed. While a tool is armed no click picks, boxes or orbits, a
// Point click never goes back to Fly, the selection takes no hold (C with the wheel sizes the tool whatever is picked), and
// the bar shows the tool in place of the hand: the brush's own rules of Map-maker I, now the list's.
//
// **Every brush keeps one set of conventions**: the left button applies and the right the inverse (`ToolFrame.apply`,
// `inverse`), C held with the wheel sizes it (`size`), Shift+click samples what is under it and writes nothing (`sample`),
// the ring is the scatter brush's own (`ToolDraw.ring`, a second one at the hardness), its stamps come on the scatter
// brush's clock at its own rate whatever the frame rate, and Ctrl ends a stroke (the editor's own rule while Ctrl is held).
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties. The dev server's alone: reached only through the editor's own
// dynamic import.

import type { Action } from '../core/input.ts';
import type { MarksView } from '../ui/editorMarks.ts';

/**
 * What an armed tool is handed each frame, one kept record the editor writes (numbers ride a record, never a call the
 * compiler may leave out): the buttons (Fly's from the key block before the mutes, Point's off the pointer over the canvas,
 * both up while Ctrl is held), Shift, where the aim meets the world and whether it met anything, the frame's seconds and the
 * moment. Fractions from the start.
 */
export interface ToolFrame {
  apply: boolean;
  inverse: boolean;
  shift: boolean;
  /** Shift+click this frame (a press of the left button with Shift held): sample, write nothing. */
  sampled: boolean;
  x: number;
  y: number;
  z: number;
  valid: boolean;
  dt: number;
  now: number;
}

/** A frame's record, made once. */
export function toolFrame(): ToolFrame {
  return { apply: false, inverse: false, shift: false, sampled: false, x: 0.5, y: 0.5, z: 0.5, valid: false, dt: 0.016, now: 0.5 };
}

/**
 * What a tool draws on with: the marks the editor hands the overlay, and the ring round the aim at `radius` (written first:
 * a number rides the record, never the call), `slot` 0 the brush's own and 1 its hardness, projected on the ground the
 * world has built (never a block made for it). Nothing is made.
 */
export interface ToolDraw {
  readonly marks: MarksView;
  radius: number;
  ring(slot: 0 | 1): void;
}

/** One tool of the list. */
export interface ToolDef {
  /** Its name in the list, the console's and the Tools tab's. */
  readonly id: string;
  /** The action that arms and disarms it (its key), or null for one armed from the Tools tab alone. */
  readonly action: Action | null;
  /** What the bar and the Tools tab call it. */
  readonly label: string;
  armed(): boolean;
  /** Armed (its packs in, what it writes worked out), or refused: answers what was said, `armed()` saying which. */
  arm(): Promise<string>;
  /** Let go: a stroke under way ended (and recorded) as it would be by its button let go. */
  disarm(): void;
  /** One frame, armed, after the camera. */
  step(f: ToolFrame): void;
  /** Its marks, armed, from this frame's camera. */
  draw(d: ToolDraw): void;
  /** Whether a button is its own while it is armed (the left and right are every brush's; the middle the eyedropper's). */
  owns(button: 'apply' | 'inverse' | 'middle'): boolean;
  /** C held with the wheel: its size stepped `notches` times (up larger). Answers what was said, or null for a tool with no size. */
  size?(notches: number): string | null;
  /** The bar's words for it while armed. */
  barWords?(): string;
  /** What the console says of it. */
  report?(): Record<string, unknown>;
}

/** The list, one armed at a time. */
export class ToolList {
  readonly list: ToolDef[] = [];

  /** A tool added at the end; the scatter brush is the first (`editorEntry.ts`). */
  add(t: ToolDef): ToolDef {
    if (this.list.some((x) => x.id === t.id)) throw new Error(`a tool named ${t.id} is in the list already`);
    this.list.push(t);
    return t;
  }

  byId(id: string): ToolDef | null {
    return this.list.find((t) => t.id === id) ?? null;
  }

  /** The tool armed now, or null. */
  get armedTool(): ToolDef | null {
    for (const t of this.list) if (t.armed()) return t;
    return null;
  }

  /** Whether any tool is armed: what the editing and the clicks ask (`toolArmed`). */
  toolArmed(): boolean {
    return this.armedTool !== null;
  }

  /**
   * A tool armed, every other let go first, so two are never armed at once; the one armed already is let go instead (its
   * key is a toggle). Answers what was said.
   */
  async arm(id: string): Promise<string> {
    const t = this.byId(id);
    if (!t) return `no tool called ${id}`;
    if (t.armed()) {
      t.disarm();
      return `${t.label} let go`;
    }
    for (const o of this.list) if (o !== t && o.armed()) o.disarm();
    const said = await t.arm();
    // Something else armed while it was arming (its packs are awaited): this one wins, the last asked for.
    if (t.armed()) for (const o of this.list) if (o !== t && o.armed()) o.disarm();
    return said;
  }

  /** Whatever is armed let go: Escape, a thing taken in hand, the world going, leaving the editor. Answers whether anything was. */
  disarmAll(): boolean {
    let any = false;
    for (const t of this.list) {
      if (!t.armed()) continue;
      t.disarm();
      any = true;
    }
    return any;
  }

  /** The list as the console and the Tools tab show it: each tool, its key as bound now and whether it is armed. */
  report(keyOf: (a: Action) => string): { id: string; label: string; key: string; armed: boolean }[] {
    return this.list.map((t) => ({ id: t.id, label: t.label, key: t.action ? keyOf(t.action) : '', armed: t.armed() }));
  }
}
