// The flight's own lines on the HUD: the comms stack at the top centre, where NPC pilots taunt in
// the game's own words (three lines at most, each fading after six seconds), and the flown ship's
// condition above the health bar (shields and armour front and back, hull, boost, what is down).
// The status line is written at most four times a second, and only when its text changed.

/** Seconds a comms line stays, and the last of them it takes to fade. */
const LINE_SECONDS = 6;
const LINE_FADE = 1;
/** Comms lines shown at once. */
const MAX_LINES = 3;
/** Seconds between two writes of the status line. */
const STATUS_EVERY = 0.25;

/** What the status line shows: shares 0..1 (NaN where the ship has none of it), and the slots that are down. */
export interface ShipStatusLine {
  shield: [number, number];
  armour: [number, number];
  hull: number;
  boost: number;
  down: readonly string[];
}

/** A chassis slot in words, for "engine down". */
export function partWord(slot: string): string {
  if (slot === 'shield_0' || slot === 'shield_1') return 'shield generator';
  if (slot === 'droid_interface') return 'droid interface';
  const gun = /^weapon_(\d+)$/.exec(slot);
  if (gun) return `gun ${Number(gun[1]) + 1}`;
  return slot.replace(/_/g, ' ');
}

/** The maxima of the flown ship's stats (ShipCombat.stats): a layer or a booster whose maximum is 0 the ship has none of. */
export interface ShipStatusMax {
  readonly shieldMax: readonly number[];
  readonly armourMax: readonly number[];
  readonly boostSeconds: number;
}

/** A share as a whole percentage, or a dash where the ship has none. */
const pct = (share: number): string => (Number.isFinite(share) ? `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` : '–');
/** A share, or NaN (a dash, or no Boost at all) where the ship's maximum of it is 0: the status gives 0 there. */
const has = (share: number, max: number | undefined): number => (max === undefined || max > 0 ? share : NaN);

export class ShipHud {
  readonly root: HTMLElement;
  private readonly comms: HTMLElement;
  private readonly status: HTMLElement;
  private readonly lines: { el: HTMLElement; left: number }[] = [];
  /** Seconds since the page began, advanced by `update`, and when the status was last written. */
  private clock = 0;
  private statusAt = -Infinity;
  private statusText = '';
  private statusShown = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ship-hud';
    this.root.innerHTML = `<div class="comms"></div><div class="status hidden"></div>`;
    parent.appendChild(this.root);
    this.comms = this.root.querySelector<HTMLElement>('.comms')!;
    this.status = this.root.querySelector<HTMLElement>('.status')!;
  }

  /** A taunt: the speaker in the faction's colour, then the line; the oldest goes when a fourth comes. */
  say(speaker: string, text: string, color: string): void {
    if (this.lines.length >= MAX_LINES) this.lines.shift()!.el.remove();
    const el = document.createElement('div');
    el.className = 'comms-line';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = color;
    who.textContent = `${speaker}: `;
    const said = document.createElement('span');
    said.textContent = text;
    el.append(who, said);
    this.comms.appendChild(el);
    this.lines.push({ el, left: LINE_SECONDS });
  }

  /**
   * The ship flown, or null to hide the line; `max` (its stats) turns a share whose maximum is 0 into a dash, and
   * hides Boost on a ship with no booster. The text is made only when a write is due.
   */
  setStatus(s: ShipStatusLine | null, max?: ShipStatusMax | null): void {
    if (!s) {
      if (this.statusShown) {
        this.statusShown = false;
        this.status.classList.add('hidden');
      }
      return;
    }
    if (this.statusShown && this.clock - this.statusAt < STATUS_EVERY) return;
    this.statusAt = this.clock;
    const down = s.down.length ? ` · ${s.down.map((d) => `${partWord(d)} down`).join(', ')}` : '';
    const boostShare = has(s.boost, max?.boostSeconds);
    const boost = Number.isFinite(boostShare) ? ` · Boost ${pct(boostShare)}` : '';
    const text = `Shields F ${pct(has(s.shield[0], max?.shieldMax[0]))} B ${pct(has(s.shield[1], max?.shieldMax[1]))} · Armour F ${pct(has(s.armour[0], max?.armourMax[0]))} B ${pct(has(s.armour[1], max?.armourMax[1]))} · Hull ${pct(s.hull)}${boost}${down}`;
    if (text !== this.statusText) {
      this.statusText = text;
      this.status.textContent = text;
    }
    if (!this.statusShown) {
      this.statusShown = true;
      this.status.classList.remove('hidden');
    }
  }

  /** Fade the comms lines; once a frame. */
  update(dt: number): void {
    this.clock += dt;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.left -= dt;
      if (l.left <= 0) {
        l.el.remove();
        this.lines.splice(i, 1);
      } else if (l.left < LINE_FADE) l.el.style.opacity = (l.left / LINE_FADE).toFixed(2);
    }
  }

  /** Every comms line gone (the world left). */
  clear(): void {
    for (const l of this.lines) l.el.remove();
    this.lines.length = 0;
    this.setStatus(null);
  }
}
