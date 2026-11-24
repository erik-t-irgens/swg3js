// A lost graphics device said on the screen (the GPU port's pass 2, wave 6, maker K; the owner's Mac of 23 November, where the
// world went black with the interface and travel still working, and a closed and reopened tab drew it again). On WebGPU the
// browser can take the device away (a driver reset, the card's memory, the system's sleep); three then stops drawing and says
// so in the console alone (`Renderer._onDeviceLost`), so the page went on with a black world and nothing said. Now the screen
// says what was lost and why, and holds a Reload button over everything; a reload is the one way back, since every program,
// picture and buffer the game made belonged to the device that is gone. WebGPU's alone: `start.ts` hands three's
// `onDeviceLost` here after three's own; WebGL's context loss is left as it was.
//
// Colours only from the palette's names (`src/style.css`), nothing of the client's interface.

/** The overlay, made at the first loss: one a page. */
let shown: HTMLElement | null = null;

/** What the browser said, as the screen shows it: three's record of the loss (`message`, `reason`). */
export interface LostInfo {
  message?: unknown;
  reason?: unknown;
  api?: unknown;
}

/** The words for a loss: what went, why the browser said, and the way back. Pure, for the test. */
export function lostWords(info: LostInfo | null | undefined): { title: string; why: string; next: string } {
  const reason = typeof info?.reason === 'string' && info.reason ? info.reason : 'unknown';
  const message = typeof info?.message === 'string' && info.message ? info.message.slice(0, 300) : 'no message';
  return {
    title: 'The graphics device was lost',
    why: `The browser took the game's graphics device away (reason: ${reason}; ${message}). Nothing more can be drawn on it.`,
    next: 'Reload the page to start the graphics again.',
  };
}

/**
 * The loss on the screen, over everything, with a Reload button (focused, so Enter reloads). Said once in the console too.
 * Shown once a page: a second loss changes nothing. Never in a frame: three calls it when the device's `lost` promise settles.
 */
export function showDeviceLost(info: LostInfo | null | undefined, doc: Document = document, reload: () => void = () => location.reload()): HTMLElement {
  if (shown) return shown;
  const w = lostWords(info);
  console.error(`graphics: ${w.title.toLowerCase()} -- ${w.why}`);
  const root = doc.createElement('div');
  root.className = 'device-lost';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:var(--void);color:var(--ink);font:15px/1.5 system-ui,sans-serif;pointer-events:auto;';
  const box = doc.createElement('div');
  box.style.cssText = 'max-width:520px;margin:0 16px;padding:22px 24px;background:var(--panel);border:1px solid var(--edge);border-radius:6px;';
  const h = doc.createElement('div');
  h.textContent = w.title;
  h.style.cssText = 'font-size:20px;color:var(--warn);margin-bottom:10px;';
  const p1 = doc.createElement('p');
  p1.textContent = w.why;
  p1.style.cssText = 'margin:0 0 8px;color:var(--muted);';
  const p2 = doc.createElement('p');
  p2.textContent = w.next;
  p2.style.cssText = 'margin:0 0 16px;';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Reload';
  btn.className = 'device-lost-reload';
  btn.style.cssText = 'font:inherit;padding:8px 22px;background:var(--plate);color:var(--accent);border:1px solid var(--accent);border-radius:4px;cursor:pointer;';
  btn.addEventListener('click', () => reload());
  box.append(h, p1, p2, btn);
  root.append(box);
  // Keys stop here: the game's own keys would act on a world that no longer draws.
  root.addEventListener('keydown', (e) => e.stopPropagation());
  try {
    if (doc.pointerLockElement) doc.exitPointerLock();
  } catch {
    // No lock to let go.
  }
  doc.body.append(root);
  btn.focus();
  shown = root;
  return root;
}
