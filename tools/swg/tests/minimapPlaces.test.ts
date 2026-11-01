// The places and the game's services on the minimap and in the debug menu (Map-maker II's eighth wave): which switch a
// service rides and which palette colour it wears; what the minimap is handed (`minimapPlacesOf`, the very function
// `App.refreshPlacesShown` calls): each city of ours drawn on the maps and standing in the world's state, `bad` where players
// may not build in it, never a place of another kind or one on no map, and the services standing now; the minimap's own
// drawing on a 2D context that records it (a bad outline in the palette's `bad` and a good one in `accent`, each switch
// hiding its kind, the minimap's own switch hiding them all, a service past the rim left out); the game's hand-overs (a
// world state taken asks for the minimap's places again); and the `locations` dials, every one moved through the real
// tables, the services' switches as choices whose copied line sets them again, and the places tool's own dials joining the
// set once the editor hands them in.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
//
// Run: node tools/swg/tests/minimapPlaces.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVICE_TUNE, serviceColour, serviceGlyph, serviceLabel, serviceLayerOf, tuneServices } from '../../../src/ui/serviceMarks.ts';
import { minimapPlacesOf } from '../../../src/world/places.ts';
import type { LocationRow } from '../../../src/world/editFiles/locationsFile.ts';
import { COL, colourOf } from '../../../src/core/palette.ts';
import { HUD_SIZES } from '../../../src/ui/hudMath.ts';
import { MINIMAP_TUNE, minimapScale } from '../../../src/ui/minimap.ts';
import { allDials, movedLine, resetDials, type ChoiceDial, type NumberDial } from '../../../src/ui/dials.ts';
import { LOCATION_DIALS, LOCATION_DIAL_SET, locationDialSet } from '../../../src/world/locationsDials.ts';
import { worldDialsFor } from '../../../src/world/restussDials.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SHIPPED = { ...SERVICE_TUNE };

{
  // Which switch a kind rides, and its colour.
  ok(['terminal', 'terminal_bank', 'terminal_bazaar', 'terminal_mission'].every((k) => serviceLayerOf(k) === 'terminals'), "every terminal rides the terminals' switch");
  ok(['cantina', 'bank', 'shrine', 'cloningfacility', 'medicalcenter', 'imperial', 'hotel'].every((k) => serviceLayerOf(k) === 'services'), "every building and shrine rides the services' switch");
  ok(serviceColour('terminal_mission') === 'muted' && serviceColour('imperial') === 'warn' && serviceColour('rebel') === 'warn' && serviceColour('cantina') === 'ink', 'a terminal wears muted, a faction base warn, the rest ink');
  ok(['cantina', 'terminal_bank', 'imperial', 'nothing_known'].every((k) => typeof COL[serviceColour(k)] === 'number'), "and every colour is one of the palette's");
  ok(serviceLabel('cloningfacility') === 'Cloning facility' && serviceLabel('some_new_kind') === 'Some new kind', 'a kind is named in our words, or in its own with its underscores taken out');
  ok(serviceGlyph('cantina') !== serviceGlyph('bank') && serviceGlyph('some_new_kind').length > 0, 'each kind its own mark, and one never written a ring');
}

{
  // What the minimap is handed.
  const rows: LocationRow[] = [
    { id: 'world', kind: 'world', cities: 'noBuild' },
    { id: 'open', kind: 'city', name: 'Open', shape: { kind: 'circle', c: [0, 0], r: 100 } },
    { id: 'shut', kind: 'city', name: 'Shut', shape: { kind: 'rect', min: [200, 0], max: [300, 100] }, build: false },
    { id: 'hidden', kind: 'city', name: 'Hidden', shape: { kind: 'circle', c: [500, 0], r: 50 }, map: false },
    { id: 'landmark', kind: 'landmark', name: 'Rock', shape: { kind: 'circle', c: [600, 0], r: 20 } },
    { id: 'ruin', kind: 'city', name: 'Ruin Town', shape: { kind: 'circle', c: [800, 0], r: 60 }, state: 'restuss=ruins' },
  ];
  const services = [
    { kind: 'cantina', x: 10, z: 10 },
    { kind: 'bank', x: 20, z: 20, state: 'restuss=living' },
  ];
  const stands = (s?: string | null) => !s || s === 'restuss=living';
  const p = minimapPlacesOf({ locations: rows, services }, stands);
  ok(p.outlines.length === 2 && p.outlines[0].shape === rows[1].shape && !p.outlines[0].bad && p.outlines[1].shape === rows[2].shape && p.outlines[1].bad, 'the outlines are the cities of ours drawn on the maps, the one players may not build in bad');
  ok(!p.outlines.some((o) => o.shape === rows[3].shape || o.shape === rows[4].shape || o.shape === rows[5].shape), 'never a city on no map, a place of another kind, nor one standing in another state');
  ok(p.services.length === 2 && minimapPlacesOf({ locations: rows, services }, (s) => !s).services.length === 1, 'and the services that stand now, one tagged for a state not in force left out');
}

// The minimap itself, on a stand-in page and a context that records every stroke in the colour it was laid in.
{
  const ops: { op: string; style?: unknown; x?: number; y?: number }[] = [];
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    imageSmoothingEnabled: true,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    fillRect() {},
    closePath() {},
    scale() {},
    rotate() {},
    drawImage() {},
    fill() {},
    moveTo(x: number, y: number) {
      ops.push({ op: 'moveTo', x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ op: 'lineTo', x, y });
    },
    arc(x: number, y: number) {
      ops.push({ op: 'arc', x, y });
    },
    translate(x: number, y: number) {
      ops.push({ op: 'translate', x, y });
    },
    stroke(path?: { d?: string }) {
      ops.push({ op: path ? 'mark' : 'stroke', style: ctx.strokeStyle });
    },
  };
  const el = (tag: string): Record<string, unknown> => {
    const e: Record<string, unknown> = {
      tag,
      children: [] as unknown[],
      style: {},
      width: 0,
      height: 0,
      hidden: false,
      textContent: '',
      className: '',
      appendChild(k: unknown) {
        (e.children as unknown[]).push(k);
        return k;
      },
      insertBefore(k: unknown) {
        (e.children as unknown[]).unshift(k);
        return k;
      },
      classList: { toggle() {}, contains: () => false },
      getContext: () => (tag === 'canvas' ? ctx : null),
    };
    return e;
  };
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: el, head: { appendChild() {} } };
  g.Path2D = class {
    d: string;
    constructor(d: string) {
      this.d = d;
    }
  };
  const { Minimap } = await import('../../../src/ui/minimap.ts');
  const pic = { image: { width: 1024, height: 1024 }, frame: { width: 16384, x: 0, z: 0 } };
  const mm = new Minimap(el('div') as never, el('div') as never, () => pic as never);
  const view = { wanted: true, pack: 'p', x: 0, z: 0, heading: 0, range: 800, northUp: true, now: 100 };
  const k = minimapScale(HUD_SIZES.minimap, view.range, MINIMAP_TUNE.rimInsetPx);
  const rim = HUD_SIZES.minimap / 2 - MINIMAP_TUNE.rimInsetPx;
  const reach = rim / k;
  const places = {
    outlines: [
      { shape: { kind: 'circle' as const, c: [100, 0] as [number, number], r: 40 }, bad: false },
      { shape: { kind: 'rect' as const, min: [-200, -50] as [number, number], max: [-100, 50] as [number, number] }, bad: true },
    ],
    services: [
      { kind: 'cantina', x: 50, z: 50 },
      { kind: 'bank', x: -50, z: 30 },
      { kind: 'terminal_mission', x: 30, z: -40 },
      { kind: 'cantina', x: reach * 1.5, z: 0 },
    ],
  };
  const draw = (): typeof ops => {
    ops.length = 0;
    mm.redraw();
    view.now += 1;
    mm.update(view);
    return ops.slice();
  };
  mm.setPlaces(places);
  tuneServices({ services: true, terminals: false, minimap: true });
  let o = draw();
  ok(mm.outlinesDrawn === 2, 'both outlines drawn');
  const strokes = o.filter((x) => x.op === 'stroke').map((x) => x.style);
  ok(strokes.includes(colourOf(COL.accent)) && strokes.includes(colourOf(COL.bad)), `a city players may build in in accent and one they may not in bad (${strokes.join(', ')})`);
  ok(mm.servicesDrawn === 2 && o.filter((x) => x.op === 'mark').length === 2 * 2, 'the two buildings inside the rim drawn (each a halo and a stroke), the terminal left to its switch, the one past the rim left out');
  tuneServices({ terminals: true });
  o = draw();
  ok(mm.servicesDrawn === 3 && o.some((x) => x.op === 'mark' && x.style === colourOf(COL.muted)), "the terminals' switch on draws the terminal, in muted");
  tuneServices({ services: false });
  draw();
  ok(mm.servicesDrawn === 1, "the services' switch off leaves the terminal alone");
  tuneServices({ services: true, minimap: false });
  draw();
  ok(mm.servicesDrawn === 0 && mm.outlinesDrawn === 2, "the minimap's own switch off draws no service and still every outline");
  mm.setPlaces(null);
  draw();
  ok(mm.servicesDrawn === 0 && mm.outlinesDrawn === 0, 'and handed none, none');
  tuneServices({ ...SHIPPED });
}

{
  // The game's hand-overs: what it hands the minimap is the very function above, and a world state taken asks again.
  const main = read('src/main.ts');
  ok(/this\.minimap\.setPlaces\(minimapPlacesOf\(f, standsIn\)\);/.test(main), "the game hands the minimap minimapPlacesOf's answer, by the world states' own test");
  ok(/private refreshPlacesShown\(\): void \{\s*const f = this\.placesFile;\s*this\.placesShownStamp = worldStateStamp\(\);/.test(main), 'and keeps the states\' stamp it filtered them at');
  ok(/if \(this\.placesFile && worldStateStamp\(\) !== this\.placesShownStamp\) this\.refreshPlacesShown\(\);\s*\/\/ The clock the coordinates over the circle keep their rate on\./.test(main), 'a state taken since (an arrival takes its states after its places file landed) filters them again on the next frame');
  ok(/redraw: \(\) => \{\s*\/\/ A services switch moved from the menu: the map window's own boxes say it too\.\s*this\.map\.syncServiceBoxes\(\);\s*this\.refreshPlacesShown\(\);\s*this\.minimap\.redraw\(\);/.test(main), "a dial moved draws the maps again, the map window's switches told");
}

{
  // The `locations` dials: every one moved through the real tables and back; the services' switches as choices.
  const set = locationDialSet();
  ok(set === LOCATION_DIAL_SET && worldDialsFor('locations') === LOCATION_DIAL_SET, 'with no editor the set is the places\' own');
  let calls = 0;
  LOCATION_DIALS.host = { remake: () => calls++, redraw: () => calls++ };
  for (const d of allDials(set)) {
    if (d.kind === 'number') {
      const n = d as NumberDial;
      const was = n.get();
      const to = n.min + (n.max - n.min) / 2;
      n.set(to);
      ok(Math.abs(n.get() - to) < 1e-9 || n.get() !== was, `${n.key} moves its table (${was} to ${n.get()})`);
    } else {
      const c = d as ChoiceDial;
      for (const v of c.choices) {
        c.set(v);
        ok(c.get() === v, `${c.key} set to ${v} reads ${v}`);
      }
    }
  }
  ok(calls > 0, 'and every move asks the game to draw (or make) again');
  // A switch moved, copied out as the console's line, sets the table again.
  resetDials(set);
  const term = allDials(set).find((d) => d.key === 'services.terminals') as ChoiceDial;
  term.set('on');
  const line = movedLine(set);
  ok(/^__debug\.locations\(\{ services: \{ terminals: 'on' \} \}\)$/.test(line), `the copied line names it (${line})`);
  tuneServices({ terminals: false });
  tuneServices({ terminals: 'on' });
  ok(SERVICE_TUNE.terminals === true, "and that line's word sets the switch again (a choice's 'on' is the switch's true)");
  resetDials(set);
  ok(SERVICE_TUNE.services === SHIPPED.services && SERVICE_TUNE.terminals === SHIPPED.terminals && SERVICE_TUNE.minimap === SHIPPED.minimap, 'a reset puts the switches back where they shipped');
  LOCATION_DIALS.host = null;
  // The places tool's own dials join the set once the editor hands them in.
  const { placesToolDials } = await import('../../../src/editor/editorDials.ts');
  const { PLACES_TOOL_TUNE, PLACES_TOOL_TUNE_DEFAULTS, tunePlacesTool } = await import('../../../src/editor/editorTune.ts');
  LOCATION_DIALS.tool = placesToolDials();
  const withTool = worldDialsFor('locations')!;
  const radius = allDials(withTool).find((d) => d.key === 'tool.radius') as NumberDial | undefined;
  const mode = allDials(withTool).find((d) => d.key === 'tool.mode') as ChoiceDial | undefined;
  ok(!!radius && !!mode && withTool.shipped.get('tool.radius') === PLACES_TOOL_TUNE_DEFAULTS.radius && withTool.shipped.get('tool.mode') === PLACES_TOOL_TUNE_DEFAULTS.mode, "with the editor in, the places tool's radius, step and mode are sliders in the same set, shipped at the tool's own defaults");
  radius!.set(400);
  mode!.set('rect');
  ok(PLACES_TOOL_TUNE.radius === 400 && PLACES_TOOL_TUNE.mode === 'rect', 'and move the tool itself');
  const toolLine = movedLine(withTool);
  ok(/tool: \{ mode: 'rect', radius: 400 \}/.test(toolLine), `the copied line is locations({ tool })'s own (${toolLine})`);
  for (const d of allDials(withTool)) {
    if (!d.key.startsWith('tool.') || d.kind !== 'number') continue;
    const n = d as NumberDial;
    n.set(n.min);
    const lo = n.get();
    n.set(n.max);
    ok(lo >= n.min && n.get() <= n.max && n.get() > lo, `${n.key} moves the tool across its slider (${lo} to ${n.get()})`);
  }
  tunePlacesTool({ ...PLACES_TOOL_TUNE_DEFAULTS });
  LOCATION_DIALS.tool = null;
}

console.log(`\nminimapPlaces: ${checks} checks passed`);
