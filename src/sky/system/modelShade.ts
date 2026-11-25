// The light between the bodies on the viewer's own model (the GPU port's sky round, its fixer; the brief's item I): the space
// body viewer's ground view under a system, drawn from the viewer's own model at the System view's date rather than the game's
// motion, runs the very shade the game's frame runs (`skyShade.ts`' `SkyShade`, D to F), over that model and its state, so the
// bodies' shadows on each other, a soft eclipse through air and the eclipse's darkness are the game's there too. Its sizes and
// mean distances are the pose's (`bodyPose.ts`' `modelPoseOf`), as the game's are its motion's. The model's own numbers
// (`system.js`' cover and daylight, which the System view shows) are left as they are: the shade keeps a cover of its own.
//
// Pure: no three, no page; node runs it as it stands.
import { SkyShade, type ShadeMotion } from './skyShade.ts';
import { MOTION_TUNE } from './skyMotion.ts';

/** What the shade reads of a viewer's model (`system.js`' compiled numbers, either version). */
interface ViewModel {
  version: number;
  m: number;
  items: { body: number; place?: string | null; member?: boolean; brightness?: number }[];
  hidden: Set<string>;
  itemStar: Uint8Array;
  itemDrawn: Uint8Array;
  itemSheet: Uint8Array;
  itemSize: Float64Array;
  casterJ?: number;
  pairA?: Int16Array;
  pairB?: Int16Array;
  sys: { bodies: { id: string; kind: string }[] };
}

/** The model's state at its moment (`makeSkyState`'s): its time, the bodies' places, the turn into the sky, each item's way and distance. */
interface ViewState {
  T: number;
  pos: Float64Array;
  R: Float64Array;
  dir: Float64Array;
  dist: Float64Array;
}

interface Kept {
  shade: SkyShade;
  mo: ShadeMotion & { dir: Float64Array; dist: Float64Array; sunShare: number; sun2Share: number; daylight: number };
  planet: string;
  T: number;
}
const KEPT = new WeakMap<object, Kept>();

/** A place's picture name as the game's places name it (`skyMotion.ts`' `skyPlacesOf`): a celestial's, else none. */
function pictureOfPlace(place: string | null | undefined): string | null {
  if (!place) return null;
  const at = place.indexOf(':celestial:');
  if (at < 0) return null;
  return place.slice(at + ':celestial:'.length).replace(/#\d+$/, '');
}

/**
 * The shade of a viewer's model at its state's moment for the world `planet` (the game's planet: its air and its star),
 * `sizes` and `meanDist` the pose's (`modelPoseOf`'s drawn sizes and its distance kit's means), worked again only when the
 * moment moves. Null where it cannot be made (the model names no casting star).
 */
export function modelShadeOf(model: object, st: ViewState, planet: string, sizes: Float64Array | null, meanDist: Float64Array | null): SkyShade | null {
  const M = model as ViewModel;
  let c = KEPT.get(model) ?? null;
  if (c === null || c.planet !== planet) {
    const bodies = M.sys.bodies;
    const items = M.items.map((it, j) => {
      const b = bodies[it.body];
      const star = !!M.itemStar[j];
      return {
        star,
        drawn: !!M.itemDrawn[j] && !(it.place && M.hidden.has(it.place)),
        sheet: !!M.itemSheet[j],
        kind: it.member ? 'group' : b.kind,
        body: b.id,
        picture: pictureOfPlace(it.place),
        sizeDeg: M.itemSize[j],
        brightness: star ? (typeof it.brightness === 'number' ? it.brightness : 1) : 0,
      };
    });
    let casterJ = M.version === 2 ? (M.casterJ ?? -1) : -1;
    if (casterJ < 0) for (let j = 0; j < M.m; j++) if (M.itemStar[j]) { casterJ = j; break; }
    const pa = M.pairA && M.pairA.length ? M.pairA[0] : -1;
    const pb = M.pairB && M.pairB.length ? M.pairB[0] : -1;
    const secondJ = pa >= 0 && pb >= 0 && (casterJ === pa || casterJ === pb) ? (casterJ === pa ? pb : pa) : -1;
    if (casterJ < 0) return null;
    const mo = { m: M.m, items, dir: st.dir, dist: st.dist, cover: new Float64Array(M.m), casterJ, secondJ, meanDist: meanDist ?? undefined, sizeNow: sizes ?? undefined, sunShare: 1, sun2Share: 1, daylight: 1 };
    let shade: SkyShade;
    try {
      shade = new SkyShade(mo, model as unknown as ConstructorParameters<typeof SkyShade>[1], planet);
    } catch {
      return null;
    }
    c = { shade, mo, planet, T: Number.NaN };
    KEPT.set(model, c);
  }
  // the state the page reads now (a model's state may be made again: its arrays followed)
  if (c.mo.dir !== st.dir || c.mo.dist !== st.dist) {
    c.mo.dir = st.dir;
    c.mo.dist = st.dist;
    c.T = Number.NaN;
  }
  if (c.T !== st.T) {
    c.T = st.T;
    c.shade.frame(c.mo, st, MOTION_TUNE);
  }
  return c.shade;
}
