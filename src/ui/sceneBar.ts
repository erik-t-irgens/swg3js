// The places a character stands in, and the row that offers them.
//
// The creation and selection screens draw the figure over a picture of somewhere the owner stood
// and liked. This holds the list of those places, the row of buttons that picks between them, and
// the one rule that matters more than any of it: **with no pictures rendered, this answers null and
// every screen is exactly what it was.** Nothing here is required for the game to work.
//
// The hours are the owner's own captures rather than a slider, which is deliberate. Every one of
// the sixty-seven was chosen by standing there and looking, and none of them is at night: a free
// slider would offer a hundred times when a face cannot be seen at all, and would be offering the
// player a worse version of a judgement that has already been made.

import type { BackdropRender } from '../world/sceneBackdrop.ts';
import { isCreatorShot } from '../world/sceneBackdrop.ts';
import { previewSceneOf, type PreviewScene } from './characterPreview.ts';

/** One captured hour of one place, as the manifest carries it. */
export interface SceneHour {
  name: string;
  hour: number;
  /** Where the picture is, under the scenes folder. */
  path: string;
  /** What this button says. */
  label: string;
  light: { dir: [number, number, number]; main: string; mainScale: number; ambient: string } | null;
}

/** One place, with its camera and every hour of it that was rendered. */
export interface SceneShotRecord {
  key: string;
  pack: string;
  place: string | null;
  stand: { x: number; y: number; z: number; heading: number };
  camera: { x: number; y: number; z: number; look: { x: number; y: number; z: number }; fov: number };
  ship: { x: number; y: number; z: number; heading: number } | null;
  hours: SceneHour[];
}

export interface SceneLibrary {
  render: BackdropRender;
  shots: SceneShotRecord[];
}

const MANIFEST = 'assets-private/scenes/manifest.json';
const REMEMBERED = 'swg3js.scene';

let pending: Promise<SceneLibrary | null> | null = null;

/**
 * The places, fetched once a session.
 *
 * A missing manifest is not an error and is not reported as one: it means the backdrops have not
 * been rendered on this machine, which is the ordinary state of a fresh checkout. Anything a
 * screen does with the answer must cope with null.
 */
export function loadSceneLibrary(): Promise<SceneLibrary | null> {
  pending ??= (async () => {
    try {
      const res = await fetch(MANIFEST);
      if (!res.ok) return null;
      const lib = (await res.json()) as SceneLibrary;
      if (!lib?.render || !Array.isArray(lib.shots) || !lib.shots.length) return null;
      // A shot with no hours rendered would be a place that cannot be shown; drop it rather than
      // offering a button that draws nothing.
      lib.shots = lib.shots.filter((s) => Array.isArray(s.hours) && s.hours.length > 0);
      return lib.shots.length ? lib : null;
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Where a picture lives, as the browser fetches it. */
export function backdropUrl(path: string): string {
  return `assets-private/scenes/${path}`;
}

/** What the player last chose, so a screen opens where they left it. */
function remembered(): { key?: string; hour?: string; light?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(REMEMBERED) ?? '{}') as { key?: string; hour?: string; light?: boolean };
  } catch {
    return {};
  }
}

function remember(v: { key: string; hour: string; light: boolean }): void {
  try {
    localStorage.setItem(REMEMBERED, JSON.stringify(v));
  } catch {
    // A browser with storage refused still shows the places; it just forgets between visits.
  }
}

const SCENE_BAR_CSS = `
.scene-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 12px 12px; pointer-events: none; }
.scene-bar[hidden] { display: none; }
.scene-bar .scene-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; pointer-events: auto; }
.scene-bar button { pointer-events: auto; font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
.scene-bar button:hover { color: var(--ink); border-color: var(--edge); }
.scene-bar button[aria-pressed="true"] { color: var(--void); background: var(--accent); border-color: var(--accent); }
.scene-bar .scene-place { font-size: 11px; letter-spacing: 0.06em; color: var(--ink); min-width: 9em; text-align: center; }
.scene-bar .scene-world { color: var(--muted); }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = SCENE_BAR_CSS;
  document.head.appendChild(style);
}

/** A place's name for the row: what the world called it, else the world itself. */
export function placeWords(shot: SceneShotRecord): { place: string; world: string } {
  const world = shot.pack.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { place: shot.place ?? world, world: shot.place ? world : '' };
}

/**
 * The row under the figure: which place, which hour of it, and whether the figure has a light of
 * its own. It builds its own element and tells the screen what was picked; it never touches the
 * doll, so a screen can use it without a preview at all.
 */
export class SceneBar {
  readonly element: HTMLElement = document.createElement('div');
  private lib: SceneLibrary | null = null;
  private shots: SceneShotRecord[] = [];
  private at = 0;
  private hourAt = 0;
  private light = false;
  private readonly placeEl: HTMLElement;
  private readonly hoursEl: HTMLElement;
  private readonly lightEl: HTMLButtonElement;

  constructor(private readonly onScene: (scene: PreviewScene | null) => void, private readonly onLight: (on: boolean) => void) {
    installStyle();
    this.element.className = 'scene-bar';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="scene-row scene-places">
        <button class="scene-prev" type="button" title="The place before">&lt;</button>
        <span class="scene-place"></span>
        <button class="scene-next" type="button" title="The next place">&gt;</button>
      </div>
      <div class="scene-row scene-hours"></div>
      <div class="scene-row"><button class="scene-light" type="button" aria-pressed="false">Light on the character</button></div>`;
    this.placeEl = this.element.querySelector('.scene-place') as HTMLElement;
    this.hoursEl = this.element.querySelector('.scene-hours') as HTMLElement;
    this.lightEl = this.element.querySelector('.scene-light') as HTMLButtonElement;
    (this.element.querySelector('.scene-prev') as HTMLButtonElement).addEventListener('click', () => this.step(-1));
    (this.element.querySelector('.scene-next') as HTMLButtonElement).addEventListener('click', () => this.step(1));
    this.lightEl.addEventListener('click', () => this.setLight(!this.light));
  }

  /**
   * Give the row its places. `creatorOnly` keeps it to the three the creation screen offers; the
   * selection screen passes nothing and gets all of them.
   */
  setLibrary(lib: SceneLibrary | null, creatorOnly = false): void {
    this.lib = lib;
    this.shots = lib ? lib.shots.filter((s) => !creatorOnly || isCreatorShot(s.key)) : [];
    if (!this.shots.length) {
      this.element.hidden = true;
      this.onScene(null);
      return;
    }
    this.element.hidden = false;
    const was = remembered();
    const i = this.shots.findIndex((s) => s.key === was.key);
    this.at = i >= 0 ? i : 0;
    const h = this.shots[this.at].hours.findIndex((x) => x.name === was.hour);
    this.hourAt = h >= 0 ? h : this.middleHour(this.shots[this.at]);
    this.light = !!was.light;
    this.apply();
  }

  /** The hour to open on when nothing is remembered: the middle of what was captured, which is the most ordinary light of the place. */
  private middleHour(shot: SceneShotRecord): number {
    return Math.floor((shot.hours.length - 1) / 2);
  }

  private step(by: number): void {
    if (!this.shots.length) return;
    this.at = (this.at + by + this.shots.length) % this.shots.length;
    this.hourAt = this.middleHour(this.shots[this.at]);
    this.apply();
  }

  private setLight(on: boolean): void {
    this.light = on;
    this.lightEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.onLight(on);
    this.save();
  }

  private save(): void {
    const shot = this.shots[this.at];
    if (shot) remember({ key: shot.key, hour: shot.hours[this.hourAt]?.name ?? '', light: this.light });
  }

  /** Put the current choice on the screen and hand the scene over. */
  private apply(): void {
    const lib = this.lib;
    const shot = this.shots[this.at];
    if (!lib || !shot) return;
    const words = placeWords(shot);
    this.placeEl.innerHTML = `${escape(words.place)}${words.world ? ` <span class="scene-world">${escape(words.world)}</span>` : ''}`;

    // The hours, rebuilt for this place. A place with one hour still gets its button, because a
    // row that vanishes between places reads as something having gone wrong.
    this.hoursEl.textContent = '';
    shot.hours.forEach((h, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = h.label;
      b.setAttribute('aria-pressed', i === this.hourAt ? 'true' : 'false');
      b.addEventListener('click', () => {
        this.hourAt = i;
        this.apply();
      });
      this.hoursEl.appendChild(b);
    });
    this.lightEl.setAttribute('aria-pressed', this.light ? 'true' : 'false');

    const hour = shot.hours[this.hourAt] ?? shot.hours[0];
    this.onScene(previewSceneOf(shot, backdropUrl(hour.path), lib.render, hour.light));
    this.onLight(this.light);
    this.save();
    // The rest of this place's hours, fetched quietly, so pressing one of them does not flash.
    for (const other of shot.hours) {
      if (other === hour) continue;
      const img = new Image();
      img.src = backdropUrl(other.path);
    }
  }

  /** What is on the row now, for the console and for a screen that wants to say where it is. */
  describe(): { place: string | null; world: string | null; hour: string | null; hours: number; places: number; light: boolean } {
    const shot = this.shots[this.at];
    return { place: shot?.place ?? null, world: shot?.pack ?? null, hour: shot?.hours[this.hourAt]?.label ?? null, hours: shot?.hours.length ?? 0, places: this.shots.length, light: this.light };
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
