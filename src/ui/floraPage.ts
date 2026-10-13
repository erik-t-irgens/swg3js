// The Graphics page's Flora section (wave 8): what of the plants is drawn, how far, and what casts and takes the
// sun's shadow. A file of its own for the reason the Gameplay page's is (`gameplayPage.ts`): `menu.ts` reaches for
// `document` and cannot be imported by a node test, and the test is what keeps a knob's ends and the range the
// console reads the same numbers (`FLORA_RANGES`). Nothing here touches the page. Every number is ours.
import { FLORA_RANGES } from '../world/floraSettings.ts';
import type { Knob } from './hudPage.ts';

const G = FLORA_RANGES;

export const FLORA: { title: string; knobs: readonly Knob[] } = {
  title: 'Flora',
  knobs: [
    { key: 'grass', label: 'Grass', kind: 'toggle', hint: 'The ground\'s own grass, flowers and small plants round you, planted where the game\'s own terrain plants them.' },
    { key: 'grassReach', label: 'Grass distance', kind: 'range', min: G.grassReach.min, max: G.grassReach.max, step: G.grassReach.step, format: (v) => `${v.toFixed(1)}×`, requires: ['grass'], hint: '1 is the world\'s own, 20 to 32 m. Farther builds more of the ground round you at once.' },
    { key: 'grassDensity', label: 'Grass density', kind: 'range', min: G.grassDensity.min, max: G.grassDensity.max, step: G.grassDensity.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['grass'], hint: 'How many of the tufts are kept. The ground round you is planted again a piece a frame.' },
    { key: 'farCards', label: 'Far tree cards', kind: 'toggle', hint: 'The flat trees the game stands on the far hills, beyond where the trees themselves stop.' },
    { key: 'farCardReach', label: 'Far tree card distance', kind: 'range', min: G.farCardReach.min, max: G.farCardReach.max, step: G.farCardReach.step, format: (v) => `${v.toFixed(2)}×`, requires: ['farCards'], hint: '1 is the world\'s own end, 500 to 1000 m; they begin where the trees stop, so a wide Ground detail radius leaves few or none.' },
    { key: 'floraPlantReach', label: 'Small plant distance', kind: 'range', min: G.floraPlantReach.min, max: G.floraPlantReach.max, step: G.floraPlantReach.step, format: (v) => `${v.toFixed(2)}×`, hint: 'Times the world\'s own, never under 64 m.' },
    { key: 'floraTreeReach', label: 'Tree distance', kind: 'select', options: G.floraTreeReach.options.map((v) => ({ value: v, label: v === 0 ? 'As far as the ground' : `${v} m` })), hint: 'Past it the far tree cards take over.' },
    { key: 'floraTreeShadows', label: 'Trees cast shadows', kind: 'toggle', requires: ['shadows'], hint: 'Planted and placed.' },
    { key: 'floraPlantShadows', label: 'Small plants cast shadows', kind: 'toggle', requires: ['shadows'], hint: 'The dearest switch here: most of what is planted is small. Each casts at its finest only.' },
    { key: 'grassShadows', label: 'Grass casts shadows', kind: 'toggle', requires: ['shadows', 'grass'], hint: 'Near you only; the original never did.' },
    { key: 'grassTakesShadows', label: 'Shadows fall on grass', kind: 'toggle', requires: ['shadows'], hint: 'Grass in a tree\'s or a wall\'s shadow is darkened as a leaf in shadow is, and so are the far tree cards.' },
    { key: 'farCardShadows', label: 'Far tree cards cast shadows', kind: 'toggle', requires: ['shadows', 'farCards'], hint: 'Only where they stand inside Shadow distance: raise it, or shorten Tree distance.' },
    { key: 'leafShadows', label: 'Shadow on leaves from their own tree', kind: 'choice', choices: [{ value: 'self', label: 'No, as asked' }, { value: 'all', label: 'Yes, no extra cost' }, { value: 'none', label: 'No shadow on leaves at all, cheapest' }], requires: ['shadows'], hint: 'Whether a tree\'s leaves take its own shadow. Another tree\'s, or a wall\'s, still falls on them unless you take every shadow off.' },
  ],
};
