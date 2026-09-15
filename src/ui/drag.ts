// Panels that move: a panel dragged by its header goes where it is put and stays there, in this
// browser, so the world behind a settings page or the map can be looked at while it is open.
// The overlay round a panel is clear; only the panel itself is drawn.

const STORAGE_KEY = 'swg3js.panels';

function saved(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function save(id: string, at: { x: number; y: number } | null): void {
  try {
    const all = saved();
    if (at) all[id] = at;
    else delete all[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // No storage: the place lasts this session.
  }
}

/**
 * Let the panel inside `root` be dragged by its handle. The panel is centred by the overlay until
 * it is moved; from then on it sits at a fixed place, kept within the window and remembered under
 * `id`. An overlay in its `creation` form (the character creator, which sizes the panel to the
 * screen) leaves the panel where the layout puts it.
 */
export function draggable(root: HTMLElement, panelSelector: string, handleSelector: string, id: string): void {
  const panel = root.querySelector<HTMLElement>(panelSelector);
  const handle = root.querySelector<HTMLElement>(handleSelector);
  if (!panel || !handle) return;
  handle.classList.add('drag-handle');
  let at = saved()[id] ?? null;

  const clamp = (x: number, y: number) => {
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    return { x: Math.max(0, Math.min(window.innerWidth - w, x)), y: Math.max(0, Math.min(window.innerHeight - h, y)) };
  };
  const place = () => {
    if (root.classList.contains('creation') || !at) {
      panel.style.position = '';
      panel.style.left = '';
      panel.style.top = '';
      return;
    }
    const c = clamp(at.x, at.y);
    panel.style.position = 'fixed';
    panel.style.left = `${c.x}px`;
    panel.style.top = `${c.y}px`;
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || root.classList.contains('creation')) return;
    // A control in the header is for pressing, not for dragging by.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a')) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      at = { x: ev.clientX - dx, y: ev.clientY - dy };
      place();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (at) {
        at = clamp(at.x, at.y);
        save(id, at);
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  // Placed again whenever the panel is shown (or the creator takes it over), and kept on screen when the window shrinks.
  new MutationObserver(place).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);
  place();
}
