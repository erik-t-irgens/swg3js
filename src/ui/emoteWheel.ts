// The emote wheel: held open on a key, eight sectors round the middle of the screen, the mouse
// picks one by direction, and letting the key go plays it.
import { EMOTE_SLOTS, prettyEmote } from '../core/emotes';

export class EmoteWheel {
  readonly root: HTMLElement;
  private slots: (string | null)[] = [];
  private dx = 0;
  private dy = 0;
  private current = -1;
  open = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'emote-wheel';
    this.root.className = 'hidden';
    this.root.innerHTML = `<div class="wheel">${Array.from({ length: EMOTE_SLOTS }, (_, i) => `<div class="sector" data-i="${i}"><span></span></div>`).join('')}<div class="hub"></div></div><div class="wheel-hint">move the mouse to a slot · let go of the key to play · the Escape menu's Emotes page fills the slots</div>`;
    parent.appendChild(this.root);
  }

  show(slots: (string | null)[]): void {
    this.slots = slots;
    this.dx = 0;
    this.dy = 0;
    this.current = -1;
    this.open = true;
    const sectors = this.root.querySelectorAll<HTMLElement>('.sector');
    sectors.forEach((el, i) => {
      // Sector i sits at angle i * 45 degrees from the top, clockwise.
      const a = (i / EMOTE_SLOTS) * Math.PI * 2;
      const r = 118;
      el.style.left = `calc(50% + ${Math.sin(a) * r}px)`;
      el.style.top = `calc(50% - ${Math.cos(a) * r}px)`;
      el.querySelector('span')!.textContent = slots[i] ? prettyEmote(slots[i]!) : '—';
      el.classList.toggle('empty', !slots[i]);
      el.classList.remove('on');
    });
    this.root.querySelector<HTMLElement>('.hub')!.textContent = '';
    this.root.classList.remove('hidden');
  }

  /** The mouse moved while the wheel is open: the direction from the middle picks a sector, past a dead zone. */
  move(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
    const len = Math.hypot(this.dx, this.dy);
    // The vector keeps its direction but not much length, so the pick can swing round quickly.
    if (len > 60) {
      this.dx *= 60 / len;
      this.dy *= 60 / len;
    }
    const pick = len < 18 ? -1 : (Math.round((Math.atan2(this.dx, -this.dy) / (Math.PI * 2)) * EMOTE_SLOTS) + EMOTE_SLOTS) % EMOTE_SLOTS;
    if (pick === this.current) return;
    this.current = pick;
    this.root.querySelectorAll<HTMLElement>('.sector').forEach((el, i) => el.classList.toggle('on', i === pick));
    this.root.querySelector<HTMLElement>('.hub')!.textContent = pick >= 0 && this.slots[pick] ? prettyEmote(this.slots[pick]!) : '';
  }

  /** The clip under the mouse, or null. */
  selected(): string | null {
    return this.current >= 0 ? this.slots[this.current] : null;
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }
}
