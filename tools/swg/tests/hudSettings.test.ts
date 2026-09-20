// The display's own settings (src/core/settings.ts): the eight keys, their three ranges, and the
// round trip through storage.
//
// Two things are pinned here that cost real bugs elsewhere. First, `loadSettings` keeps a saved
// value only when its primitive type matches the default's, so a key whose default is the wrong kind
// of value is silently dropped for ever: every one of the eight is checked against the kind the
// menu and the display expect. Second, `saveSettings` writes only what differs from the defaults, so
// a value clamped on the way in but stored unclamped would sit in the browser for good; the ranges
// are checked to contain their own defaults, which is what makes "clamp to the range" safe to apply
// to a stored value.
//
// Everything here is synthetic: a stand-in for `localStorage`, and made-up values. Nothing is read
// from the game's own files and no browser is needed.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a stand-in for the browser's storage --------------------------------------------------------
// `loadSettings` and `saveSettings` reach for `localStorage` inside a try, so with none at all they
// quietly do nothing. This one is a plain map, which is all either of them uses.
const bag = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
  setItem: (k: string, v: string) => void bag.set(k, v),
  removeItem: (k: string) => void bag.delete(k),
};

const { DEFAULT_SETTINGS, HUD_SCALE_RANGE, HUD_DPR_RANGE, HUD_LINES_RANGE, loadSettings, saveSettings } = await import('../../../src/core/settings.ts');

// The eight keys and the kind of value each must carry.
const HUD_KEYS = [
  ['hudScale', 'number'],
  ['hudDpr', 'number'],
  ['hudShipCondition', 'boolean'],
  ['hudTargetBlock', 'boolean'],
  ['hudArcs', 'boolean'],
  ['hudMessages', 'boolean'],
  ['hudMessageLines', 'number'],
  ['hudFullPrompts', 'boolean'],
] as const;

// -------------------------------------------------------------------------------------------
// The keys themselves.
{
  for (const [key, kind] of HUD_KEYS) {
    const v = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    ok(v !== undefined, `${key} has a default`);
    ok(typeof v === kind, `${key}'s default is a ${kind} (it is ${typeof v}), which is what loadSettings keeps a saved one by`);
  }
  ok(new Set(HUD_KEYS.map(([k]) => k)).size === HUD_KEYS.length, 'no key is named twice');
}

// -------------------------------------------------------------------------------------------
// The three ranges.
{
  for (const [name, range] of [
    ['scale', HUD_SCALE_RANGE],
    ['dpr', HUD_DPR_RANGE],
    ['lines', HUD_LINES_RANGE],
  ] as const) {
    ok(range.min < range.max, `the ${name} range runs from its low end to its high one (${range.min}..${range.max})`);
    ok(Number.isFinite(range.min) && Number.isFinite(range.max), `the ${name} range is two real numbers`);
  }
  const clamp = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));
  ok(clamp(DEFAULT_SETTINGS.hudScale, HUD_SCALE_RANGE) === DEFAULT_SETTINGS.hudScale, `the scale range contains its own default (${DEFAULT_SETTINGS.hudScale})`);
  ok(clamp(DEFAULT_SETTINGS.hudDpr, HUD_DPR_RANGE) === DEFAULT_SETTINGS.hudDpr, `the backing store range contains its own default (${DEFAULT_SETTINGS.hudDpr})`);
  ok(clamp(DEFAULT_SETTINGS.hudMessageLines, HUD_LINES_RANGE) === DEFAULT_SETTINGS.hudMessageLines, `the line-count range contains its own default (${DEFAULT_SETTINGS.hudMessageLines})`);
  // What the console helper does with a wild value, spelled out here so the ends are pinned.
  ok(clamp(12, HUD_SCALE_RANGE) === HUD_SCALE_RANGE.max, 'a scale far over the top clamps to the top');
  ok(clamp(-4, HUD_SCALE_RANGE) === HUD_SCALE_RANGE.min, 'a scale under the bottom clamps to the bottom');
  ok(clamp(Math.round(99), HUD_LINES_RANGE) === HUD_LINES_RANGE.max, 'a line count far over the top clamps to the top');
}

// -------------------------------------------------------------------------------------------
// The round trip: nothing saved, something saved, and a saved value of the wrong kind.
{
  bag.clear();
  const fresh = loadSettings();
  for (const [key] of HUD_KEYS) {
    const a = (fresh as unknown as Record<string, unknown>)[key];
    const b = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    ok(a === b, `with nothing saved, ${key} is its default`);
  }

  const changed = { ...fresh, hudScale: 1.25, hudArcs: false, hudMessageLines: 4 };
  saveSettings(changed);
  const back = loadSettings();
  ok(back.hudScale === 1.25, 'a scale saved comes back');
  ok(back.hudArcs === false, 'a switch turned off comes back off');
  ok(back.hudMessageLines === 4, 'a line count saved comes back');
  ok(back.hudFullPrompts === DEFAULT_SETTINGS.hudFullPrompts, 'a key left alone is still its default');

  // Only what differs is written, which is what keeps an added key's new default reaching a player
  // who saved before it existed.
  const written = JSON.parse(bag.get('swg.settings') ?? '{}') as Record<string, unknown>;
  ok(!('hudDpr' in written), 'a key at its default is not written to storage');
  ok(written.hudScale === 1.25, 'a key away from its default is');

  // A value of the wrong kind is dropped rather than taken: this is the failure the type check is for.
  bag.set('swg.settings', JSON.stringify({ hudScale: 'large', hudArcs: 1, hudMessages: 'yes' }));
  const bad = loadSettings();
  ok(bad.hudScale === DEFAULT_SETTINGS.hudScale, 'a scale saved as words falls back on the default');
  ok(bad.hudArcs === DEFAULT_SETTINGS.hudArcs, 'a switch saved as a number falls back on the default');
  ok(bad.hudMessages === DEFAULT_SETTINGS.hudMessages, 'a switch saved as words falls back on the default');

  // Nothing stored at all (a private window, storage blocked) must not throw.
  bag.clear();
  ok(loadSettings().hudScale === DEFAULT_SETTINGS.hudScale, 'an empty store is the defaults');
}

console.log(`\n${checks} checks passed`);
