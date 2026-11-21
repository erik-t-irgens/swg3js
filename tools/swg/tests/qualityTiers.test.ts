// The quality slider's tiers (the GPU port's pass 1, wave 6; the design's section 9: `src/ui/qualityTiers.ts`, the slider in
// `src/ui/menu.ts`, the curtain in `src/main.ts`):
//
//   1. the table: every row an existing setting of the type its default is, a value for each of the four tiers (or none where
//      a tier leaves it), every value one the setting's own row on the page can hold, and the design's starting values pinned
//      as literals, not read back from the table
//   2. the render scale held to the screen's own: at one device pixel a point every tier draws at 1, at two the design's row
//   3. `tierOf`: each tier's settings read as that tier on every screen, any one of them moved reads Custom, the share counts
//      only for the upscaled tiers, and no two tiers stand alike on any screen
//   4. a new player starts on High (`startOnTier`): the game's defaults read High on every screen once started, saved where that
//      moved anything, and a setting a player moved is kept; a player who is not new (`isNewPlayer`: settings saved or a
//      character made) keeps every setting, the render scale at its default among them (wave 6's fixer)
//   5. the menu itself, built in a stand-in page: the slider is Picture's first row, its thumb and its words follow the
//      settings (Custom with the thumb at the nearest tier), a tier let go of is handed to the game whole (or, with no game,
//      written through the page's own setter in the table's order), a click under Custom takes the tier under the thumb, the
//      row is left off where the game says to hide it, and the page's reset writes nothing for it
//   6. the wiring, read as text: the game's tier and its curtain on WebGPU alone, the share handed to the smoothing at load and
//      on every move, a new player started on High on WebGPU alone with the WebGL line the line it had, `?gpu=low` asking for
//      the low-power adapter
//   7. a tier's settings kept across a save and a load
//
// Run: node tools/swg/tests/qualityTiers.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StandInPage, storage, type Element0 } from './standInPage.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const page = new StandInPage();
const store = storage();
page.install(store);

const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import('../../../src/core/settings.ts');
const Q = await import('../../../src/ui/qualityTiers.ts');
const { FLORA_RANGES, SHADOW_RANGES } = await import('../../../src/world/floraSettings.ts');
const { TAA_TUNE } = await import('../../../src/core/gpu/taa/taaTune.ts');
const { TIER_NAMES, TIER_KEYS, TIER_TABLE, TIER_LABELS, TIER_BUDGET, START_TIER, QUALITY_KNOB, tierOf, tierValues, tierNearest, renderScaleFor, startOnTier } = Q;
type S = typeof DEFAULT_SETTINGS;

const SCREENS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// ---------------------------------------------------------------- 1. the table

{
  ok(TIER_NAMES.join() === 'low,medium,high,ultra' && TIER_NAMES.every((t) => TIER_LABELS[t].length > 0) && TIER_LABELS.custom === 'Custom', 'four tiers, cheapest first, each with its words, and Custom for none of them');
  ok(START_TIER === 'high', 'a new player starts on High (the owner\'s answer to question 3)');
  ok(TIER_BUDGET.fps === 60 && TIER_BUDGET.percentile === 95 && Math.abs(TIER_BUDGET.mainMs - 16.6667) < 1e-3 && TIER_BUDGET.cardMs === TIER_BUDGET.mainMs, 'every tier holds 60 frames a second at p95 on the main thread and the card alike (16.7 ms each)');
  ok(Object.keys(TIER_TABLE).join() === TIER_KEYS.join(), `the table's rows are the tier keys, in order (${TIER_KEYS.join(', ')})`);
  for (const k of TIER_KEYS) {
    const row = TIER_TABLE[k] as readonly unknown[];
    ok(k in DEFAULT_SETTINGS, `${k} is an existing setting`);
    ok(row.length === 4 && row.every((v) => v === null || typeof v === typeof DEFAULT_SETTINGS[k as keyof S]), `${k}: a value for each tier, each of the setting's own type (${typeof DEFAULT_SETTINGS[k as keyof S]}) or left as it stands`);
  }
  // Every value one the setting's own row (or the console's bounds, for the share's dial) can hold.
  const inRange = (v: number, lo: number, hi: number, step?: number) => v >= lo && v <= hi && (step === undefined || Math.abs((v - lo) / step - Math.round((v - lo) / step)) < 1e-9);
  const n = (k: (typeof TIER_KEYS)[number]) => (TIER_TABLE[k] as readonly (number | null)[]).filter((v): v is number => v !== null);
  ok(n('renderScale').every((v) => inRange(v, 0.5, 2, 0.05)), 'the render scales stand on the Render scale row (0.5 to 2 by 0.05)');
  ok(n('smoothing').every((v) => v === 1 || v === 2), 'the smoothing is Full (1) or Upscaled (2), never Off');
  ok(n('smoothingShare').every((v) => inRange(v, 0.4, 1)), "the shares stand on the smoothing's share dial (0.4 to 1)");
  ok(n('shadowMapSize').every((v) => [1024, 2048, 4096].includes(v)), 'the shadow maps are the Shadow resolution row\'s own (1024, 2048, 4096)');
  ok(n('shadowDistance').every((v) => inRange(v, SHADOW_RANGES.shadowDistance.min, SHADOW_RANGES.shadowDistance.max, SHADOW_RANGES.shadowDistance.step)), 'the shadow distances stand on the Shadow distance row (80 to 800 m by 20)');
  ok(n('mobileCap').every((v) => Number.isInteger(v) && inRange(v, 5, 150)), 'the people caps are whole and inside the Spawned creatures and NPCs row (5 to 150)');
  ok(n('grassReach').every((v) => inRange(v, FLORA_RANGES.grassReach.min, FLORA_RANGES.grassReach.max)), 'the grass reaches stand inside the Grass distance row (0.5 to 3)');
  // The design's people caps and Ultra's grass fall between the steps of their rows' sliders (5, and 0.1): the setting holds the
  // tier's value, the slider's thumb stands at the step nearest it. Said, not failed: the values are the owner's to change.
  const offGrid = [...n('mobileCap').filter((v) => !inRange(v, 5, 150, 5)).map((v) => `people cap ${v}`), ...n('grassReach').filter((v) => !inRange(v, 0.5, 3, 0.1)).map((v) => `grass ${v}x`)];
  if (offGrid.length) console.log(`note between the steps of their own rows' sliders: ${offGrid.join(', ')}`);
  ok(n('floraTreeReach').every((v) => FLORA_RANGES.floraTreeReach.options.includes(v)), "the tree reaches are the Tree distance row's own options");
  // The upscaled tiers carry a share and the full ones leave it.
  const up = TIER_TABLE.smoothing.map((v) => v === 2);
  ok(TIER_TABLE.smoothingShare.every((v, i) => (v !== null) === up[i]), 'a share for exactly the tiers that draw upscaled');
  ok(TIER_KEYS.every((k) => k === 'smoothingShare' || (TIER_TABLE[k] as readonly unknown[]).every((v) => v !== null)), 'every other row sets a value in every tier');
  // The design's starting values, as literals (section 9's table; the owner's to change, and this with them).
  const want: Record<string, unknown[]> = {
    renderScale: [1, 1, 1.5, 2],
    smoothing: [2, 2, 1, 1],
    smoothingShare: [0.6, 0.7, null, null],
    shadowMapSize: [1024, 2048, 2048, 4096],
    shadowDistance: [120, 200, 320, 400],
    ssao: [false, true, true, true],
    mobileCap: [24, 32, 40, 60],
    grassReach: [0.6, 0.8, 1, 1.25],
    floraTreeReach: [256, 320, 0, 0],
  };
  for (const k of TIER_KEYS) ok(JSON.stringify(TIER_TABLE[k]) === JSON.stringify(want[k]), `${k} starts as the design has it (${JSON.stringify(want[k])})`);
  // High is the game's own defaults, the render scale and the unused share aside.
  const high = tierValues('high', 1) as Record<string, unknown>;
  ok(TIER_KEYS.every((k) => !(k in high) || high[k] === DEFAULT_SETTINGS[k as keyof S] || k === 'renderScale'), "High's every setting but the render scale is the game's default");
  ok(DEFAULT_SETTINGS.smoothingShare === TAA_TUNE.share, `the share's default is the smoothing dial's own start (${TAA_TUNE.share})`);
}

// ---------------------------------------------------------------- 2. the render scale held to the screen

{
  ok(TIER_NAMES.every((t) => renderScaleFor(t, 1) === 1), 'on a screen of one device pixel a point every tier draws at 1');
  ok(TIER_NAMES.map((t) => renderScaleFor(t, 2)).join() === '1,1,1.5,2', "on a screen of two, the design's row (1, 1, 1.5, 2)");
  ok(TIER_NAMES.map((t) => renderScaleFor(t, 1.25)).join() === '1,1,1.25,1.25', 'on a screen of 1.25, never above it');
  ok(TIER_NAMES.map((t) => renderScaleFor(t, 3)).join() === '1,1,1.5,2', 'on a screen of three, never above the tier');
  ok(renderScaleFor('ultra', 0) === 1 && renderScaleFor('ultra', -2) === 1, 'a screen that says nothing sensible is read as one');
  ok(Q.screenScale() === 1, "node's stand-in window, one device pixel a point, reads as 1");
}

// ---------------------------------------------------------------- 3. tierOf

const settingsAt = (tier: (typeof TIER_NAMES)[number], dpr: number, base: S = DEFAULT_SETTINGS): S => ({ ...structuredClone(base), ...tierValues(tier, dpr) }) as S;
{
  for (const dpr of SCREENS) {
    const read = TIER_NAMES.map((t) => tierOf(settingsAt(t, dpr), dpr));
    ok(read.join() === TIER_NAMES.join(), `at ${dpr} device pixels a point each tier's settings read as that tier (${read.join(', ')})`);
    const sets = TIER_NAMES.map((t) => JSON.stringify(tierValues(t, dpr)));
    ok(new Set(sets).size === 4, `at ${dpr} no two tiers stand alike`);
  }
  // Any one setting moved off a tier reads Custom; for the share, only where the tier draws upscaled.
  const nudge = (k: string, v: unknown): unknown => (typeof v === 'boolean' ? !v : k === 'shadowMapSize' ? (v === 4096 ? 1024 : 4096) : k === 'floraTreeReach' ? (v === 192 ? 128 : 192) : k === 'smoothing' ? (v === 1 ? 0 : 1) : (v as number) + 0.05);
  for (const t of TIER_NAMES) {
    for (const k of TIER_KEYS) {
      for (const dpr of [1, 2]) {
        const s = settingsAt(t, dpr) as unknown as Record<string, unknown>;
        s[k] = nudge(k, s[k]);
        const counts = k !== 'smoothingShare' || TIER_TABLE.smoothing[TIER_NAMES.indexOf(t)] === 2;
        const r = tierOf(s as unknown as S, dpr);
        if (counts) ok(r === 'custom', `${t} at ${dpr}: ${k} moved alone reads Custom`);
        else ok(r === t, `${t} at ${dpr}: the share moved alone stays ${t} (the tier draws at the screen's size)`);
      }
    }
  }
  // Under Custom the thumb stands at the tier held most of.
  const s = settingsAt('low', 1);
  s.ssao = true;
  ok(tierOf(s, 1) === 'custom' && tierNearest(s, 1) === 'low', "Low with the occlusion turned on reads Custom, the thumb at Low");
  ok(tierNearest(settingsAt('ultra', 2), 2) === 'ultra' && tierNearest(settingsAt('medium', 1), 1) === 'medium', 'a tier held, the thumb at it');
}

// ---------------------------------------------------------------- 4. a new player on High

{
  const { isNewPlayer } = Q;
  ok(isNewPlayer(false, 0) && !isNewPlayer(true, 0) && !isNewPlayer(false, 1) && !isNewPlayer(true, 3), 'a new player is one with no settings saved and no character, and nobody else (wave 6\'s fixer)');
  for (const dpr of SCREENS) {
    // The defaults as that screen's browser makes them: the render scale the screen's own up to 2.
    const defaults = { ...structuredClone(DEFAULT_SETTINGS), renderScale: Math.min(dpr, 2) } as S;
    const saves: S[] = [];
    const fresh = startOnTier(structuredClone(defaults), defaults, dpr, true, (x) => void saves.push(structuredClone(x)));
    ok(tierOf(fresh, dpr) === 'high', `a new player at ${dpr} device pixels a point starts on High (render scale ${fresh.renderScale})`);
    const changed = fresh.renderScale !== defaults.renderScale;
    ok(saves.length === (changed ? 1 : 0) && (!changed || tierOf(saves[0], dpr) === 'high'), `at ${dpr} the start is saved once where it moved anything (so it outlasts the first character made), never where it moved nothing (${saves.length})`);
    const moved = structuredClone(defaults);
    moved.renderScale = 0.75;
    moved.mobileCap = 90;
    const kept = startOnTier(moved, defaults, dpr, true, null);
    ok(kept.renderScale === 0.75 && kept.mobileCap === 90, `at ${dpr} what a player moved is kept`);
    // A player already here (settings saved, or a character made): nothing moved, whatever stands at its default (the review's
    // player at two device pixels a point with the shadows at 4096 and the render scale at its default, dropped to 1.5 unasked).
    const here = { ...structuredClone(defaults), shadowMapSize: 4096 } as S;
    const herSaves: S[] = [];
    const theirs = startOnTier(here, defaults, dpr, false, (x) => void herSaves.push(x));
    ok(theirs === here && theirs.renderScale === defaults.renderScale && theirs.shadowMapSize === 4096 && herSaves.length === 0, `at ${dpr} a player who is not new keeps the render scale at its default (${theirs.renderScale}) and nothing is saved`);
    const plain = startOnTier(structuredClone(defaults), defaults, dpr, false, null);
    ok(JSON.stringify(plain) === JSON.stringify(defaults), `at ${dpr} a player at every default who is not new keeps them all`);
  }
  const before = structuredClone(DEFAULT_SETTINGS);
  const saved: S[] = [];
  const out = startOnTier(before, DEFAULT_SETTINGS, 1, true, (x) => void saved.push(x));
  ok(out === before && JSON.stringify(out) === JSON.stringify(DEFAULT_SETTINGS) && saved.length === 0, 'on one device pixel a point the start changes nothing at all, saves nothing, and answers the settings it was handed');
  // The game's own save and read: a new player at two device pixels a point started, saved, and read back as a player who is
  // no longer new keeps High's 1.5 (the stand-in page's storage, emptied first and put back after).
  {
    const keep = store.getItem('swg.settings');
    store.removeItem('swg.settings');
    const { settingsSaved } = await import('../../../src/core/settings.ts');
    ok(settingsSaved() === false, 'with nothing saved, settingsSaved says so');
    const defaults2 = { ...structuredClone(DEFAULT_SETTINGS), renderScale: 2 } as S;
    const s2 = { ...structuredClone(defaults2) } as S;
    startOnTier(s2, defaults2, 2, isNewPlayer(settingsSaved(), 0), saveSettings);
    ok(s2.renderScale === 1.5 && settingsSaved() === true && JSON.parse(store.getItem('swg.settings') ?? '{}').renderScale === 1.5, `a new player at two device pixels a point is started on 1.5 and it is saved (${store.getItem('swg.settings')})`);
    const again = startOnTier(loadSettings(), defaults2, 2, isNewPlayer(settingsSaved(), 1), saveSettings);
    ok(again.renderScale === 1.5 && tierOf(again, 2) === 'high', `read again once a character is made, the player is not new and still on High (${again.renderScale})`);
    if (keep === null) store.removeItem('swg.settings');
    else store.setItem('swg.settings', keep);
  }
}

// ---------------------------------------------------------------- 5. the menu itself

/** `menu.ts`'s text made a module node can load (graphicsLayout.test.ts's own way): `import.meta.env` stood in, the constructor's parameter properties written out, relative imports made absolute. */
async function loadMenu(): Promise<{ Menu: new (parent: unknown, input: unknown, settings: unknown) => MenuLike }> {
  const text = readFileSync(join(REPO, 'src/ui/menu.ts'), 'utf8').replace(/\r\n/g, '\n');
  const from = join(REPO, 'src', 'ui');
  const out = text
    .replace(/import\.meta\.env\b/g, '({ DEV: true, BASE_URL: "/" })')
    .replace('constructor(parent: HTMLElement, private readonly input: Input, private readonly settings: Settings) {', 'constructor(parent: HTMLElement, input: Input, settings: Settings) {\n    this.input = input;\n    this.settings = settings;')
    .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href}'`);
  const dir = mkdtempSync(join(tmpdir(), 'ui-tiers-'));
  try {
    const file = join(dir, 'menu-tiers.ts');
    writeFileSync(file, out);
    return (await import(pathToFileURL(file).href)) as never;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface MenuLike {
  root: Element0;
  onSetting: (k: string, v: unknown) => void;
  onTier: ((t: string) => void) | null;
  onUiSound: (a: string) => void;
  knobState: (k: string) => { note?: string; off?: string; hide?: boolean } | null;
  show(page?: string): void;
}

{
  const M = await loadMenu();
  const input = { bindings: new Proxy({}, { get: () => ['Backquote'] }), resetBindings() {}, assignKey() {} };
  const build = (settings: S, calls: string[], tiers: string[] | null, hide = false) => {
    const parent = page.createElement('div');
    page.body.append(parent);
    const menu = new M.Menu(parent, input, settings);
    menu.onSetting = (k, v) => void calls.push(`${k}=${JSON.stringify(v)}`);
    menu.onUiSound = () => {};
    if (tiers) {
      // The game's own way: every value written into the menu's settings at once, the curtain after.
      menu.onTier = (t) => {
        tiers.push(t);
        Object.assign(settings, tierValues(t as never, 1));
      };
    }
    if (hide) menu.knobState = (k) => (k === 'smoothing' ? { hide: true } : null);
    menu.show('graphics');
    const body = menu.root.querySelector('.menu-body')!;
    return { menu, body, slider: () => body.querySelector('input[data-tier]') };
  };
  const readout = (el: Element0 | null) => el?.parent?.querySelector('.value')?.textContent ?? '';

  // At the defaults (one device pixel a point): High, the thumb at High.
  {
    const s = structuredClone(DEFAULT_SETTINGS);
    const b = build(s, [], []);
    const el = b.slider();
    ok(!!el && el.type === 'range' && el.min === '0' && el.max === '3' && el.step === '1', 'the slider is a range of the four tiers');
    const pic = b.body.querySelectorAll('.gfx-sec').find((x) => x.dataset.sec === 'Picture');
    ok(!!pic && pic.querySelectorAll('.knob')[0]?.querySelector('input[data-tier]') === el, "it is the first row of Picture, on the Picture and effects sub-tab");
    ok(el?.value === '2' && readout(el) === 'High', `at the defaults it reads High, the thumb at High (${el?.value}, ${readout(el)})`);
    ok(!el?.dataset.key && !b.body.querySelector('select[data-preset="smoothing"]'), "it carries no setting's key of its own and is no list of presets");
  }
  // Let go at Low: handed to the game whole, and the page drawn again reads Low.
  {
    const s = structuredClone(DEFAULT_SETTINGS);
    const calls: string[] = [];
    const tiers: string[] = [];
    const b = build(s, calls, tiers);
    page.enter(b.slider()!, '0', ['input']);
    ok(readout(b.slider()) === 'Low' && tiers.length === 0, 'dragged, its words follow the thumb and nothing is taken yet');
    page.enter(b.slider()!, '0', ['change']);
    ok(tiers.join() === 'low' && calls.length === 0, `let go, the tier is handed to the game whole and the page writes nothing itself (${tiers.join()}; ${calls.length} writes)`);
    ok(b.slider()?.value === '0' && readout(b.slider()) === 'Low', 'and the page drawn again reads Low, the thumb at Low');
    page.click(b.slider()!);
    ok(tiers.join() === 'low', 'a click on the thumb where the settings already hold its tier takes nothing again');
  }
  // With no game: written through the page's own setter, in the table's order, only what differs.
  {
    const s = structuredClone(DEFAULT_SETTINGS);
    const calls: string[] = [];
    const b = build(s, calls, null);
    page.enter(b.slider()!, '3', ['change']);
    const want = TIER_KEYS.filter((k) => k in tierValues('ultra', 1) && (tierValues('ultra', 1) as Record<string, unknown>)[k] !== DEFAULT_SETTINGS[k as keyof S]).map((k) => `${k}=${JSON.stringify((tierValues('ultra', 1) as Record<string, unknown>)[k])}`);
    ok(calls.join(' ') === want.join(' '), `with no game, Ultra is written through the page's setter in the table's order, only what differs (${calls.join(' ')})`);
    ok(tierOf(s, 1) === 'ultra' && readout(b.slider()) === 'Ultra', 'and the settings then read Ultra');
  }
  // A row moved alone: Custom, the thumb at the nearest; a click there takes that tier.
  {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.mobileCap = 90;
    const tiers: string[] = [];
    const b = build(s, [], tiers);
    ok(readout(b.slider()) === 'Custom' && b.slider()?.value === '2', `a people cap moved alone reads Custom, the thumb at High (${b.slider()?.value})`);
    page.click(b.slider()!);
    ok(tiers.join() === 'high' && readout(b.slider()) === 'High', 'a click on the thumb under Custom takes the tier under it');
  }
  // Left off where the game says to hide it (WebGL), and the reset writes nothing for it.
  {
    const s = structuredClone(DEFAULT_SETTINGS);
    const b = build(s, [], [], true);
    ok(!b.slider(), 'where the game hides the Smoothing row (WebGL) the slider is left off the page too');
    const calls: string[] = [];
    const c = build(structuredClone(DEFAULT_SETTINGS), calls, []);
    page.click(c.body.querySelector('.reset-gfx')!);
    const smooth = calls.filter((x) => x.startsWith('smoothing='));
    ok(smooth.length === 1 && calls[0].startsWith('renderScale='), `the page's reset writes nothing for the slider: the Smoothing row's own once, Render scale first (${smooth.length})`);
  }
  ok(QUALITY_KNOB.kind === 'preset' && QUALITY_KNOB.slider === true && QUALITY_KNOB.key === 'smoothing' && (QUALITY_KNOB.presets ?? []).map((p) => p.name).join() === TIER_NAMES.join(), "the slider's row: a preset of the four tiers drawn as a slider, on the Smoothing row's key");
  ok(!/biggest saving/.test(QUALITY_KNOB.hint), "its words do not take the Render scale row's own (the page's find test reads them)");
}

// ---------------------------------------------------------------- 6. the wiring, as text

{
  const lines = (f: string) => readFileSync(join(REPO, f), 'utf8').split(/\r?\n/).map((x) => x.trim());
  const main = lines('src/main.ts');
  const field = main.findIndex((x) => x.startsWith('private readonly settings: Settings ='));
  ok(field > 0 && main[field] === 'private readonly settings: Settings = GPU.webgpu ? startOnTier(loadSettings(), DEFAULT_SETTINGS, screenScale(), isNewPlayer(settingsSaved(), loadCharacters().length), saveSettings) : loadSettings();', 'main.ts: a new player (no settings saved, no character) starts on High on WebGPU alone and is saved, the WebGL branch the line it had');
  ok(main.filter((x) => x === 'if (GPU.webgpu) GPU.rt!.taa.setShare(S.smoothingShare);').length === 2, "main.ts: the share handed to the smoothing on WebGPU alone, at load and in applySetting");
  const share = main.indexOf("case 'smoothingShare':");
  ok(share > 0 && main.slice(share, share + 6).includes('if (GPU.webgpu) GPU.rt!.taa.setShare(S.smoothingShare);'), "main.ts: applySetting's case for the share");
  ok(main.includes('if (GPU.webgpu) this.menu.onTier = (tier) => this.applyQualityTier(tier);'), "main.ts: the menu's tier goes to the game on WebGPU alone");
  const apply = main.indexOf('private applyQualityTier(tier: TierName): void {');
  ok(apply > 0 && main[apply + 1] === 'if (!GPU.webgpu) return;', 'main.ts: applyQualityTier does nothing on WebGL');
  const body = main.slice(apply, apply + 16).join('\n');
  ok(/tierValues\(tier, screenScale\(\)\)/.test(body) && /saveSettings\(this\.settings\);/.test(body) && /this\.tierQueue = this\.tierQueue\.then\(\(\) => this\.tierCurtain\(TIER_LABELS\[tier\], moved\)\)/.test(body), 'main.ts: the tier written for this screen, saved, and queued behind its curtain');
  const cur = main.indexOf('private async tierCurtain(label: string, moved: readonly (keyof Settings)[]): Promise<void> {');
  const c = main.slice(cur, cur + 30);
  const at = (s: string) => c.findIndex((x) => x.includes(s));
  const order = [at('this.notice.set(`${words}: preparing shaders`);'), at('requestAnimationFrame(() => requestAnimationFrame(() => {'), at('for (const k of moved) this.applySetting(k);'), at('while (this.fxQueued || this.fxBusy)'), at('await this.world.compileAllAsync('), at('this.notice.set(this.volWarming || this.wispWarming.size > 0 ? VOL_WARM_NOTICE : null);')];
  ok(cur > 0 && order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `main.ts: the curtain puts its notice up and paints it, applies each setting moved, waits out the chain, sweeps the scene and takes the notice down, in that order (${order.join(', ')})`);
  ok(c.some((x) => x.includes('{ target: this.postfx ? this.postfx.compileTarget : null, keepQueue: true });')), "main.ts: the sweep is made for the target drawn now, the queue kept, as the Effects switch's");
  const start = readFileSync(join(REPO, 'src/core/gpu/start.ts'), 'utf8');
  ok(/setShare\(share: number\) \{\n\s*if \(Number\.isFinite\(share\)\) tuneTaa\(\{ share \}\);/.test(start.replace(/\r\n/g, '\n')), "start.ts: setShare goes through the dial's own setter");
  ok(start.includes("return new URLSearchParams(location.search).get('gpu') === 'low' ? 'low-power' : 'high-performance';") && start.includes('requestAdapter({ powerPreference: POWER })') && start.includes('powerPreference: POWER, stencil: true'), "start.ts: ?gpu=low asks for the low-power adapter, for the adapter read and three's alike");
  const menu = lines('src/ui/menu.ts');
  ok(menu.includes("for (const g of GRAPHICS) for (const k of g.knobs) if (!k.slider) this.setValue(k.key, DEFAULT_SETTINGS[k.key]);"), "menu.ts: the reset walks the table it draws, the slider aside");
  ok(menu.includes("const knob = all.find((k) => k.key === el.dataset.key && k.kind !== 'preset')!;"), "menu.ts: a row's control finds its own knob, never a preset on the same key");
}

// ---------------------------------------------------------------- 7. kept across a save and a load

{
  const s = loadSettings();
  Object.assign(s, tierValues('low', 1));
  saveSettings(s);
  const back = loadSettings();
  ok(tierOf(back, 1) === 'low' && back.smoothingShare === 0.6, `Low saved and loaded reads Low, its share kept (${back.smoothingShare})`);
  Object.assign(back, tierValues('high', 1));
  saveSettings(back);
  const again = loadSettings();
  ok(tierOf(again, 1) === 'high' && again.smoothingShare === 0.6, 'then High saved and loaded reads High, the share as Low left it (High draws at the screen\'s size)');
  store.kept.clear();
}

console.log(`\nqualityTiers: ${checks} checks passed`);
