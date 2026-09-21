// The interface's glyphs: which mark stands for which ability, which gadget and which thing in a
// hand, and how the sheet they are drawn on reaches the page.
//
// Every glyph is ours, drawn by hand in `src/ui/hud.svg`; nothing on the screen is a picture from
// the archives. Which power gets which mark is ours too, and it is the table below: it is keyed on
// the ability's own name as the class hands it over (`KitSlot.name`), because a slot carries its
// name and its cost and no id, and a name is the one thing both classes already have. A name the
// table does not know falls through a handful of plain word tests (anything with "grenade" in it is
// a grenade) and then to a last-resort mark, so a power added to the game later shows something
// rather than an empty cell.
//
// The sheet is fetched once at boot and put in a hidden corner of the page. Every use of a glyph is
// `<svg class="ic"><use href="#ic-…"/></svg>`, which is static markup: it is written when a row is
// built and never touched again, so a glyph costs nothing per frame.
//
// Nothing here throws without a document: a node test can import this file, read the table and
// never touch the page.

/** Every glyph on the sheet, in the order it is drawn there. `hudIcons.test.ts` checks the file against this. */
export const ICON_IDS = [
  'ic-force-jump',
  'ic-force-speed',
  'ic-force-push',
  'ic-force-pull',
  'ic-force-lightning',
  'ic-force-drain',
  'ic-force-grip',
  'ic-force-repulse',
  'ic-force-slow',
  'ic-force-heal',
  'ic-force-protect',
  'ic-force-rage',
  'ic-fists',
  'ic-grenade',
  'ic-detonator',
  'ic-mine',
  'ic-pack',
  'ic-stim',
  'ic-flame',
  'ic-net',
  'ic-scanner',
  'ic-wing-closed',
  'ic-wing-opening',
  'ic-wing-open',
  'ic-wing-held',
  'ic-saber',
  'ic-blaster',
  'ic-hand',
  'ic-hit',
  'ic-system',
  'ic-pencil',
  'ic-plus',
  'ic-speech',
] as const;

export type IconId = (typeof ICON_IDS)[number];

/** The mark shown when nothing else fits. Never an empty cell. */
export const ICON_FALLBACK: IconId = 'ic-system';

/**
 * Which mark stands for which ability, keyed on the ability's name with everything but its letters
 * taken out, so "Force Speed", "force speed" and "Force-Speed" are one key. Ours, every line of it.
 */
const BY_NAME: Record<string, IconId> = {
  // the Force
  forcejump: 'ic-force-jump',
  forcespeed: 'ic-force-speed',
  forcepush: 'ic-force-push',
  forcepull: 'ic-force-pull',
  forcelightning: 'ic-force-lightning',
  forcedrain: 'ic-force-drain',
  forcegrip: 'ic-force-grip',
  forcerepulse: 'ic-force-repulse',
  forceslow: 'ic-force-slow',
  forceheal: 'ic-force-heal',
  forceprotect: 'ic-force-protect',
  forcerage: 'ic-force-rage',
  // the gadgets
  thermaldetonator: 'ic-detonator',
  imperialdetonator: 'ic-detonator',
  fragmentationgrenade: 'ic-grenade',
  protongrenade: 'ic-grenade',
  cryobangrenade: 'ic-grenade',
  glopgrenade: 'ic-net',
  poisongrenade: 'ic-grenade',
  bugbomb: 'ic-grenade',
  tripmine: 'ic-mine',
  detpack: 'ic-pack',
  stimpack: 'ic-stim',
  // in both lists
  barehands: 'ic-fists',
  lightsaber: 'ic-saber',
};

/**
 * The word tests a name falls through when the table has no line for it, in order. They are here so
 * that an ability added to the game after this file shows a mark that means something without
 * anyone having to remember this file exists.
 */
const BY_WORD: readonly (readonly [string, IconId])[] = [
  ['saber', 'ic-saber'],
  ['grenade', 'ic-grenade'],
  ['detonator', 'ic-detonator'],
  ['bomb', 'ic-grenade'],
  ['mine', 'ic-mine'],
  ['pack', 'ic-pack'],
  ['stim', 'ic-stim'],
  ['heal', 'ic-force-heal'],
  ['flame', 'ic-flame'],
  ['net', 'ic-net'],
  ['scan', 'ic-scanner'],
  ['lightning', 'ic-force-lightning'],
  ['speed', 'ic-force-speed'],
  ['jump', 'ic-force-jump'],
  ['push', 'ic-force-push'],
  ['pull', 'ic-force-pull'],
  ['grip', 'ic-force-grip'],
  ['drain', 'ic-force-drain'],
  ['slow', 'ic-force-slow'],
  ['protect', 'ic-force-protect'],
  ['rage', 'ic-force-rage'],
  ['fist', 'ic-fists'],
  ['hand', 'ic-fists'],
];

/** A name to a key: its letters and digits, lower case. Allocates one string; never called in a frame. */
export function iconKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The mark for an ability, a gadget or anything else that carries a name. Never empty. */
export function glyphFor(name: string): IconId {
  const key = iconKey(name);
  const hit = BY_NAME[key];
  if (hit) return hit;
  for (const [word, id] of BY_WORD) if (key.includes(word)) return id;
  return ICON_FALLBACK;
}

/**
 * The mark for a weapon in a hand. The weapon's class is what the rack calls it (`WeaponDef.class`:
 * `rifle`, `pistol`, `carbine`, `sword`, `polearm`, …); with none, its name is tried, and a weapon
 * whose name and class say nothing gets the open hand.
 *
 * A hand holding nothing never reaches here: an empty hand's cell is taken off the screen rather
 * than shown holding a mark for nothing, so the open hand is the last resort for something that is
 * held and not recognised.
 */
export function handGlyph(weaponClass?: string | null, name?: string | null): IconId {
  const cls = weaponClass ? iconKey(weaponClass) : '';
  if (cls) {
    if (cls.includes('saber')) return 'ic-saber';
    if (cls.includes('rifle') || cls.includes('pistol') || cls.includes('carbine') || cls.includes('heavy')) return 'ic-blaster';
    if (cls.includes('thrown') || cls.includes('grenade')) return 'ic-grenade';
    if (cls.includes('sword') || cls.includes('polearm') || cls.includes('axe') || cls.includes('baton') || cls.includes('knife')) return 'ic-saber';
    if (cls.includes('unarmed')) return 'ic-fists';
  }
  if (name) {
    const key = iconKey(name);
    for (const [word, id] of BY_WORD) if (key.includes(word)) return id;
  }
  return 'ic-hand';
}

/**
 * The four wing states, in the order the flight display numbers them (none, closed, opening, open,
 * held). Drawn and waiting: the flight display says the wings in a word today, and the file that
 * draws it is not this pass's to open. It is two lines there whenever it next is.
 */
export const WING_GLYPHS: readonly (IconId | '')[] = ['', 'ic-wing-closed', 'ic-wing-opening', 'ic-wing-open', 'ic-wing-held'];

/**
 * The mark beside a line of a kind on the message line. Drawn and waiting for the same reason as the
 * wings: the message line is another file, and it reads well without them — each kind already has a
 * colour of its own — so this is a nicety rather than a gap.
 */
export const KIND_GLYPHS: Record<string, IconId> = {
  system: 'ic-system',
  'you hit': 'ic-hit',
  'hit you': 'ic-hit',
  spatial: 'ic-speech',
  note: 'ic-system',
};

// -------------------------------------------------------------------------------------------------
// The sheet, and the page.

/**
 * Where the sheet lives. Resolved against this module rather than written as a path, so the builder
 * rewrites it to wherever the file is served from and a node test that imports this module never
 * looks at it at all.
 */
const SHEET_URL = new URL('./hud.svg', import.meta.url).href;

let installing: Promise<number> | null = null;
let symbols = 0;

/** How many glyphs the page is holding: 0 until the sheet has arrived. `__debug` reads it. */
export function iconCount(): number {
  return symbols;
}

/**
 * Fetch the sheet once and put it in a hidden corner of the page. Safe to call again (the second
 * call is the first call's promise) and safe to call with no document, where it does nothing and
 * says so with a 0. A `<use>` written before the sheet lands draws as soon as it does, so nothing
 * has to wait for this.
 */
export function installIcons(): Promise<number> {
  if (installing) return installing;
  // No page, no body to hang it on, or nothing to fetch with: a node test importing this file for
  // the table alone must not reach for a file it will never draw.
  if (typeof document === 'undefined' || !document.body || typeof fetch !== 'function') {
    installing = Promise.resolve(0);
    return installing;
  }
  installing = fetch(SHEET_URL)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
    .then((text) => {
      const host = document.createElement('div');
      host.id = 'hud-icons';
      // Out of the flow and out of the way: the sheet is a store of marks, never a thing on screen.
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      host.innerHTML = text;
      document.body.appendChild(host);
      symbols = host.querySelectorAll('symbol').length;
      return symbols;
    })
    .catch((e: unknown) => {
      // A missing sheet costs the marks and nothing else: every cell still has its key and its
      // border, and the interface goes on. Said once, because it is a build problem and not a
      // playing one.
      console.warn(`the interface's glyphs could not be read (${String(e)}); the cells keep their keys`);
      symbols = 0;
      return 0;
    });
  return installing;
}

// A glyph is written as markup where a row is built — `<svg class="ic"><use href="#ic-…"/></svg>` —
// and never touched again, so there is nothing here that builds one or points an existing one
// somewhere else. Two such helpers were written and nothing ever called them; a file the whole
// interface reads should carry what it is asked for and no more.
