// The paint brush (Map-maker II, DESIGN.md §2.5, W2, `groundBrush.ts` and `editorPaint.ts`), over a stand-in host:
//
//   - a held second (the aim still) paints the same cells at 30, 60 and 144 frames a second (its stamps on its own clock, `stampsDue`),
//     family and colour alike, byte for byte;
//   - a family cell takes the entry exactly where the stamp's weight reaches `cellAt` and is one family or the other;
//     erasing puts the world's own back (nought) and a tile left with nothing is taken out rather than written;
//   - a colour cell tends to the chosen colour and amount, its stamps laying 1 - e^-(colourRate n / rate) of the way, the
//     law held exactly at 5 and at 30 stamps a second;
//   - a stroke is written once, as its button is let go: one batch of the tiles it changed (and the palette, where it grew),
//     one undo entry; a refused write puts every tile back and takes the palette's unwritten entries out again;
//   - a family named with brackets is painted, and a name no file could hold is refused in words before the palette;
//   - the middle button and Shift+click take the family under the aim into the palette and choose it, writing nothing;
//   - (Map-maker II's third wave) a family of another world is lent first where it is not, through the host, once, then put
//     in the palette by its pack and name and chosen; a lending refused leaves the palette as it was, said; one lent already
//     (the middle button on a cell it paints) is taken as that world's with no lending asked;
//   - a space zone, the world of copies and a real-elevation world with no base family are refused in words;
//   - (the fourth wave's plants layer, through the same class) a held second paints the same flora cells at 30, 60 and 144
//     frames a second and by the colour's law; a stroke whose recipe the file has not got writes the recipes row ahead of
//     its tiles in its one batch; erasing keeps each cell's own recipe; where two recipes meet the other is faded out
//     first and the chosen one grows from nought; a refused write takes the recipe it carried out of memory; a recipe
//     that paints nothing here is taken back out; and one chosen while its plants are made ready is found again after.
//
// Run: node tools/swg/tests/paintBrush.test.ts
import assert from 'node:assert/strict';
import { EditorPaint, hexOf, paintTool, rgbOfHex, type PaintHost } from '../../../src/editor/editorPaint.ts';
import { PaintStroke, paintStampAsk } from '../../../src/editor/groundBrush.ts';
import { rawRect, stampWeight } from '../../../src/editor/sculpt.ts';
import { FLORA_PAINT_TUNE, PAINT_TUNE } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { GroundPaint, paintTileNumber, type FloraRecipe, type PaintPaletteEntry } from '../../../src/swg/terrain/groundPaint.ts';
import { familyRle, type PaintRow } from '../../../src/world/editFiles/paintFile.ts';
import type { RowChange } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const settle = () => new Promise((r) => setTimeout(r, 0));

interface Harness {
  host: PaintHost;
  ground: GroundPaint;
  entries: PaintPaletteEntry[];
  writes: RowChange[][];
  labels: string[];
  said: string[];
  refuse: boolean;
  kind: 'ground' | 'space' | 'copies';
  notPaintable: string | null;
  rows: Map<string, PaintRow>;
  stamps: number;
  /** Map-maker II's third wave: the families of other worlds lent now, the lendings asked, and a lending's refusal. */
  lentNow: Set<string>;
  lendAsked: string[];
  lendRefuse: string | null;
  /** The fourth wave: the recipes in memory, a class that cannot be painted, whether the plants are ready, and a hook run while they are made ready. */
  recipes: FloraRecipe[];
  missing: Map<string, string>;
  floraReadyNow: boolean;
  floraAsked: number;
  duringReady: (() => void) | null;
}
function harness(): Harness {
  const h = { ground: new GroundPaint(), entries: [] as PaintPaletteEntry[], writes: [] as RowChange[][], labels: [] as string[], said: [] as string[], refuse: false, kind: 'ground' as 'ground' | 'space' | 'copies', notPaintable: null as string | null, rows: new Map<string, PaintRow>(), stamps: 0, lentNow: new Set(['other:grass']), lendAsked: [] as string[], lendRefuse: null as string | null, recipes: [] as FloraRecipe[], missing: new Map<string, string>(), floraReadyNow: true, floraAsked: 0, duringReady: null } as Harness;
  let label = '';
  const edits = {
    writing: false,
    beginStroke: (l: string) => {
      label = l;
      return { label: l } as never;
    },
    strokeWrite: async (_es: unknown, changes: RowChange[]) => {
      if (h.refuse) return 'refused by the stand-in';
      h.writes.push(changes);
      for (const c of changes) {
        if (c.after) h.rows.set(c.id, c.after as unknown as PaintRow);
        else h.rows.delete(c.id);
      }
      return null;
    },
    endStroke: () => {
      h.labels.push(label);
      return `${label}: written`;
    },
  };
  h.host = {
    edits: edits as never,
    worldKind: () => h.kind,
    notPaintable: () => h.notPaintable,
    paint: () => h.ground,
    entries: () => h.entries,
    addEntry: (e) => h.entries.push(e),
    keepEntries: (n) => {
      h.entries.length = Math.min(h.entries.length, n);
    },
    pack: () => 'test',
    // Map-maker II's third wave: a family another world lent this one (id 11, `other`'s grass) stands beside the world's own.
    families: () => [
      { id: 7, name: 'grass', pack: 'test', children: [{ name: 'a', weight: 1 }] },
      { id: 9, name: 'rock', pack: 'test', children: [{ name: 'a', weight: 1 }] },
      { id: 11, name: 'grass', pack: 'other', children: [{ name: 'b', weight: 1 }] },
    ],
    lent: (pack, name) => h.lentNow.has(`${pack}:${name}`),
    lend: async (pack, name) => {
      h.lendAsked.push(`${pack}:${name}`);
      if (h.lendRefuse) return h.lendRefuse;
      h.lentNow.add(`${pack}:${name}`);
      return null;
    },
    familyAt: (x) => (x > 100 ? { family: 9, choice: 3 } : x < -100 ? { family: 11, choice: 2 } : { family: 7, choice: 1 }),
    colourAt: () => 0x804020,
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    preview: () => {},
    release: () => {},
    // The fourth wave's recipes, held as the world holds them (`editorEntry.ts`): in memory ahead of the file.
    recipes: () => h.recipes,
    addRecipe: (r) => {
      h.recipes = [...h.recipes, r];
      return h.recipes.length;
    },
    keepRecipes: (n) => {
      if (h.recipes.length > n) h.recipes = h.recipes.slice(0, n);
    },
    recipeMissing: (at) => h.missing.get(JSON.stringify(h.recipes[at - 1])) ?? null,
    floraIsReady: () => h.floraReadyNow,
    floraReady: async () => {
      h.floraAsked++;
      await settle();
      h.duringReady?.();
      h.floraReadyNow = true;
      return null;
    },
    fileRow: (id) => h.rows.get(id) ?? null,
    fileSize: () => ({ rows: h.rows.size, bytes: 0 }),
    worldRow: () => ({ id: 'world' }),
    beginWork: () => {},
    noteStamp: () => {},
    say: (w) => h.said.push(w),
  };
  return h;
}

const was = { ...PAINT_TUNE };
const floraWas = { ...FLORA_PAINT_TUNE };
try {
  // A held second at three frame rates.
  const held = async (fps: number, layer: 'family' | 'colour' | 'plants', erase = false, base?: GroundPaint): Promise<Harness> => {
    const h = harness();
    if (base) for (const [k, v] of base.fam) h.ground.fam.set(k, v.slice());
    if (base) for (const [k, v] of base.col) h.ground.col.set(k, v.slice());
    if (base) for (const [k, v] of base.flo) h.ground.flo.set(k, v.slice());
    if (base) h.ground.boundsAgain();
    h.entries.push({ pack: 'test', name: 'grass' });
    // The plants layer paints recipe 1 (the fourth wave), in memory ahead of the file as a recipe chosen is.
    h.recipes = [{ trees: 'clear' }];
    FLORA_PAINT_TUNE.recipe = 1;
    const p = new EditorPaint(h.host);
    PAINT_TUNE.layer = layer;
    PAINT_TUNE.entry = 1;
    p.armed = true;
    const f = toolFrame();
    const frames = Math.round(fps);
    for (let i = 0; i <= frames; i++) {
      f.apply = i < frames && !erase;
      f.inverse = i < frames && erase;
      f.valid = true;
      // Held still: where a moving aim's stamps fall is the frame the clock lands on, which no rate can share.
      f.x = -20;
      f.z = 10;
      f.dt = 1 / fps;
      f.now = i / fps;
      p.frame(f);
    }
    await settle();
    await settle();
    h.stamps = p.last.stamps;
    return h;
  };
  Object.assign(PAINT_TUNE, { radius: 6, hard: 0.5, strength: 1, cellAt: 0.5, rate: 15, colour: '#c08040', colourAmount: 0.8, colourRate: 2 });
  const tilesOf = (g: GroundPaint, layer: 'fam' | 'col' | 'flo') => JSON.stringify([...(layer === 'fam' ? g.fam : layer === 'col' ? g.col : g.flo)].map(([k, v]) => [k, Array.from(v)]));
  Object.assign(FLORA_PAINT_TUNE, { radius: 6, hard: 0.5, falloff: 'easeInOut', strength: 1, amount: 0.8, thicken: 2, rate: 15 });
  for (const layer of ['family', 'colour', 'plants'] as const) {
    const at = [30, 60, 144].map((fps) => held(fps, layer));
    const [a, b, c] = await Promise.all(at);
    const k = layer === 'family' ? 'fam' : layer === 'colour' ? 'col' : 'flo';
    ok(tilesOf(a.ground, k) === tilesOf(b.ground, k) && tilesOf(b.ground, k) === tilesOf(c.ground, k) && a.ground[k].size > 0, `a held second of ${layer} paints the same cells at 30, 60 and 144 frames a second, byte for byte`);
    ok(a.writes.length === 1 && a.labels.length === 1, `and is written once as the button is let go, one undo entry (${a.labels[0]})`);
  }
  {
    // The plants layer (Map-maker II's fourth wave), through the real editing class.
    const h = await held(60, 'plants');
    const t = h.ground.flo.get(paintTileNumber(0, 0))!;
    let peak = 0;
    let other = 0;
    for (let i = 0; i < t.length; i += 2) {
      if (t[i + 1] > peak) peak = t[i + 1];
      if (t[i + 1] !== 0 && t[i] !== 1) other++;
    }
    // Its own stamps, each 1 - e^-(thicken/rate) of the way to round(0.8 · 255) = 204 at the brush's core.
    const want = Math.round(204 * (1 - Math.exp((-2 * h.stamps) / 15)));
    ok(Math.abs(peak - want) <= 1 && other === 0, `a flora cell under a held second tends to the recipe at its amount by the colour's law: the core at ${peak} of 255 over ${h.stamps} stamps (1 - e^-2·n/15 of 204: ${want}), every painted cell naming recipe 1`);
    const w = h.writes[0];
    const rec = w.findIndex((c) => c.id === 'recipes');
    const firstFlo = w.findIndex((c) => c.id.startsWith('flo:'));
    const row = rec >= 0 ? (w[rec].after as unknown as { entries: FloraRecipe[] }) : null;
    ok(rec >= 0 && firstFlo > rec && w[rec].before === null && JSON.stringify(row?.entries) === JSON.stringify([{ trees: 'clear' }]), `a plants stroke whose recipe the file has not got writes the recipes row ahead of its flora tiles in its one batch (${w.map((c) => c.id).join(', ')})`);
    // The same stroke again, the recipe now in the file: no recipes row.
    const p = new EditorPaint(h.host);
    p.armed = true;
    await p.strokeAt('plants', false, -20, 10, 6, 0.5);
    ok(h.writes.length === 2 && !h.writes[1].some((c) => c.id === 'recipes') && h.writes[1].some((c) => c.id.startsWith('flo:')), 'a stroke of a recipe the file holds writes its tiles alone');
  }
  {
    // Erasing keeps each cell's recipe and lowers its amount: cells of recipe 2 erased while recipe 1 is the one chosen.
    const base = new GroundPaint();
    const bt = base.floraTile(0, 0, true)!;
    for (let cz = 0; cz < 8; cz++) for (let cx = 0; cx < 12; cx++) {
      const o = (cz * base.n + cx) * 2;
      bt[o] = 2;
      bt[o + 1] = 200;
    }
    base.boundsAgain();
    const h = harness();
    for (const [k, v] of base.flo) h.ground.flo.set(k, v.slice());
    h.ground.boundsAgain();
    h.recipes = [{ trees: 'clear' }, { grass: 'clear' }];
    h.rows.set('recipes', { id: 'recipes', entries: h.recipes } as unknown as PaintRow);
    FLORA_PAINT_TUNE.recipe = 1;
    const p = new EditorPaint(h.host);
    p.armed = true;
    await p.strokeAt('plants', true, -20, 10, 8, 0.3);
    const after = h.ground.flo.get(paintTileNumber(0, 0))!;
    let lowered = 0;
    let recipeKept = true;
    for (let i = 0; i < after.length; i += 2) {
      if (bt[i + 1] === 0) continue;
      if (after[i + 1] !== 0 && after[i] !== 2) recipeKept = false;
      if (after[i + 1] > bt[i + 1]) recipeKept = false;
      if (after[i + 1] < bt[i + 1]) lowered++;
    }
    ok(lowered > 0 && recipeKept, `erasing lowers the amount of the ${lowered} cells it reaches and keeps each one's own recipe (recipe 2 under a brush whose chosen recipe is 1)`);
  }
  {
    // Where two recipes meet the feather holds: a cell of another recipe is faded out by the stamp's law first and takes the
    // chosen recipe only once it has come to nought, then grows from nought.
    const g = new GroundPaint();
    const t0 = g.floraTile(0, 0, true)!;
    t0[0] = 1;
    t0[1] = 255;
    g.boundsAgain();
    const s = new PaintStroke(g);
    const a = paintStampAsk();
    Object.assign(a, { layer: 'plants', cx: 0, cz: 0, radius: 10, hard: 1, falloff: 'linear', strength: 0.05, recipe: 2, floraAmount: 1, floraRate: 2, dt: 1 / 15, erase: false });
    s.stamp(a, rawRect());
    const faint = [t0[0], t0[1]];
    a.strength = 1;
    s.stamp(a, rawRect());
    const one = [t0[0], t0[1]];
    for (let i = 0; i < 400; i++) s.stamp(a, rawRect());
    const t1 = g.floraTile(0, 0, false)!;
    ok(faint[0] === 1 && faint[1] === 253 && one[0] === 1 && one[1] < faint[1] && one[1] > 200 && t1[0] === 2 && t1[1] === 255, `a faint stamp of recipe 2 thins a cell of recipe 1 (255 to ${faint[1]}) and never swaps it, a full one thins it further (${one[1]}), and held long it takes recipe 2 and grows to its amount (${t1[1]})`);
  }
  {
    // A refused write puts the tiles back and takes the recipe it would have added out of the recipes in memory again.
    const h = harness();
    h.refuse = true;
    const p = new EditorPaint(h.host);
    p.armed = true;
    await p.chooseRecipe({ grass: 'clear' });
    ok(h.recipes.length === 1 && FLORA_PAINT_TUNE.recipe === 1 && PAINT_TUNE.layer === 'plants', 'a recipe chosen enters the recipes in memory, ahead of the file, and is the one painted');
    await p.strokeAt('plants', false, -20, 10, 8, 1);
    ok(h.ground.flo.size === 0 && h.writes.length === 0 && h.recipes.length === 0 && FLORA_PAINT_TUNE.recipe === 0, 'a refused plants stroke puts its tiles back and takes the recipe it would have written out of memory again');
    // A recipe that paints nothing here is taken back out as it is chosen.
    const bad: FloraRecipe = { trees: { add: { pack: 'elsewhere', name: 'x' } } };
    h.missing.set(JSON.stringify(bad), "another world's flora");
    const no = await p.chooseRecipe(bad);
    ok(h.recipes.length === 0 && /another world/.test(no), `a recipe whose class cannot be painted here is refused in words and taken back out (${no})`);
  }
  {
    // The plants made ready behind the curtain: a landing meanwhile that moves the list does not leave the brush on a place
    // that names another recipe or none (asked again after the wait, as a family lent behind the curtain is).
    const h = harness();
    const p = new EditorPaint(h.host);
    p.armed = true;
    const ra: FloraRecipe = { trees: 'clear' };
    const rb: FloraRecipe = { grass: 'clear' };
    const rx: FloraRecipe = { far: 'clear' };
    h.recipes = [ra];
    h.floraReadyNow = false;
    h.duringReady = () => {
      h.recipes = [ra];
    };
    await p.chooseRecipe(rb);
    ok(h.floraAsked === 1 && h.recipes.length === 2 && JSON.stringify(h.recipes[FLORA_PAINT_TUNE.recipe - 1]) === JSON.stringify(rb), 'a recipe dropped from the list while its plants were made ready is appended again and chosen at its place');
    h.floraReadyNow = false;
    const rc: FloraRecipe = { plants: 'clear' };
    h.duringReady = () => {
      h.recipes = [rx, ...h.recipes];
    };
    await p.chooseRecipe(rc);
    ok(JSON.stringify(h.recipes[FLORA_PAINT_TUNE.recipe - 1]) === JSON.stringify(rc), `and one whose place moved while they were made ready is chosen at its new place (${FLORA_PAINT_TUNE.recipe})`);
  }
  {
    const h = await held(60, 'family');
    const t = h.ground.fam.get(paintTileNumber(0, 0))!;
    const values = new Set(Array.from(t));
    ok(values.size === 2 && values.has(0) && values.has(1), 'a family cell is one family or the other: the entry or the world\'s own');
    const names = h.writes[0].map((c) => c.id).sort();
    ok(names.includes('palette') && names.includes('fam:0,0'), `the palette goes with the first stroke that names it (${names.join(', ')})`);
    // Erase over it, wider: the tile is left with nothing, so its row is taken out rather than written.
    const p = new EditorPaint(h.host);
    p.armed = true;
    await p.strokeAt('family', true, -20, 10, 14, 1);
    const last = h.writes.at(-1) ?? [];
    ok(h.ground.fam.size === 0 && last.some((c) => c.id === 'fam:0,0' && c.after === null) && !last.some((c) => c.after && /^fam:/.test(c.id)), 'erasing puts the world\'s own back, and a tile left with nothing is taken out of the file rather than written');
  }
  {
    const h = await held(60, 'colour');
    const t = h.ground.col.get(paintTileNumber(0, 0))!;
    let peak = 0;
    let cell = -1;
    for (let i = 3; i < t.length; i += 4) if (t[i] > peak) {
      peak = t[i];
      cell = i - 3;
    }
    // Its own stamps (the clock stamps at once as the button goes down, then fifteen a second), each 1 - e^-2/15 of the way.
    const want = Math.round(0.8 * 255 * (1 - Math.exp((-2 * h.stamps) / 15)));
    const rgb = rgbOfHex('#c08040');
    ok(Math.abs(peak - want) <= 3 && t[cell] === rgb[0] && t[cell + 1] === rgb[1] && t[cell + 2] === rgb[2], `a colour cell under a held second tends to the colour and to ${want} of 255 over its ${h.stamps} stamps (1 - e^-2·n/15 of 0.8): ${peak}, its colour ${hexOf((t[cell] << 16) | (t[cell + 1] << 8) | t[cell + 2])}`);
  }
  {
    // The colour stamp's law, exactly: at the core of the brush (weight one) a held second's n stamps lay
    // 1 - e^-(colourRate n / rate) of the way to the amount, at a slow stamp rate and a fast one alike.
    const rateWas = PAINT_TUNE.rate;
    for (const rate of [5, 30]) {
      PAINT_TUNE.rate = rate;
      const h = await held(60, 'colour');
      const t = h.ground.col.get(paintTileNumber(0, 0))!;
      let peak = 0;
      for (let i = 3; i < t.length; i += 4) peak = Math.max(peak, t[i]);
      const want = Math.round(Math.round(0.8 * 255) * (1 - Math.exp((-2 * h.stamps) / rate)));
      ok(Math.abs(peak - want) <= 1, `at ${rate} stamps a second a held second's ${h.stamps} stamps lay the core cell to ${peak} of 255, 1 - e^-(2·${h.stamps}/${rate}) of the way to 204 (${want}): the law is the same at every stamp rate`);
    }
    PAINT_TUNE.rate = rateWas;
  }
  {
    // `cellAt`: a family cell takes the paint exactly where the stamp's weight passes it.
    const ground = new GroundPaint();
    const s = new PaintStroke(ground);
    const a = paintStampAsk();
    Object.assign(a, { layer: 'family', cx: 2, cz: 2, radius: 14, hard: 0, falloff: 'linear', strength: 1, cellAt: 0.6, entry: 1, erase: false });
    s.stamp(a, rawRect());
    let right = true;
    let taken = 0;
    let left = 0;
    for (let cz = -4; cz <= 5; cz++) {
      for (let cx = -4; cx <= 5; cx++) {
        const w = stampWeight(Math.hypot(cx * 4 - 2, cz * 4 - 2), 14, 0, 'linear');
        const v = ground.familyCell(cx, cz);
        if (w > 0 && w < 0.6) left++;
        if (w >= 0.6) taken++;
        if ((v === 1) !== (w >= 0.6)) right = false;
      }
    }
    ok(right && taken > 0 && left > 0, `a family cell takes the entry exactly where the stamp's weight reaches cellAt (${taken} cells), and a cell the stamp reaches more lightly (${left}) stays the world's own`);
  }
  {
    // A family whose name is not a plain word (Dathomir's has brackets) is painted; one no file could hold is refused in
    // words before it enters the palette.
    const h = harness();
    const p = new EditorPaint(h.host);
    p.armed = true;
    p.choose('rock_dath_desertcanyon (mistyfalls)', undefined);
    ok(h.entries.length === 1 && PAINT_TUNE.entry === 1, 'a family named with brackets enters the palette and is chosen');
    const no = p.choose('bad"name', undefined);
    ok(h.entries.length === 1 && /cannot be painted|name/.test(no) && h.said.some((s) => /cannot be painted/.test(s)), `a name no file could hold is refused in words and never enters the palette (${no})`);
  }
  {
    // A refused write puts every tile back, and takes out of the palette in memory the entries it would have added.
    const h = harness();
    h.refuse = true;
    const p = new EditorPaint(h.host);
    PAINT_TUNE.layer = 'family';
    p.armed = true;
    p.choose('grass', undefined);
    ok(h.entries.length === 1, 'an entry chosen enters the palette in memory, ahead of the file');
    const said = await p.strokeAt('family', false, -20, 10, 8, 1);
    ok(p.last.stamps > 0 && h.ground.fam.size === 0 && h.writes.length === 0 && typeof said === 'string', `a refused write puts every tile its ${p.last.stamps} stamps painted back`);
    ok(h.entries.length === 0 && PAINT_TUNE.entry === 1, 'and the entry it would have added to the file is taken out of the palette in memory, so the next stroke does not carry it to be refused again');
    // The same stroke written once the refusal is gone: the palette goes with it.
    h.refuse = false;
    p.choose('grass', undefined);
    await p.strokeAt('family', false, -20, 10, 8, 1);
    ok(h.writes.length === 1 && h.writes[0].some((c) => c.id === 'palette') && h.entries.length === 1, 'a stroke after it adds the entry again and writes it with its tiles');
  }
  {
    // The middle button and Shift+click take the family under the aim.
    const h = harness();
    const p = new EditorPaint(h.host);
    p.armed = true;
    PAINT_TUNE.layer = 'family';
    const tool = paintTool(p, () => ({ valid: true, x: 150, z: 0 }));
    tool.middle?.();
    ok(h.entries.length === 1 && h.entries[0].name === 'rock' && PAINT_TUNE.entry === 1 && h.writes.length === 0, 'the middle button takes the family under the aim into the palette and chooses it, writing nothing');
    p.pick(10, 0);
    ok(h.entries.length === 2 && h.entries[1].name === 'grass' && PAINT_TUNE.entry === 2, 'and Shift+click the same');
    p.pick(150, 0);
    ok(h.entries.length === 2 && PAINT_TUNE.entry === 1, 'a family the palette has is chosen, not added again');
    PAINT_TUNE.layer = 'colour';
    p.pick(0, 0);
    ok(PAINT_TUNE.colour === '#804020', `on the colour layer it takes the colour under the aim (${PAINT_TUNE.colour})`);
    ok(tool.owns('middle') && tool.owns('apply') && tool.owns('inverse'), 'while armed the brush owns both buttons and the middle one');
  }
  {
    // Map-maker II's third wave: families of other worlds.
    const h = harness();
    const p = new EditorPaint(h.host);
    p.armed = true;
    PAINT_TUNE.layer = 'family';
    h.lendRefuse = 'gone is not installed (no ground pictures)';
    const no = await p.chooseFrom('gone', 'grass', undefined);
    ok(no === h.lendRefuse && h.entries.length === 0 && h.lendAsked.join() === 'gone:grass' && h.said.some((s) => /not lent/.test(s)), `a family of another world the game cannot lend is refused in its words and never enters the palette (${no})`);
    h.lendRefuse = null;
    const said = await p.chooseFrom('naboo', 'grass', 1);
    ok(h.lendAsked.join() === 'gone:grass,naboo:grass' && h.entries.length === 1 && h.entries[0].pack === 'naboo' && h.entries[0].name === 'grass' && h.entries[0].child === 1 && PAINT_TUNE.entry === 1 && /naboo/.test(said) && /naboo's grass/.test(p.chosenWords()), "one not lent yet is lent through the host first, then put in the palette by its pack and name (the alternate it forces with it) and chosen");
    await p.chooseFrom('naboo', 'grass', 1);
    ok(h.lendAsked.length === 2 && h.entries.length === 1 && PAINT_TUNE.entry === 1, 'chosen again it is lent nothing more and added nothing more');
    await p.chooseFrom('test', 'rock', undefined);
    ok(h.lendAsked.length === 2 && h.entries.length === 2 && h.entries[1].pack === 'test', "this world's own family is chosen as it always was, with no lending");
    // The middle button on a cell another world's lent family paints takes that world's family, lent already: no lending asked.
    p.pick(-150, 0);
    await settle();
    ok(h.lendAsked.length === 2 && h.entries.length === 3 && h.entries[2].pack === 'other' && h.entries[2].name === 'grass' && PAINT_TUNE.entry === 3, "the middle button on a cell another world's family paints takes it as that world's (lent already, nothing asked)");
  }
  {
    const h = harness();
    const p = new EditorPaint(h.host);
    h.kind = 'space';
    ok(/space/.test(await p.arm()) && !p.armed, 'a space zone refuses the brush in words');
    h.kind = 'copies';
    ok(/copies/.test(await p.arm()) && !p.armed, 'so does the world of copies');
    h.kind = 'ground';
    h.notPaintable = 'name a base family first';
    ok((await p.arm()) === 'name a base family first' && !p.armed, 'and a real-elevation world with no base family, in its own words');
  }
} finally {
  Object.assign(PAINT_TUNE, was);
  Object.assign(FLORA_PAINT_TUNE, floraWas);
}

console.log(`\npaintBrush: ${checks} checks passed`);
