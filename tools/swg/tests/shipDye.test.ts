// Ships and speeders take every colour (the Creator and dye pass, wave 7).
//
// A ship's colours (`index_color_<n>`, the palette operations on its hull, wings, carriers and parts) take a
// colour carried whole from the appearance page's own picker as well as an index of the hull's own palette;
// its choice of pattern (`index_texture_<n>`) never does. So: a colour carried whole renders on a ship's
// recipe exactly as that colour taken from a palette would, and leaves the pattern the values chose alone; it
// survives every place a fit is kept, cleaned and checked (packFit, resolveFit, ShipPaint, the edit page's
// pick, the relay's cleanShip) and is refused on a pattern in every one of them; the glow a glowing paint
// shader splits off is split from it as from any colour. On the wire it rides beside the paint, never in it:
// the paint carries the nearest colour of the hull's own palette, which a relay and a browser built before read
// as they always have, and a browser built for it lays the colour back over the paint; a browser knows whether
// its server passes the colour on only once the claim is answered; a real relay passes it from one browser's
// hello to another's, through the browser's own socket both ways, and its hail says so. A speeder whose shaders
// take colours is given a fit of its paint alone, which every one of those paths takes as it takes a ship's and
// which leaves its guns as an unfitted vehicle's; and the gallery's paint and its status are read as the
// converter writes them. Over what is converted on this machine, a real ship recipe and the gallery pack are
// tried too.
//
// Run: node tools/swg/tests/shipDye.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { decodePng as decodePngSync } from '../png.mjs';
import { RAW_COLOUR_MIN, isRawColour, rawColour, renderRecipe, type Img, type Pass, type Recipe, type ShaderDef, type Values } from '../../../src/player/texrender.ts';
import { paintFiles, runPaintJob, type PaintImg, type PaintRecipe } from '../../../src/vehicles/paintJob.ts';
import { PAINT_CARRIED_WHOLE, armGuns, clampVariable, componentIndex, fitForWire, fitFromWire, isColourKey, nearestIndex, packFit, paintOnlyFit, resolveFit, type ComponentDef, type FitDef, type FitPaint, type ShipFit, type WireFit } from '../../../src/vehicles/shipFit.ts';
import { ShipPaint } from '../../../src/vehicles/shipPaint.ts';
import { paintCountText, pickPaintValue } from '../../../src/ui/shipEditModel.ts';
import { openTab, pickerTabs } from '../../../src/ui/dyePicker.ts';
import { Session, type SessionStore } from '../../../src/net/session.ts';
import { PAINT_VERSION, RAW_COLOUR_MIN as SERVER_RAW_MIN, cleanShip, isColourKey as serverColourKey } from '../../../server/shipWire.mjs';
import { GALLERY_PAINT_FORMAT, galleryPaintStatus, vehiclePaint } from '../gallery.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const bytes = (a: { rgba: ArrayLike<number> } | null | undefined): string => (a ? Array.from(a.rgba).join() : '');
const img = (w: number, h: number, texels: number[][]): Img => ({ width: w, height: h, rgba: Uint8Array.from(texels.flat()) });

const RED = rawColour(200, 30, 30);

// ---------------------------------------------------------------- one rule on both sides of the wire
{
  ok(PAINT_VERSION === PAINT_CARRIED_WHOLE && SERVER_RAW_MIN === RAW_COLOUR_MIN, 'the relay and the browser agree on what a hail says of paint and on the least a colour carried whole may be');
  const keys = ['index_color_1', 'index_color_2', '/private/index_color_1', 'index_color_0', 'index_texture_1', '/private/index_texture_1', 'index_color', 'my_index_color_1', 'index_color_1x'];
  ok(keys.every((k) => isColourKey(k) === serverColourKey(k)), 'and on which keys are colours');
  ok(isColourKey('index_color_1') && isColourKey('/private/index_color_2') && !isColourKey('index_texture_1') && !isColourKey('my_index_color_1'), "a colour is `index_color_<n>`, bare or under a path; a pattern's choice is not one");
}

// ---------------------------------------------------------------- the relay's copy of a fit
{
  // A colour carried whole rides beside the paint (`colours`) and never in it: the paint keeps 0..255, exactly as
  // every relay and browser built before reads it.
  const fit = { components: { engine: 'eng_s02' }, paint: { index_color_1: 37, index_color_2: 7, index_texture_1: 2 }, colours: { index_color_1: RED }, droid: 'r2' };
  const wire = cleanShip({ id: 'xwing', fit });
  ok(JSON.stringify(wire) === JSON.stringify({ id: 'xwing', fit: { components: fit.components, paint: fit.paint, colours: fit.colours, droid: 'r2' } }), `cleanShip passes a colour carried whole on beside the paint, an index and a pattern in it (${JSON.stringify(wire?.fit)})`);
  ok(JSON.stringify(cleanShip({ id: 'xwing', fit: { components: {}, paint: { index_color_1: RED, index_color_2: -1 } } })?.fit.paint) === '{}', 'and never in the paint, which keeps 0..255 as it always did');
  ok(!('colours' in (cleanShip({ id: 'xwing', fit: { components: {}, paint: { index_color_1: 3 } } })?.fit ?? {})), 'a fit with no colour carried whole goes with no colours at all');
  const pattern = cleanShip({ id: 'xwing', fit: { components: {}, paint: { index_color_1: 3 }, colours: { index_texture_1: RED, '/private/index_texture_1': -1, index_color_1: RED } } });
  ok(JSON.stringify(pattern?.fit.colours) === JSON.stringify({ index_color_1: RED }), 'and refuses one on the choice of pattern, which only ever takes an index');
  const past = cleanShip({ id: 'xwing', fit: { components: {}, paint: {}, colours: { index_color_1: RAW_COLOUR_MIN - 1, index_color_2: -1.5, index_color_3: 5, index_color_4: 0, index_color_5: '-3' } } });
  ok(past !== undefined && !('colours' in past.fit), 'and a value past white, a fraction, an index, nought or a word among the colours');
  const ends = cleanShip({ id: 'xwing', fit: { components: {}, paint: {}, colours: { index_color_1: RAW_COLOUR_MIN, '/private/index_color_2': -1 } } });
  ok(ends?.fit.colours?.index_color_1 === RAW_COLOUR_MIN && ends.fit.colours['/private/index_color_2'] === -1, 'white and black carried whole go through, bare or under a path');
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`index_color_${i}`, -1 - i]));
  ok(Object.keys(cleanShip({ id: 'xwing', fit: { components: {}, paint: {}, colours: many } })?.fit.colours ?? {}).length === 8, 'and at most 8 of them, as of the paint');
}

// ---------------------------------------------------------------- where a fit is kept and checked
const PAL = 'palette/starships_trim.pal';
const PAL_COLOURS = Array.from({ length: 64 }, (_, i) => [i * 4, 255 - i * 4, (i * 37) % 256, 255]);
const paint: FitPaint = {
  shaders: ['shader/hull.sht'],
  variables: [
    { name: 'index_texture_1', kind: 'index', count: 2, fewest: 2, default: 0 },
    { name: 'index_color_1', kind: 'palette', palette: PAL, size: 64, default: 10 },
    { name: 'index_color_2', kind: 'palette', palette: PAL, size: 64, default: 20 },
  ],
};
const fitDef = { chassis: 'player_xwing', droid: 'astromech' as const, slots: [], paint };
{
  const packed = packFit({ components: {}, paint: { index_color_1: RED, index_color_2: 900, index_texture_1: RED } });
  ok(packed.paint.index_color_1 === RED && packed.paint.index_color_2 === 255 && packed.paint.index_texture_1 === 0, `packFit keeps a colour carried whole on a colour and brings a pattern back to its first (${JSON.stringify(packed.paint)})`);
  const r = resolveFit(fitDef, [], new Map(), [], { components: {}, paint: { index_color_1: RED, index_texture_1: RED, index_color_2: 99 } });
  ok(r.paint.index_color_1 === RED && r.paint.index_texture_1 === 0 && r.paint.index_color_2 === 63 && r.painted, `resolveFit keeps it on a colour, takes a pattern's back to its first and an index to its palette's last (${JSON.stringify(r.paint)})`);
  ok(clampVariable(paint.variables[1], RED) === RED && clampVariable(paint.variables[0], RED) === 0 && clampVariable(paint.variables[1], -0.4) === 0, 'clampVariable: whole on a colour, the first pattern on a choice, and nought for something that rounds to it');
  const edited: ShipFit = { components: {}, paint: {} };
  ok(pickPaintValue(edited, fitDef, 'index_color_1', RED) && edited.paint.index_color_1 === RED, "the edit page's pick keeps a colour carried whole on a colour");
  ok(!pickPaintValue(edited, fitDef, 'index_texture_1', RED) && edited.paint.index_texture_1 === undefined, 'and refuses one on the pattern');
  ok(paintCountText(paint.variables[1], RED, 64) === '#c81e1e' && paintCountText(paint.variables[1], 3, 64) === '4/64', "a colour row's count reads #rrggbb for a colour carried whole, the place in its palette otherwise");
  ok(pickerTabs('paint').join() === 'own,garments,creator,all' && openTab('paint') === 'own', "a ship's colour opens the appearance page's picker on its own palette, with every garment and creator colour beside it");
}

// ---------------------------------------------------------------- a hello's fit: the colour beside, the nearest in the paint
{
  const palettes = { [PAL]: PAL_COLOURS };
  const near37 = rawColour(PAL_COLOURS[37][0] + 2, PAL_COLOURS[37][1] - 1, PAL_COLOURS[37][2]);
  const at20 = rawColour(PAL_COLOURS[20][0], PAL_COLOURS[20][1], PAL_COLOURS[20][2]);
  const kept: ShipFit = { components: { engine: 'eng_s02' }, paint: { index_color_1: near37, index_color_2: at20, index_texture_1: 1 }, droid: 'r2' };
  const sent = fitForWire(kept, paint, palettes);
  ok(sent.fit.paint.index_color_1 === 37 && !('index_color_2' in sent.fit.paint) && sent.fit.paint.index_texture_1 === 1, `the paint carries the nearest colour of the hull's own palette, the default kept as absent, the pattern untouched (${JSON.stringify(sent.fit.paint)})`);
  ok(JSON.stringify(sent.fit.colours) === JSON.stringify({ index_color_1: near37, index_color_2: at20 }), 'and the colours carried whole ride beside it');
  ok(sent.nearer.join() === 'index_color_1,index_color_2' && sent.fit.components.engine === 'eng_s02' && sent.fit.droid === 'r2' && kept.paint.index_color_1 === near37 && !('colours' in kept), 'it names the colours carried whole, keeps the rest of the fit, and never touches the fit it was given');
  // What a relay built before keeps of it (every paint value 0..255, nothing it does not know), and what a browser built before shows.
  const before = { components: sent.fit.components, paint: Object.fromEntries(Object.entries(sent.fit.paint).filter(([, v]) => v >= 0 && v <= 255)), droid: sent.fit.droid };
  ok(JSON.stringify(before.paint) === JSON.stringify(sent.fit.paint), 'so a relay built before, which keeps 0..255 and drops what it does not know, keeps the whole paint');
  const old = resolveFit(fitDef, [], new Map(), [], before as ShipFit);
  ok(old.paint.index_color_1 === 37 && old.paint.index_color_2 === 20, `and a browser built before draws the nearest colours rather than the palette's first (${old.paint.index_color_1}, ${old.paint.index_color_2})`);
  // What a browser built for it reads back.
  const back = fitFromWire(cleanShip({ id: 'xwing', fit: sent.fit })!.fit as WireFit)!;
  ok(back.paint.index_color_1 === near37 && back.paint.index_color_2 === at20 && back.paint.index_texture_1 === 1 && back.droid === 'r2' && back.components.engine === 'eng_s02', 'through a relay that passes them on, a browser built for them reads the fit its player keeps');
  ok(JSON.stringify(resolveFit(fitDef, [], new Map(), [], back).paint) === JSON.stringify(resolveFit(fitDef, [], new Map(), [], kept).paint), 'and resolves it to the very paint its player sees');
  ok(fitFromWire(cleanShip({ id: 'xwing', fit: { components: {}, paint: { index_color_1: 37 } } })!.fit as WireFit)!.paint.index_color_1 === 37, 'a fit from a browser built before reads as it was sent');
  ok(fitFromWire({ components: {}, paint: { index_texture_1: 1 }, colours: { index_texture_1: RED, index_color_1: 4 } })!.paint.index_texture_1 === 1 && !('index_color_1' in fitFromWire({ components: {}, paint: {}, colours: { index_color_1: 4 } })!.paint), 'and nothing but a colour carried whole on a colour is laid over the paint');
  const blind = fitForWire(kept, paint, null);
  ok(!('index_color_1' in blind.fit.paint) && blind.fit.colours?.index_color_1 === near37 && blind.nearer.length === 2, 'with the palette not yet to hand, the paint goes as the default and the colour still rides beside it');
  const plain: ShipFit = { components: {}, paint: { index_color_1: 5 } };
  ok(fitForWire(plain, paint, palettes).fit === plain && fitForWire(plain, paint, palettes).nearer.length === 0, 'a fit with no colour carried whole goes as it is');
  ok(nearestIndex([4, 251, 37], PAL_COLOURS) === 1 && nearestIndex([0, 0, 0], [[9, 9, 9], [0, 0, 1], [0, 0, 1]]) === 1, 'the nearest colour is the nearest over the three channels, the first on a tie');
}

// ---------------------------------------------------------------- a browser knows which server it has only once it has answered
{
  const data: Record<string, string> = {};
  const store: SessionStore = { get: (k) => (k in data ? data[k] : null), set: (k, v) => void (data[k] = v) };
  const s = new Session(store);
  s.send = () => {};
  s.noteCharacter({ id: 'char-1', name: 'Han' }, { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' });
  s.opening();
  s.hail({ v: 6, now: 1, nonce: 'ffeeddccbbaa99887766554433221100', paint: 2 });
  ok(s.paintVersion === 0, 'a hail that says paint 2 is heard but not in force until the claim is answered');
  s.claimed({ player: s.player, character: 'char-1', name: 'Han' }, 'browser');
  ok(s.paintVersion === 2, 'and in force once it is');
  s.opening();
  s.hail({ v: 6, now: 2, nonce: 'ffeeddccbbaa99887766554433221100' });
  s.claimed({ player: s.player, character: 'char-1', name: 'Han' }, 'browser');
  ok(s.paintVersion === 0, 'a server whose hail says nothing of paint keeps every value to 0..255');
}

// ---------------------------------------------------------------- a ship recipe of the game's shape, made up here
const STAGE = { colorOp: 4, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' };
const PASS: Pass = { alphaBlend: false, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 15, tfactorTag: 'MAIN', stages: [STAGE as never] };
const files: Record<string, Img> = {
  'hull_a.png': img(2, 2, [[200, 200, 200, 255], [100, 100, 100, 0], [50, 150, 250, 255], [255, 255, 255, 128]]),
  'hull_b.png': img(2, 2, [[20, 40, 60, 255], [80, 100, 120, 255], [140, 160, 180, 0], [220, 240, 255, 64]]),
};
const images = (f: string | null) => (f ? (files[f] ?? null) : null);
const shader: ShaderDef = {
  effect: 'effect/h_color2w_specmap_cbmp.eft',
  passes: [PASS],
  textures: {},
  addresses: {},
  coordSets: {},
  tfactors: {},
  alphaRefs: {},
  choices: [{ tag: 'MAIN', variable: 'index_texture_1', private: false, default: 0, files: ['hull_a.png', 'hull_b.png'] }],
  palettes: [{ tag: 'MAIN', palette: PAL, variable: 'index_color_1', private: false, default: 10 }],
};
const hull: PaintRecipe = { mesh: 'ship', material: 'shader/hull.sht', kind: 'bake', baseTag: 'MAIN', shader, slots: [], glow: { maskTag: 'MAIN', channel: 'a', keepAlpha: false } };
{
  const palettes = { [PAL]: PAL_COLOURS };
  const at = (v: Values) => renderRecipe(hull, v, palettes, images)!;
  const whole = at(new Map([['index_texture_1', 1], ['index_color_1', rawColour(PAL_COLOURS[12][0], PAL_COLOURS[12][1], PAL_COLOURS[12][2])]]));
  const indexed = at(new Map([['index_texture_1', 1], ['index_color_1', 12]]));
  ok(bytes(whole) === bytes(indexed), "a colour carried whole renders on a ship's recipe exactly as the same colour taken from its palette");
  const red = at(new Map([['index_texture_1', 1], ['index_color_1', RED]]));
  ok(bytes(red) !== bytes(indexed), 'and another colour carried whole renders another hull');
  ok(paintFiles(hull, new Map([['index_texture_1', 1], ['index_color_1', RED]])).join() === 'hull_b.png' && paintFiles(hull, new Map([['index_texture_1', 1], ['index_color_1', 12]])).join() === 'hull_b.png', 'it leaves the pattern the values chose alone: the same picture is read under either colour');
  ok(paintFiles(hull, new Map([['index_texture_1', RED]])).join() === 'hull_a.png', 'and a colour carried whole on the pattern, which the wire refuses, would only ever read the first pattern');
  // The glow a glowing paint shader splits off: the mask is the chosen pattern's, so a colour carried whole is split as an index is.
  const jobWhole = runPaintJob(hull, new Map([['index_texture_1', 1], ['index_color_1', rawColour(PAL_COLOURS[12][0], PAL_COLOURS[12][1], PAL_COLOURS[12][2])]]), palettes, images) as PaintImg;
  const jobIndexed = runPaintJob(hull, new Map([['index_texture_1', 1], ['index_color_1', 12]]), palettes, images) as PaintImg;
  ok(!!jobWhole.emis && bytes(jobWhole) === bytes(jobIndexed) && bytes(jobWhole.emis) === bytes(jobIndexed.emis), "the paint worker's job splits the glow of a colour carried whole exactly as of the same colour from the palette");
}

// ---------------------------------------------------------------- ShipPaint, with a stand-in renderer
{
  const customize = { images: 'customize/', recipes: [hull], palettes: { [PAL]: PAL_COLOURS } };
  const realFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    if (String(url).endsWith('customize.json')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => customize };
    return { ok: false, headers: { get: () => '' }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  try {
    const asked: Values[] = [];
    const prepared: THREE.Object3D[][] = [];
    const p = new ShipPaint(paint, '/pack/ships/', {
      prepare: async (roots) => void prepared.push(roots),
      forget: () => {},
      render: async (r: Recipe, values: Values) => {
        asked.push(new Map(values));
        return renderRecipe(r, values, { [PAL]: PAL_COLOURS }, images);
      },
    });
    const mat = new THREE.MeshStandardMaterial({ name: 'shader/hull.sht', map: new THREE.Texture(), emissiveMap: new THREE.Texture() });
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    root.add(mesh);
    p.track(root);
    await p.apply({ index_color_1: RED, index_texture_1: RED, index_color_2: 3 }, 2000);
    ok(p.values.index_color_1 === RED && p.values.index_texture_1 === 0 && p.values.index_color_2 === 3, `the paint keeps a colour carried whole on a colour and takes a pattern back to its first (${JSON.stringify(p.values)})`);
    ok(p.custom && mesh.material !== mat && asked.some((v) => v.get('index_color_1') === RED), 'a colour carried whole is custom paint: the copies go on, prepared first, and the render is asked for with the colour whole');
    const worn = mesh.material as THREE.MeshStandardMaterial;
    const want = renderRecipe(hull, new Map<string, number>([['index_texture_1', 0], ['index_color_1', RED], ['index_color_2', 3]]), { [PAL]: PAL_COLOURS }, images)!;
    ok(bytes({ rgba: ((worn.map?.image as { data?: Uint8Array }).data ?? []) as ArrayLike<number> }) === bytes(want) && prepared.length >= 1, 'and what the copy wears is the recipe rendered with it');
    p.dispose();
  } finally {
    (globalThis as { fetch: unknown }).fetch = realFetch;
  }
}

// ---------------------------------------------------------------- a speeder's fit of its paint alone
{
  ok(paintOnlyFit(null) === null && paintOnlyFit({ shaders: [], variables: [] }) === null && paintOnlyFit({ shaders: ['shader/x.sht'], variables: [] }) === null, 'a vehicle whose shaders take no colours has no fit');
  const speeder: FitPaint = { shaders: ['shader/landspeeder_hcsb21.sht'], variables: [{ name: 'index_color_1', kind: 'palette', palette: 'palette/vehicle_base.pal', size: 64, default: 17 }, { name: 'index_color_2', kind: 'palette', palette: 'palette/vehicle_trim.pal', size: 64, default: 4 }] };
  const fd = paintOnlyFit(speeder)!;
  ok(!!fd && fd.slots.length === 0 && fd.droid === 'computer' && fd.paint === speeder && fd.chassis === '', 'a speeder whose shaders take colours has a fit of its paint alone: no slots, no droid it shows');
  const r = resolveFit(fd, [], new Map(), [], { components: {}, paint: { index_color_1: RED } });
  ok(r.paint.index_color_1 === RED && r.paint.index_color_2 === 4 && r.painted && !r.notes.length && Object.keys(r.components).length === 0 && r.droid === null, 'which resolves as a ship\'s does, a colour carried whole and all');
  // Its guns, spawned as a ship: a fit of paint alone has no slot to fire from, so every gun stays and fires the
  // ship's one weapon, as before it had a fit. A ship's fit still arms each gun from its slot and leaves out one
  // whose slot fires nothing.
  const components: ComponentDef[] = [
    { name: 'wpn_red', type: 'weapon', compat: 'wpn', label: 'Red', template: '', weapon: { projectile: 3, speed: 600, range: 512 } },
    { name: 'msl_1', type: 'weapon', compat: 'wpn', label: 'Launcher', template: '', weapon: { projectile: 9, speed: 300, range: 900, missile: 1 } },
  ];
  const index = componentIndex(components);
  const muzzles = [{ slot: null, hardpoint: 'muzzle' }, { slot: null, hardpoint: 'muzzle_2' }];
  const walker = armGuns(fd, r, components, index, muzzles);
  ok(!walker.fitted && walker.guns.length === 2 && walker.guns.every((g) => !('weapon' in g)), "a painted walker spawned as a ship keeps both its guns, each firing the ship's own weapon");
  ok(!armGuns(null, null, components, index, muzzles).fitted && armGuns(null, null, components, index, muzzles).guns.length === 2, 'as an unfitted vehicle does');
  const shipDef: FitDef = { chassis: 'player_xwing', droid: 'astromech', slots: [{ slot: 'weapon_0', compat: ['wpn'], looks: [], stock: 'wpn_red' }, { slot: 'weapon_1', compat: ['wpn'], looks: [], stock: 'msl_1' }], paint: null };
  const shipFit = resolveFit(shipDef, components, index, [], null);
  const armed = armGuns(shipDef, shipFit, components, index, [{ slot: 'weapon_0' }, { slot: 'weapon_1' }, { slot: null }]);
  ok(armed.fitted && armed.guns.length === 2 && armed.guns.every((g) => g.weapon?.name === 'wpn_red'), "a ship's fit arms each gun from its slot (a hull gun the first bolt slot's) and leaves out the launcher's");
}

// ---------------------------------------------------------------- the gallery's paint, as the converter writes it
{
  const made: string[] = [];
  const maker = {
    isPaint: (sh: string) => {
      made.push(sh);
      return /_hc/.test(sh);
    },
    variablesOf: (shaders: string[]) => ({ variables: shaders.length ? [{ name: 'index_color_1', kind: 'palette', palette: 'palette/vehicle_base.pal', size: 64, default: 17 }] : [], notes: ['a note'] }),
  };
  const got = vehiclePaint(['shader/speederbike_hcsb21.sht', 'shader/speederbike_asb14.sht', 'shader/speederbike_hcsb21.sht', 'shader/speederbike_sm_hc8.sht'], maker);
  ok(got.paint?.shaders.join() === 'shader/speederbike_hcsb21.sht,shader/speederbike_sm_hc8.sht' && got.paint.variables.length === 1 && got.notes.join() === 'a note', "a vehicle model's paint is its paint shaders, once each in their order, with one variable list");
  ok(made.length === 3, 'each shader is asked about once');
  ok(vehiclePaint(['shader/plain_asb14.sht'], maker).paint === null, 'a model with no paint shader has none');
  const index = { sections: [{ id: 'vehicles', items: [{}, {}, {}] }] };
  const old = galleryPaintStatus({ categories: { layout: [{ id: 'a' }] } }, index);
  ok(old.stale && old.vehicles === 3 && old.painted === 0 && /converted before a speeder could be painted/.test(old.why), 'status asks for the vehicles again while the manifest carries no paint stamp');
  const now = galleryPaintStatus({ paintFormat: GALLERY_PAINT_FORMAT, categories: { layout: [{ id: 'a', paint: { variables: [{}] } }, { id: 'b' }] } }, index);
  ok(!now.stale && now.painted === 1, 'and asks for nothing once it does, counting the models whose colours a player can change');
  ok(!galleryPaintStatus({ categories: { layout: [] } }, { sections: [{ id: 'houses', items: [{}] }] }).stale, 'a gallery with no vehicles asks for nothing');
}

// ---------------------------------------------------------------- what is converted on this machine
const ROOT = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
{
  const dir = join(ROOT, 'ships');
  const czFile = join(dir, 'customize.json');
  if (!existsSync(czFile)) note('no ships pack on this machine, so a real ship recipe is not tried');
  else {
    const cz = JSON.parse(readFileSync(czFile, 'utf8')) as { images: string; recipes: Recipe[]; palettes: Record<string, number[][]> };
    const pick = cz.recipes.find((r) => (r.shader?.palettes ?? []).some((p) => isColourKey(p.variable)) && (r.shader?.choices ?? []).length > 0);
    if (!pick) note('the ships pack has no recipe with both a colour and a pattern');
    else {
      const decoded = new Map<string, Img | null>();
      const load = (f: string | null): Img | null => {
        if (!f) return null;
        if (!decoded.has(f)) decoded.set(f, existsSync(join(dir, cz.images, f)) ? (decodePngSync(readFileSync(join(dir, cz.images, f))) as Img) : null);
        return decoded.get(f)!;
      };
      const colour = pick.shader!.palettes.find((p) => isColourKey(p.variable))!;
      const choice = pick.shader!.choices[0];
      const pattern = Math.min(1, choice.files.length - 1);
      const palette = cz.palettes[colour.palette] ?? [];
      const i = Math.min(5, palette.length - 1);
      const t0 = Date.now();
      const whole = renderRecipe(pick, new Map<string, number>([[choice.variable, pattern], [colour.variable, rawColour(palette[i][0], palette[i][1], palette[i][2])]]), cz.palettes, load);
      const indexed = renderRecipe(pick, new Map<string, number>([[choice.variable, pattern], [colour.variable, i]]), cz.palettes, load);
      const red = renderRecipe(pick, new Map<string, number>([[choice.variable, pattern], [colour.variable, RED]]), cz.palettes, load);
      ok(!!whole && bytes(whole) === bytes(indexed) && bytes(red) !== bytes(indexed), `${pick.material}: a colour carried whole renders the real hull as the same colour from ${colour.palette} does, and red another (${Date.now() - t0} ms for three renders)`);
      ok(paintFiles(pick as PaintRecipe, new Map<string, number>([[choice.variable, pattern], [colour.variable, RED]])).join() === paintFiles(pick as PaintRecipe, new Map<string, number>([[choice.variable, pattern], [colour.variable, i]])).join(), 'and reads the very pictures the pattern chose');
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { ships: { fit?: { paint?: FitPaint | null } | null }[] };
    const vars = manifest.ships.flatMap((s) => s.fit?.paint?.variables ?? []);
    ok(vars.length > 0 && vars.every((v) => (v.kind === 'palette') === isColourKey(v.name)), `every ship's colour is named a colour and every pattern not (${vars.length} variables over the hulls), so the relay's rule by name is the hull's rule by kind`);
  }
}
{
  const dir = join(ROOT, 'gallery');
  if (!existsSync(join(dir, 'manifest.json'))) note('no gallery pack on this machine');
  else {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { paintFormat?: number; categories: { layout: { id: string; paint?: FitPaint }[] } };
    const index = JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8'));
    const st = galleryPaintStatus(manifest, index);
    if (st.stale) note(`the gallery here was converted before a speeder could be painted (${st.vehicles} vehicles): \`npm run swg -- gallery @SWG assets-private --only=vehicles --retail-only\` writes its paint`);
    else {
      const painted = manifest.categories.layout.filter((m) => m.paint);
      ok(painted.length > 0 && existsSync(join(dir, 'customize.json')), `the gallery's paint: ${painted.length} models whose colours a player can change, with their recipes beside the manifest`);
      ok(painted.every((m) => !!paintOnlyFit(m.paint) && m.paint!.variables.every((v) => (v.kind === 'palette') === isColourKey(v.name))), 'every one a fit of its paint alone, its colours named colours');
    }
  }
}

// ---------------------------------------------------------------- a real relay passes a colour carried whole on
if (typeof WebSocket === 'undefined') note('the relay round trip was skipped: this node has no WebSocket of its own');
else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'swg-shipdye-relay-'));
  const port = 18873;
  process.env.PORT = String(port);
  process.argv.push(`--data=${dataDir}`);
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Msg = Record<string, unknown>;
  async function connect(name: string, character: string, ship?: unknown) {
    const key = new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Msg[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error(`${name} could not connect`)));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await wait(150);
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: 1, about: { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' } });
    await wait(150);
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet: 'tatooine', v: 6, ...(ship ? { ship } : {}) });
    await wait(150);
    send({ t: 'state', p: [0, 0, 0], h: 0, s: 'idle', v: 0 });
    await wait(150);
    return { got, send, close: () => ws.close() };
  }
  // The browser's own socket (src/net/net.ts), wired as the game wires it: the hail's `paint` has to reach the
  // session through its switch, and a peer's colours carried whole have to come back out of it.
  const shelf = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  g.window ??= { setTimeout, clearTimeout, setInterval, clearInterval };
  const { Net } = await import('../../../src/net/net.ts');
  const until = async (what: () => boolean, ms = 4000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };
  const net = new Net();
  try {
    const palettes = { [PAL]: PAL_COLOURS };
    const kept: ShipFit = { components: {}, paint: { index_color_1: RED, index_color_2: 12, index_texture_1: 1 } };
    const sent = fitForWire(kept, paint, palettes);
    const a = await connect('Wedge', 'c-wedge', { id: 'xwing', fit: sent.fit });
    const hail = a.got.find((m) => m.t === 'hail') as Msg | undefined;
    ok(hail?.paint === 2, `the relay's hail says it passes a colour carried whole on (paint ${String(hail?.paint)})`);
    const joined: { id: number; hello: { name: string; ship?: { id: string; fit: WireFit } } }[] = [];
    net.onJoin = (peer) => void joined.push(peer as never);
    net.onHello = (peer) => void joined.push(peer as never);
    net.session.noteCharacter({ id: 'c-luke', name: 'Luke' }, { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' });
    net.connect(`ws://127.0.0.1:${port}`, { name: 'Luke', species: 'human_male', class: 'jedi', planet: 'tatooine', ship: { id: 'xwing', fit: sent.fit } });
    ok(await until(() => net.session.authority === 'server'), "a real relay takes the browser's own claim");
    ok(net.session.paintVersion === PAINT_CARRIED_WHOLE, `and the hail's paint reaches the session through the socket's own switch (${net.session.paintVersion})`);
    ok(await until(() => joined.some((p) => p.hello?.name === 'Wedge')), "the browser's socket is handed the other player's hello");
    const theirs = joined.filter((p) => p.hello?.name === 'Wedge').pop()?.hello.ship;
    const read = fitFromWire(theirs?.fit);
    ok(theirs?.id === 'xwing' && theirs.fit.colours?.index_color_1 === RED && read?.paint.index_color_1 === RED && read.paint.index_texture_1 === 1, `with the colour carried whole beside its paint, which it lays back over the paint (${JSON.stringify(theirs?.fit)})`);
    const b = await connect('Biggs', 'c-biggs');
    const welcome = b.got.find((m) => m.t === 'welcome') as { peers?: { hello?: { name?: string; ship?: { id: string; fit: WireFit } } }[] } | undefined;
    const seen = welcome?.peers?.find((p) => p.hello?.name === 'Wedge')?.hello?.ship;
    ok(seen?.id === 'xwing' && seen.fit.colours?.index_color_1 === RED && seen.fit.paint.index_color_1 === sent.fit.paint.index_color_1 && seen.fit.paint.index_texture_1 === 1, `a browser joining later is handed the ship with its colour whole and the nearest of its palette in the paint (${JSON.stringify(seen?.fit)})`);
    const luke = welcome?.peers?.find((p) => p.hello?.name === 'Luke')?.hello?.ship;
    ok(luke?.fit.colours?.index_color_1 === RED, "and the colour the browser's own socket sent goes the whole way too");
    a.send({ t: 'hello', name: 'Wedge', species: 'human_male', class: 'jedi', planet: 'tatooine', v: 6, ship: { id: 'xwing', fit: { components: {}, paint: { index_color_1: RED, index_texture_1: 1 }, colours: { index_color_1: RED, index_texture_1: RED } } } });
    await wait(200);
    const again = [...b.got].reverse().find((m) => m.t === 'hello') as { hello?: { ship?: { fit: WireFit } } } | undefined;
    ok(!!again?.hello?.ship && again.hello.ship.fit.colours?.index_color_1 === RED && !('index_texture_1' in (again.hello.ship.fit.colours ?? {})) && !('index_color_1' in again.hello.ship.fit.paint) && again.hello.ship.fit.paint.index_texture_1 === 1, 'and a colour carried whole on a pattern, or in the paint, is dropped on the way, the colour beside it kept');
    a.close();
    b.close();
    await wait(150);
  } finally {
    net.disconnect();
    setTimeout(() => {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\nshipDye: ${passed} checks passed`);
      process.exit(0);
    }, 200);
  }
}
if (typeof WebSocket === 'undefined') console.log(`\nshipDye: ${passed} checks passed`);
